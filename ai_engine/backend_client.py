import requests
import json
import time

class BackendClient:
    """
    Communicates with the IBVAP FastAPI backend.
    Sends alerts, detections, plate reads, and heartbeats.
    Includes offline queueing so AI engine never crashes if backend is down.
    """
    def __init__(self, backend_url="http://localhost:8000"):
        self.backend_url = backend_url.rstrip("/")
        self.is_connected = False
        self.offline_queue = []

    def post_alert(self, alert_payload):
        url = f"{self.backend_url}/api/ingest/alert"
        try:
            r = requests.post(url, json=alert_payload, timeout=2.0)
            if r.status_code in (200, 201):
                self.is_connected = True
                self._flush_queue()
                return True
        except Exception:
            pass
        self.is_connected = False
        self.offline_queue.append(("alert", alert_payload))
        return False

    def post_plate_read(self, plate_payload):
        url = f"{self.backend_url}/api/ingest/plate-read"
        try:
            r = requests.post(url, json=plate_payload, timeout=2.0)
            if r.status_code in (200, 201):
                return True
        except Exception:
            pass
        self.offline_queue.append(("plate", plate_payload))
        return False

    def post_detections(self, detections_payload):
        url = f"{self.backend_url}/api/ingest/detections"
        try:
            requests.post(url, json=detections_payload, timeout=0.5)
        except Exception:
            pass

    def send_camera_status(self, cam_id, status="online", fps=25.0, visibility="clear", is_night=False):
        url = f"{self.backend_url}/api/ingest/camera-status"
        try:
            requests.post(url, json={
                "cameraId": cam_id,
                "status": status,
                "fps": fps,
                "visibility": visibility,
                "isNightMode": is_night
            }, timeout=1.0)
        except Exception:
            pass

    def _flush_queue(self):
        if not self.offline_queue:
            return
        to_retry = list(self.offline_queue)
        self.offline_queue.clear()
        for item_type, payload in to_retry:
            if item_type == "alert":
                self.post_alert(payload)
            elif item_type == "plate":
                self.post_plate_read(payload)
