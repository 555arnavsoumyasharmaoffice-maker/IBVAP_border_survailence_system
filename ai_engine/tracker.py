import supervision as sa

class ObjectTracker:
    """
    ByteTrack wrapper using the supervision library.
    Provides persistent track IDs across frames and handles visual annotations.
    """
    def __init__(self, track_thresh=0.25, track_buffer=30, match_thresh=0.8):
        self.tracker = sa.ByteTrack(
            track_activation_threshold=track_thresh,
            lost_track_buffer=track_buffer,
            minimum_matching_threshold=match_thresh
        )
        self.box_annotator = sa.BoxAnnotator(thickness=2)
        self.label_annotator = sa.LabelAnnotator(text_scale=0.5, text_thickness=1)
        self.trace_annotator = sa.TraceAnnotator(thickness=2, trace_length=25)

    def update(self, detections):
        """
        Updates tracks with fresh detections and assigns tracker_id.
        """
        if len(detections) == 0:
            return detections
        return self.tracker.update_with_detections(detections)

    def annotate(self, frame, detections, labels):
        """
        Draws bounding boxes, labels, and motion traces on the frame.
        """
        annotated = frame.copy()
        if len(detections) > 0 and detections.tracker_id is not None:
            annotated = self.box_annotator.annotate(scene=annotated, detections=detections)
            annotated = self.label_annotator.annotate(scene=annotated, detections=detections, labels=labels)
            annotated = self.trace_annotator.annotate(scene=annotated, detections=detections)
        return annotated
