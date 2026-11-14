import os
import cv2
import json
import time
from datetime import datetime, timezone

class AlertDispatcher:
    """
    Builds, saves, logs and queues alerts strictly conforming to the IBVAP API Contract.
    Saves snapshot images with highlighted bounding boxes to disk.
    """
    def __init__(self, output_dir="output"):
        self.output_dir = output_dir
        self.snapshots_dir = os.path.join(output_dir, "snapshots")
        self.alerts_file = os.path.join(output_dir, "alerts.jsonl")
        
        os.makedirs(self.snapshots_dir, exist_ok=True)
        self.offline_queue = [] # Queue for unsent alerts when backend is offline

    def dispatch(self, camera_id, alert_type, severity, track_id, confidence, bbox, details, frame=None, pixel_bbox=None):
        """
        Creates an alert, draws snapshot on frame, saves to disk and logs to alerts.jsonl.
        """
        now = datetime.now(timezone.utc)
        ts_str = now.isoformat()
        alert_id = f"alt-{int(now.timestamp() * 1000)}"
        snapshot_filename = f"{alert_id}_{camera_id}.jpg"
        snapshot_path = os.path.join(self.snapshots_dir, snapshot_filename)
        
        # Save snapshot if frame is provided
        if frame is not None:
            snap_img = frame.copy()
            if pixel_bbox is not None and len(pixel_bbox) == 4:
                x1, y1, x2, y2 = pixel_bbox
                cv2.rectangle(snap_img, (x1, y1), (x2, y2), (0, 0, 255), 3)
                cv2.putText(
                    snap_img, 
                    f"{alert_type} (#{track_id})", 
                    (x1, max(25, y1 - 10)), 
                    cv2.FONT_HERSHEY_SIMPLEX, 
                    0.6, 
                    (0, 0, 255), 
                    2
                )
            cv2.imwrite(snapshot_path, snap_img)
        else:
            snapshot_filename = None

        alert_payload = {
            "id": alert_id,
            "cameraId": camera_id,
            "type": alert_type,
            "severity": severity,
            "timestamp": ts_str,
            "trackId": int(track_id) if track_id is not None else -1,
            "confidence": round(float(confidence), 2),
            "bbox": [round(float(c), 4) for c in bbox] if bbox else [0, 0, 0, 0],
            "snapshot": snapshot_filename,
            "details": details,
            "status": "NEW"
        }

        # 1. Append to local alerts.jsonl
        try:
            with open(self.alerts_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(alert_payload) + "\n")
        except Exception as e:
            print(f"[AlertDispatcher] Error logging alert: {e}")

        # 2. Add to offline queue
        self.offline_queue.append(alert_payload)

        # 3. Print clean one-line alert summary
        print(f"🚨 [{severity}] {alert_type} on {camera_id} | Track #{track_id} | Conf: {confidence:.2f}")

        return alert_payload

    def get_pending_queue(self):
        return self.offline_queue

    def clear_queue(self):
        self.offline_queue.clear()
