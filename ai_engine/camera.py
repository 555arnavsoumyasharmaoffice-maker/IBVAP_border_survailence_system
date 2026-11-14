import cv2
import threading
import time
import os

class CameraStream:
    """
    Threaded Camera Stream reader for RTSP, webcam, or video files.
    Ensures zero buffer lag buildup by reading continuously in a background thread
    and keeping only the latest frame. Seamlessly loops video files.
    """
    def __init__(self, camera_id, name, source, width=640, height=480):
        self.camera_id = camera_id
        self.name = name
        self.source = source
        self.is_file = isinstance(source, str) and os.path.exists(source)
        
        self.cap = None
        self.latest_frame = None
        self.is_running = False
        self.lock = threading.Lock()
        
        self.fps = 0.0
        self.frame_count = 0
        self.last_fps_time = time.time()
        self.is_online = False
        
        self._open_source()

    def _open_source(self):
        if self.cap is not None:
            self.cap.release()
            
        # If integer string, convert to int for webcam
        src = self.source
        if isinstance(src, str) and src.isdigit():
            src = int(src)
            
        self.cap = cv2.VideoCapture(src)
        if self.cap.isOpened():
            self.is_online = True
            ret, frame = self.cap.read()
            if ret:
                with self.lock:
                    self.latest_frame = frame
        else:
            self.is_online = False
            print(f"[{self.name}] Warning: Could not open source {self.source}")

    def start(self):
        if self.is_running:
            return self
        self.is_running = True
        self.thread = threading.Thread(target=self._update_loop, daemon=True)
        self.thread.start()
        return self

    def _update_loop(self):
        while self.is_running:
            if not self.cap or not self.cap.isOpened():
                time.sleep(1.0)
                self._open_source()
                continue
                
            ret, frame = self.cap.read()
            if ret:
                with self.lock:
                    self.latest_frame = frame
                self.frame_count += 1
                self.is_online = True
                
                # Update FPS every 1 second
                now = time.time()
                elapsed = now - self.last_fps_time
                if elapsed >= 1.0:
                    self.fps = round(self.frame_count / elapsed, 1)
                    self.frame_count = 0
                    self.last_fps_time = now
            else:
                if self.is_file:
                    # Video ended -> Loop from start
                    self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                else:
                    self.is_online = False
                    time.sleep(0.5)
                    self._open_source()
            
            # Small sleep to yield CPU
            time.sleep(0.005)

    def read(self):
        with self.lock:
            if self.latest_frame is not None:
                return True, self.latest_frame.copy()
            return False, None

    def stop(self):
        self.is_running = False
        if hasattr(self, 'thread') and self.thread.is_alive():
            self.thread.join(timeout=1.0)
        if self.cap:
            self.cap.release()
        self.is_online = False
