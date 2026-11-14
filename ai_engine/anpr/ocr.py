import cv2
import re
import numpy as np
import time

class ANPRProcessor:
    """
    Automatic Number Plate Recognition (ANPR) pipeline.
    Preprocesses vehicle crops, executes OCR, validates Indian plate formats,
    and checks against the watchlist/blacklist database.
    """
    def __init__(self, easyocr_reader=None):
        if easyocr_reader is None:
            import easyocr
            self.reader = easyocr.Reader(['en'], gpu=False)
        else:
            self.reader = easyocr_reader
            
        # Regex patterns for Indian license plates
        self.plate_pattern = re.compile(
            r'^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$|^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$'
        )
        
        # Blacklisted vehicles database for border security
        self.blacklist = {
            "RJ14AB1234": {"reason": "Suspected border smuggling vehicle", "severity": "CRITICAL"},
            "DL01CA9999": {"reason": "Stolen vehicle watchlist", "severity": "HIGH"},
            "PB02AX5555": {"reason": "High-risk border transit watchlist", "severity": "CRITICAL"},
            "HR26DQ5555": {"reason": "Surveillance watch - illegal transport", "severity": "HIGH"}
        }
        
        self.reported_plates = {} # plate -> last_reported_timestamp

    def preprocess(self, crop_bgr):
        h, w = crop_bgr.shape[:2]
        if h < 50 or w < 140:
            scale = 2
            crop_bgr = cv2.resize(crop_bgr, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)
            
        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)
        filtered = cv2.bilateralFilter(enhanced, 7, 50, 50)
        return filtered

    def clean_text(self, text):
        clean = re.sub(r'[^A-Za-z0-9]', '', text.upper())
        return clean

    def read_plate(self, vehicle_crop):
        """
        Reads plate text from vehicle crop.
        Returns plate metadata dict or None if no valid text found.
        """
        if vehicle_crop is None or vehicle_crop.size == 0:
            return None
            
        processed = self.preprocess(vehicle_crop)
        try:
            results = self.reader.readtext(processed, allowlist='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
        except Exception:
            return None
            
        best_plate = ""
        best_conf = 0.0
        
        for bbox, text, conf in results:
            clean = self.clean_text(text)
            if len(clean) >= 6 and conf > best_conf:
                best_conf = conf
                best_plate = clean
                
        if not best_plate:
            return None
            
        is_valid_format = bool(self.plate_pattern.match(best_plate))
        now = time.time()
        
        # Check blacklist
        is_blacklisted = best_plate in self.blacklist
        blacklist_info = self.blacklist.get(best_plate, None)
        
        # Debounce: Report same plate at most once every 120 seconds
        last_reported = self.reported_plates.get(best_plate, 0)
        should_alert = (now - last_reported) >= 120
        if should_alert:
            self.reported_plates[best_plate] = now
            
        return {
            "plate": best_plate,
            "confidence": round(float(best_conf), 2),
            "isValidFormat": is_valid_format,
            "isBlacklisted": is_blacklisted,
            "blacklistInfo": blacklist_info,
            "shouldAlert": should_alert
        }
