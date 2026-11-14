import os
import sys
import time
import cv2
import yaml

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from camera import CameraStream
from detector import ObjectDetector
from tracker import ObjectTracker
from rules.fence import VirtualFenceRule
from rules.loitering import LoiteringRule
from rules.night import NightVisionRule
from anpr.ocr import ANPRProcessor
from alerts import AlertDispatcher
from stream_server import start_stream_server, update_stream_frame

def load_config(config_path="config.yaml"):
    if not os.path.exists(config_path):
        base = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(base, "config.yaml")
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

def main():
    print("==================================================================")
    print("  🛡️  IBVAP - Intelligent Border Video Analytics Platform")
    print("  Smart India Hackathon (Problem Statement ID: 26187)")
    print("==================================================================")
    
    config = load_config()
    mode = config.get("mode", "standalone")
    print(f"[System] Mode: {mode.upper()}")
    
    # 1. Start Live MJPEG Stream Server for Dashboard
    start_stream_server(port=8001)

    # 2. Initialize AI Engines
    det_cfg = config.get("detection", {})
    detector = ObjectDetector(
        model_name=det_cfg.get("model", "yolov8n.pt"),
        imgsz=det_cfg.get("imgsz", 640),
        conf=det_cfg.get("confidence_day", 0.45)
    )
    
    tracker = ObjectTracker()
    fence_rule = VirtualFenceRule(
        zone_name="BOP Perimeter Restricted Zone",
        min_frames=config.get("rules", {}).get("min_consecutive_frames", 6),
        cooldown_sec=config.get("rules", {}).get("cooldown_seconds", 60)
    )
    loitering_rule = LoiteringRule(
        threshold_seconds=config.get("rules", {}).get("loitering_seconds", 30)
    )
    night_rule = NightVisionRule(
        brightness_threshold=config.get("rules", {}).get("night_brightness_threshold", 45)
    )
    
    anpr_processor = None
    if config.get("anpr", {}).get("enabled", True):
        print("[System] Loading ANPR Engine (EasyOCR)...")
        anpr_processor = ANPRProcessor()

    output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "output")
    alert_dispatcher = AlertDispatcher(output_dir=output_dir)

    # 3. Setup Cameras
    cameras = []
    cam_configs = config.get("cameras", [])
    for c in cam_configs:
        if not c.get("is_active", True):
            continue
        src = c["source"]
        # Handle relative demo video paths
        if isinstance(src, str) and not os.path.isabs(src) and not src.isdigit():
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            src = os.path.join(base_dir, src)
            
        stream = CameraStream(
            camera_id=c["id"],
            name=c["name"],
            source=src
        ).start()
        cameras.append((c, stream))
        print(f"[Camera] Initialized {c['name']} ({c['id']}) -> {src}")

    if not cameras:
        print("[Error] No active cameras configured. Please check config.yaml.")
        return

    print("\n[AI Engine] Surveillance Pipeline Running...")
    print("Press Ctrl+C or 'q' in OpenCV window to stop.\n")

    frame_counter = 0
    process_interval = det_cfg.get("process_every_nth_frame", 2)
    last_detections_cache = {}

    try:
        while True:
            frame_counter += 1
            
            for c_info, stream in cameras:
                cam_id = c_info["id"]
                cam_name = c_info["name"]
                
                success, frame = stream.read()
                if not success or frame is None:
                    continue

                # 1. Night Mode & Lighting Check
                proc_frame, is_night, brightness = night_rule.process(frame)
                current_conf = det_cfg.get("confidence_night", 0.35) if is_night else det_cfg.get("confidence_day", 0.45)

                # 2. Run Detection (Skip frames to optimize CPU)
                if frame_counter % process_interval == 0:
                    detections, class_names = detector.detect(proc_frame, custom_conf=current_conf)
                    detections = tracker.update(detections)
                    last_detections_cache[cam_id] = (detections, class_names)
                else:
                    detections, class_names = last_detections_cache.get(cam_id, ([], []))

                # 3. Virtual Fence Intrusion Evaluation
                intrusions = fence_rule.evaluate(
                    frame=proc_frame,
                    detections=detections,
                    class_names=class_names,
                    animal_classes=detector.animal_classes,
                    camera_id=cam_id
                )
                
                for intr in intrusions:
                    alert_dispatcher.dispatch(
                        camera_id=cam_id,
                        alert_type=intr["type"],
                        severity=intr["severity"],
                        track_id=intr["trackId"],
                        confidence=intr["confidence"],
                        bbox=intr["bbox"],
                        details=intr["details"],
                        frame=proc_frame,
                        pixel_bbox=intr["pixel_bbox"]
                    )

                # 4. Loitering Check
                loitering_alerts = loitering_rule.evaluate(detections, class_names, camera_id=cam_id)
                for l_alert in loitering_alerts:
                    alert_dispatcher.dispatch(
                        camera_id=cam_id,
                        alert_type=l_alert["type"],
                        severity=l_alert["severity"],
                        track_id=l_alert["trackId"],
                        confidence=l_alert["confidence"],
                        bbox=[0, 0, 0, 0],
                        details=l_alert["details"],
                        frame=proc_frame
                    )

                # 5. ANPR on Vehicle Tracks
                if anpr_processor and len(detections) > 0 and detections.tracker_id is not None:
                    for idx, (tid, cname) in enumerate(zip(detections.tracker_id, class_names)):
                        if cname in {'car', 'truck', 'bus', 'motorcycle'}:
                            bbox = detections.xyxy[idx]
                            x1, y1, x2, y2 = [int(v) for v in bbox]
                            x1, y1 = max(0, x1), max(0, y1)
                            x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
                            vehicle_crop = frame[y1:y2, x1:x2]
                            
                            plate_res = anpr_processor.read_plate(vehicle_crop)
                            if plate_res and plate_res.get("shouldAlert"):
                                p_num = plate_res["plate"]
                                if plate_res["isBlacklisted"]:
                                    b_info = plate_res["blacklistInfo"]
                                    alert_dispatcher.dispatch(
                                        camera_id=cam_id,
                                        alert_type="ANPR_MATCH",
                                        severity=b_info.get("severity", "CRITICAL"),
                                        track_id=tid,
                                        confidence=plate_res["confidence"],
                                        bbox=[x1/frame.shape[1], y1/frame.shape[0], x2/frame.shape[1], y2/frame.shape[0]],
                                        details={
                                            "plateNumber": p_num,
                                            "reason": b_info.get("reason", "Blacklist hit"),
                                            "vehicleClass": cname
                                        },
                                        frame=proc_frame,
                                        pixel_bbox=[x1, y1, x2, y2]
                                    )

                # 6. Annotate Visual Frame
                labels = []
                if len(detections) > 0 and detections.tracker_id is not None:
                    labels = [
                        f"#{tid} {cname} {conf:.2f}"
                        for tid, cname, conf in zip(detections.tracker_id, class_names, detections.confidence)
                    ]
                
                annotated = tracker.annotate(proc_frame, detections, labels)
                annotated = fence_rule.draw(annotated)

                # HUD Overlay
                fps_text = f"FPS: {stream.fps} | Mode: {'NIGHT' if is_night else 'DAY'} ({brightness})"
                cv2.putText(annotated, f"IBVAP: {cam_name}", (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.putText(annotated, fps_text, (15, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                # Push to Stream Server for Dashboard
                update_stream_frame(cam_id, annotated, fps=stream.fps)

                # Optional Local GUI Display
                if mode == "standalone":
                    cv2.imshow(f"IBVAP - {cam_name}", annotated)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

    except KeyboardInterrupt:
        print("\n[AI Engine] Stopping...")
    finally:
        for _, s in cameras:
            s.stop()
        cv2.destroyAllWindows()
        print("[AI Engine] Cleanly shut down.")

if __name__ == "__main__":
    main()
