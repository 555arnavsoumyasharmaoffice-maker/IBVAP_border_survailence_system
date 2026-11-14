import time

class LoiteringRule:
    """
    Loitering detection for border surveillance.
    Alerts when an individual stays inside a sensitive zone longer than threshold (default 30s).
    """
    def __init__(self, threshold_seconds=30, cooldown_seconds=90):
        self.threshold_seconds = threshold_seconds
        self.cooldown_seconds = cooldown_seconds
        self.track_start_time = {}
        self.last_alert_time = {}

    def evaluate(self, detections, class_names, camera_id="cam-bop-01"):
        now = time.time()
        alerts = []
        
        if len(detections) == 0 or detections.tracker_id is None:
            return alerts

        for idx, (tid, cname) in enumerate(zip(detections.tracker_id, class_names)):
            if tid is None or cname != 'person':
                continue
                
            if tid not in self.track_start_time:
                self.track_start_time[tid] = now
                
            dwell_time = now - self.track_start_time[tid]
            if dwell_time >= self.threshold_seconds:
                last_alert = self.last_alert_time.get(tid, 0)
                if (now - last_alert) >= self.cooldown_seconds:
                    self.last_alert_time[tid] = now
                    bbox = detections.xyxy[idx]
                    alerts.append({
                        "cameraId": camera_id,
                        "type": "LOITERING",
                        "severity": "HIGH",
                        "trackId": int(tid),
                        "confidence": round(float(detections.confidence[idx]), 2),
                        "details": {
                            "dwellTimeSeconds": round(dwell_time, 1),
                            "objectClass": "person",
                            "note": f"Target lingered for {int(dwell_time)}s near border perimeter"
                        }
                    })
        return alerts
