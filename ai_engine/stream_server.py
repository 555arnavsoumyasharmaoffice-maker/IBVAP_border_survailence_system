import cv2
import time
import threading
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

app = FastAPI(title="IBVAP Live Video Stream Server")

# Allow all origins so React Dashboard can consume streams without CORS errors
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global dict of camera streams and latest annotated frames
CAMERA_FRAMES = {} # camera_id -> latest_annotated_frame (numpy array)
CAMERA_METRICS = {} # camera_id -> dict(fps, is_online, last_seen)

def update_stream_frame(camera_id, frame, fps=0.0):
    CAMERA_FRAMES[camera_id] = frame
    CAMERA_METRICS[camera_id] = {
        "fps": fps,
        "is_online": True,
        "last_seen": time.time()
    }

def generate_mjpeg(camera_id):
    while True:
        frame = CAMERA_FRAMES.get(camera_id, None)
        if frame is not None:
            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if ret:
                frame_bytes = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.04) # ~25 FPS

@app.get("/stream/{camera_id}")
def video_stream(camera_id: str):
    return StreamingResponse(
        generate_mjpeg(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

@app.get("/snapshot/{camera_id}")
def get_snapshot(camera_id: str):
    frame = CAMERA_FRAMES.get(camera_id, None)
    if frame is not None:
        ret, buffer = cv2.imencode('.jpg', frame)
        if ret:
            return Response(content=buffer.tobytes(), media_type="image/jpeg")
    return Response(status_code=404, content="Camera frame not available")

@app.get("/health")
def health_status():
    return {
        "status": "ONLINE",
        "service": "IBVAP Stream Server",
        "port": 8001,
        "cameras": CAMERA_METRICS
    }

def start_stream_server(host="0.0.0.0", port=8001):
    import uvicorn
    server_thread = threading.Thread(
        target=lambda: uvicorn.run(app, host=host, port=port, log_level="warning"),
        daemon=True
    )
    server_thread.start()
    print(f"[StreamServer] Running MJPEG stream server at http://localhost:{port}")
