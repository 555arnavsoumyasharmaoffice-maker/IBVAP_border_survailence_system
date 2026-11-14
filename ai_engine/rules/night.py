import cv2
import numpy as np

class NightVisionRule:
    """
    Automatic low-light / night detection and CLAHE contrast enhancement.
    Improves detection and tracking accuracy during nighttime or foggy border conditions.
    """
    def __init__(self, brightness_threshold=45, clahe_clip_limit=3.0):
        self.brightness_threshold = brightness_threshold
        self.clahe = cv2.createCLAHE(clipLimit=clahe_clip_limit, tileGridSize=(8, 8))

    def process(self, frame):
        """
        Computes mean luminance. If low-light, applies CLAHE enhancement.
        Returns: (processed_frame, is_night_mode, mean_brightness)
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        mean_brightness = float(np.mean(gray))
        
        is_night = mean_brightness < self.brightness_threshold
        if is_night:
            # LAB color space: apply CLAHE only to L (Luminance) channel
            lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            l_enhanced = self.clahe.apply(l)
            enhanced = cv2.merge((l_enhanced, a, b))
            enhanced_bgr = cv2.cvtColor(enhanced, cv2.COLOR_LAB2BGR)
            return enhanced_bgr, True, round(mean_brightness, 1)
            
        return frame, False, round(mean_brightness, 1)
