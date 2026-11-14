import torch
from ultralytics import YOLO
import supervision as sa

class ObjectDetector:
    """
    Ultralytics YOLO inference wrapper for border surveillance.
    Supports GPU acceleration, class filtering, and domestic animal classification.
    """
    def __init__(self, model_name="yolov8s.pt", imgsz=640, conf=0.45):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[Detector] Initializing YOLO ({model_name}) on device: {self.device}")
        self.model = YOLO(model_name)
        self.imgsz = imgsz
        self.conf = conf
        
        # Target classes to monitor for border intrusion
        self.target_classes = {'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle'}
        # Domestic animals to classify and exclude from intrusion alarms
        self.animal_classes = {'dog', 'cat', 'horse', 'sheep', 'cow', 'bird'}

    def detect(self, frame, custom_conf=None):
        """
        Runs inference and returns supervision.Detections object with custom metadata.
        """
        conf_threshold = custom_conf if custom_conf is not None else self.conf
        results = self.model(
            frame, 
            imgsz=self.imgsz, 
            conf=conf_threshold, 
            device=self.device, 
            verbose=False
        )[0]
        
        # Convert to supervision format
        detections = sa.Detections.from_ultralytics(results)
        if len(detections) == 0:
            return detections, []
            
        class_names = [self.model.names[cid] for cid in detections.class_id]
        
        # Keep only targets and animals
        valid_indices = [
            i for i, name in enumerate(class_names) 
            if name in self.target_classes or name in self.animal_classes
        ]
        
        if len(valid_indices) == 0:
            return detections[:0], []
            
        filtered_detections = detections[valid_indices]
        filtered_names = [class_names[i] for i in valid_indices]
        
        return filtered_detections, filtered_names
