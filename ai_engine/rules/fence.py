import numpy as np
import time
import supervision as sa

class VirtualFenceRule:
    """
    Virtual Fence and Perimeter Intrusion detection.
    Supports normalized polygon zones, consecutive frame confirmation (anti-false-alarm),
    and track cooldowns. Ignores domestic animals.
    """
    def __init__(self, zone_name="Restricted Border Zone", normalized_points=None, min_frames=6, cooldown_sec=60):
        self.zone_name = zone_name
        # Default restricted zone (normalized: bottom half/center of view)
        self.normalized_points = normalized_points if normalized_points is not None else [
            [0.10, 0.45],
            [0.90, 0.45],
            [0.90, 0.95],
            [0.10, 0.95]
        ]
        self.min_frames = min_frames
        self.cooldown_sec = cooldown_sec
        
        self.track_frame_count = {}   # track_id -> count of consecutive frames inside
        self.last_alert_time = {}     # track_id -> timestamp
        
        self.polygon_zone = None
        self.zone_annotator = None
        self.last_frame_shape = None

    def _setup_zone(self, frame_shape):
        h, w = frame_shape[:2]
        pts = np.array(self.normalized_points)
        pixel_polygon = (pts * np.array([w, h])).astype(int)
        
        self.polygon_zone = sa.PolygonZone(polygon=pixel_polygon)
        self.zone_annotator = sa.PolygonZoneAnnotator(
            zone=self.polygon_zone,
            color=sa.Color.RED,
            thickness=2,
            text_scale=0.6
        )
        self.last_frame_shape = (h, w)

    def evaluate(self, frame, detections, class_names, animal_classes, camera_id="cam-bop-01"):
        """
        Evaluates detections against virtual fence.
        Returns triggered intrusion details if conditions are met.
        """
        if self.polygon_zone is None or self.last_frame_shape != frame.shape[:2]:
            self._setup_zone(frame.shape)
            
        triggered_intrusions = []
        if len(detections) == 0 or detections.tracker_id is None:
            return triggered_intrusions

        is_inside_mask = self.polygon_zone.trigger(detections=detections)
        now = time.time()
        h, w = frame.shape[:2]

        for idx, (tid, is_in, cname) in enumerate(zip(detections.tracker_id, is_inside_mask, class_names)):
            if tid is None:
                continue
                
            # Rule: Domestic animals never trigger intrusion alerts
            if cname in animal_classes:
                continue
                
            if is_in:
                self.track_frame_count[tid] = self.track_frame_count.get(tid, 0) + 1
                
                # Check persistence threshold
                if self.track_frame_count[tid] >= self.min_frames:
                    last_time = self.last_alert_time.get(tid, 0)
                    if (now - last_time) >= self.cooldown_sec:
                        self.last_alert_time[tid] = now
                        bbox = detections.xyxy[idx]
                        
                        # Normalized bbox: [xmin, ymin, xmax, ymax]
                        norm_bbox = [
                            round(float(bbox[0]) / w, 4),
                            round(float(bbox[1]) / h, 4),
                            round(float(bbox[2]) / w, 4),
                            round(float(bbox[3]) / h, 4)
                        ]
                        
                        intrusion = {
                            "cameraId": camera_id,
                            "type": "FENCE_INTRUSION",
                            "severity": "CRITICAL",
                            "trackId": int(tid),
                            "confidence": round(float(detections.confidence[idx]), 2),
                            "bbox": norm_bbox,
                            "pixel_bbox": [int(b) for b in bbox],
                            "details": {
                                "zoneName": self.zone_name,
                                "consecutiveFrames": self.track_frame_count[tid],
                                "objectClass": cname,
                                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
                            }
                        }
                        triggered_intrusions.append(intrusion)
            else:
                self.track_frame_count[tid] = 0
                
        return triggered_intrusions

    def draw(self, frame):
        if self.zone_annotator and self.polygon_zone:
            return self.zone_annotator.annotate(scene=frame)
        return frame
