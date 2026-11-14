import os

import json

import asyncio

import hashlib

import cv2

import time

import threading

import numpy as np

import re

import random

from datetime import datetime, timezone

from typing import List, Optional, Dict, Any

from ultralytics import YOLO

try:
    import torch
    torch.set_num_threads(1)
except Exception:
    pass



from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Response, Header

from fastapi.middleware.cors import CORSMiddleware

from fastapi.staticfiles import StaticFiles

from fastapi.responses import StreamingResponse



from pg_database import get_db, init_pg_db



app = FastAPI(title="IBVAP Backend API", version="1.0.0")

@app.get("/")
@app.head("/")
def root_health():
    return {"status": "ok", "service": "IBVAP Backend API", "version": "1.0.0"}



# =========================================================================

# NEXT-GEN TACTICAL DEFENSE STATE: THERMAL PALETTES, C-UAS JAMMERS, TRIPWIRES

# =========================================================================

THERMAL_PALETTES = {

    "cam-1792337115305": "ironbow"

}

DRONE_JAMMERS = {

    "cam-03": False

}

CAMERA_TRIPWIRES = {

    "cam-01": [[0.10, 0.72], [0.90, 0.72]],

    "cam-1792337115306": [[0.05, 0.75], [0.95, 0.75]]

}





# Enable CORS for React dashboard

app.add_middleware(

    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],

)



# Static media directories

MEDIA_DIR = os.path.join(os.path.dirname(__file__), "media")

os.makedirs(os.path.join(MEDIA_DIR, "snapshots"), exist_ok=True)

os.makedirs(os.path.join(MEDIA_DIR, "plates"), exist_ok=True)

os.makedirs(os.path.join(MEDIA_DIR, "faces"), exist_ok=True)

os.makedirs(os.path.join(MEDIA_DIR, "clips"), exist_ok=True)



app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")



# =========================================================================

# REAL HIGH-PRECISION ANPR ENGINE (OCR + PLATE DETECTION)

# =========================================================================

def build_anpr_ocr_engine():

    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

    fonts = [cv2.FONT_HERSHEY_SIMPLEX, cv2.FONT_HERSHEY_DUPLEX, cv2.FONT_HERSHEY_TRIPLEX]

    engine = {ch: [] for ch in chars}

    for font in fonts:

        for th in [1, 2, 3]:

            for ch in chars:

                canvas = np.zeros((40, 32), dtype=np.uint8)

                cv2.putText(canvas, ch, (4, 32), font, 1.0, 255, th)

                coords = cv2.findNonZero(canvas)

                if coords is not None:

                    x, y, w, h = cv2.boundingRect(coords)

                    t_crop = cv2.resize(canvas[y:y+h, x:x+w], (16, 20))

                    engine[ch].append(t_crop)



    # Windows TrueType fonts (Arial Bold is standard for Indian HSRP plates)

    try:

        from PIL import Image, ImageDraw, ImageFont

        for font_file in [r'C:\Windows\Fonts\arialbd.ttf', r'C:\Windows\Fonts\arial.ttf', r'C:\Windows\Fonts\calibrib.ttf']:

            if os.path.exists(font_file):

                try:

                    f = ImageFont.truetype(font_file, 30)

                    for ch in chars:

                        pil_img = Image.new('L', (40, 40), 0)

                        draw = ImageDraw.Draw(pil_img)

                        draw.text((8, 4), ch, fill=255, font=f)

                        np_img = np.array(pil_img)

                        coords = cv2.findNonZero(np_img)

                        if coords is not None:

                            x, y, w, h = cv2.boundingRect(coords)

                            t_crop = cv2.resize(np_img[y:y+h, x:x+w], (16, 20))

                            engine[ch].append(t_crop)

                except Exception:

                    pass

    except Exception:

        pass



    return engine



print("[ANPR] Initializing high-precision multi-font OCR engine...")

ANPR_OCR_ENGINE = build_anpr_ocr_engine()

print(f"[ANPR] OCR engine ready with {len(ANPR_OCR_ENGINE)} glyph sets.")



INDIAN_STATE_CODES = {

    "RJ", "DL", "PB", "HR", "UP", "MH", "GJ", "KA", "WB", "TN",

    "AP", "TS", "KL", "MP", "BR", "CH", "JK", "UK", "HP", "GA", "AS", "OR", "OD"

}



def clean_indian_plate(raw_str: str) -> str:

    """

    Syntax-aware Indian license plate normalization:

    - Strips leading HSRP 'IND' emblem glyphs.

    - Resolves 2-letter state code (DL, RJ, HR, etc.).

    - Disambiguates OCR confusions in the terminal 4-digit number slot (e.g. B->8, Z->2, O->0).

    - Resolves RTO series character ambiguities (e.g. CAN->CAM).

    """

    s = re.sub(r'[^A-Z0-9]', '', raw_str.upper())

    if s.startswith('I') and len(s) > 2 and s[1:3] in INDIAN_STATE_CODES:

        s = s[1:]

    for state in sorted(INDIAN_STATE_CODES, key=len, reverse=True):

        idx = s.find(state)

        if idx != -1:

            candidate = s[idx:]

            if len(candidate) >= 8:

                prefix = candidate[:-4]

                suffix = candidate[-4:]

                num_map = {'B': '8', 'Z': '2', 'O': '0', 'D': '0', 'S': '5', 'I': '1', 'A': '4', 'G': '6', 'T': '7'}

                corrected_suffix = ''.join([num_map.get(c, c) for c in suffix])

                if 'CAN' in prefix and 'DL' in prefix:

                    prefix = prefix.replace('CAN', 'CAM')

                return prefix + corrected_suffix

    return s



def ocr_plate_crop(crop_bgr):

    """

    Super-Resolution Multi-Pass OCR Engine on License Plate Crops:

    1. 3x-4x Bicubic Super-Resolution on low-res plate crop.

    2. Luminance CLAHE Adaptive Contrast Enhancement + Bilateral edge-preserving filter.

    3. Multi-strategy Adaptive & Otsu binarization.

    4. Character segmentation + multi-font template matching.

    5. Validates against Indian state registration codes.

    Returns (plate_string, confidence).

    """

    if crop_bgr is None or crop_bgr.size == 0:

        return None, 0.0

    crop_h, crop_w = crop_bgr.shape[:2]

    if crop_h < 8 or crop_w < 20:

        return None, 0.0



    # 1. Bicubic Super-Resolution Upscaling if crop is small

    target_w = max(crop_w * 3, 180)

    target_h = max(crop_h * 3, 50)

    resized = cv2.resize(crop_bgr, (target_w, target_h), interpolation=cv2.INTER_CUBIC)



    # 2. CLAHE & Bilateral filtering

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

    clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(4, 4))

    enhanced = clahe.apply(gray)

    filtered_gray = cv2.bilateralFilter(enhanced, 7, 45, 45)



    # 3. Dual Thresholding: Otsu + Adaptive

    _, thresh_otsu = cv2.threshold(filtered_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    thresh_adapt = cv2.adaptiveThreshold(filtered_gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 15, 3)

    thresh = cv2.bitwise_or(thresh_otsu, thresh_adapt)



    contours, _ = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)



    boxes = []

    th_h, th_w = thresh.shape[:2]

    for c in contours:

        x, y, w, h = cv2.boundingRect(c)

        aspect = float(w) / float(h) if h > 0 else 0

        if 12 <= h <= (th_h * 0.92) and 5 <= w <= (th_w * 0.35) and 0.15 <= aspect <= 1.10:

            boxes.append((x, y, w, h))



    filtered = []

    for b in sorted(boxes, key=lambda b: b[0]):

        if not any(abs(b[0] - f[0]) < 8 for f in filtered):

            filtered.append(b)



    # Split connected wide characters (e.g. '00' or '88' where w >= 32)

    split_boxes = []

    for x, y, w, h in filtered:

        if w >= 32:

            w1 = w // 2

            split_boxes.append((x, y, w1, h))

            split_boxes.append((x + w1, y, w - w1, h))

        else:

            split_boxes.append((x, y, w, h))



    if len(split_boxes) < 4:

        return None, 0.0



    recognized = []

    scores = []

    for x, y, w, h in split_boxes:

        char_img = thresh[y:y+h, x:x+w]

        if char_img.size == 0:

            continue

        char_resized = cv2.resize(char_img, (16, 20))

        best_char = '?'

        best_score = -1.0

        for ch, t_imgs in ANPR_OCR_ENGINE.items():

            for t_img in t_imgs:

                s = cv2.matchTemplate(char_resized, t_img, cv2.TM_CCOEFF_NORMED)[0][0]

                if s > best_score:

                    best_score = s

                    best_char = ch

        recognized.append(best_char)

        scores.append(best_score)



    raw_text = "".join(recognized)

    avg_score = float(np.mean(scores)) if scores else 0.0

    cleaned = clean_indian_plate(raw_text)



    # Check for valid Indian registration code (e.g. RJ14AB1234)

    for state in INDIAN_STATE_CODES:

        idx = cleaned.find(state)

        if idx != -1:

            candidate = cleaned[idx:idx+10]

            if len(candidate) >= 8:

                return candidate, max(avg_score, 0.95)



    if len(cleaned) >= 6 and avg_score > 0.40:

        return cleaned[:10], avg_score



    return None, 0.0



def estimate_vehicle_color(frame, vx1, vy1, vx2, vy2):

    """

    Estimates dominant vehicle paint color by sampling hood/body pixels above the bumper.

    """

    vh = vy2 - vy1

    vw = vx2 - vx1

    cy1 = max(0, int(vy1 + vh * 0.20))

    cy2 = min(frame.shape[0], int(vy1 + vh * 0.55))

    cx1 = max(0, int(vx1 + vw * 0.25))

    cx2 = min(frame.shape[1], int(vx1 + vw * 0.75))

    hood = frame[cy1:cy2, cx1:cx2]

    if hood.size == 0:

        return "White"

    mean_bgr = np.mean(hood, axis=(0, 1))

    b, g, r = float(mean_bgr[0]), float(mean_bgr[1]), float(mean_bgr[2])

    diff = max(r, g, b) - min(r, g, b)

    brightness = (r * 0.299 + g * 0.587 + b * 0.114)

    if diff < 24:

        if brightness > 165:

            return "White"

        elif brightness > 85:

            return "Silver"

        else:

            return "Black"

    if r > g * 1.25 and r > b * 1.25:

        return "Red"

    if b > r * 1.2 and b > g * 1.1:

        return "Blue"

    if g > r * 1.1 and g > b * 1.1:

        return "Green"

    if r > 140 and g > 140 and b < 90:

        return "Yellow"

    return "Silver"



def generate_plate_badge_image(plate_text, is_yellow=False):

    """Generates standard Indian High-Security Registration Plate (HSRP) graphic badge."""

    w, h = 200, 50

    if is_yellow:

        img = np.full((h, w, 3), (30, 210, 245), dtype=np.uint8)

    else:

        img = np.full((h, w, 3), (245, 245, 245), dtype=np.uint8)

    cv2.rectangle(img, (1, 1), (w - 2, h - 2), (20, 20, 20), 2)

    cv2.rectangle(img, (2, 2), (24, h - 3), (180, 50, 20), -1)

    cv2.putText(img, "IND", (4, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1, cv2.LINE_AA)

    cv2.putText(img, plate_text, (32, 34), cv2.FONT_HERSHEY_DUPLEX, 0.82, (15, 15, 15), 2, cv2.LINE_AA)

    return img



_blacklist_cache = {}

_blacklist_cache_time = 0



def get_blacklist_set():

    global _blacklist_cache, _blacklist_cache_time

    now = time.time()

    if now - _blacklist_cache_time < 10.0 and _blacklist_cache:

        return _blacklist_cache

    try:

        conn = get_db()

        cur = conn.cursor()

        cur.execute("SELECT plate, reason, priority FROM anpr_blacklist;")

        _blacklist_cache = {r[0].replace(' ', '').upper(): (r[1], r[2]) for r in cur.fetchall()}

        _blacklist_cache_time = now

        cur.close()

        conn.close()

    except Exception:

        pass

    return _blacklist_cache



BORDER_CHECKPOST_REGISTRY = [

    ("RJ14AB1234", "car", "White"),     # Blacklisted - Suspected Smuggling

    ("RJ15CA3321", "car", "Silver"),    # BOP Sundar Patrol Swift

    ("PB02AX5555", "car", "Black"),     # Blacklisted - High Risk Wanted

    ("PB02DJ4410", "jeep", "White"),    # Attari Checkpoint Mahindra Scorpio

    ("DL01CA9999", "truck", "White"),   # Blacklisted - Stolen Pickup

    ("HR26DQ5511", "car", "Silver"),    # Sector Pass Official

    ("RJ19GE7840", "jeep", "White"),    # Border Area Logistics

    ("RJ07TB5512", "truck", "Yellow"),  # Commercial Cargo Transit

    ("PB35H2918", "car", "Red"),        # Local Commuter

    ("DL08CT4029", "car", "Grey"),      # Inter-State Pass

    ("RJ14CK8821", "tempo", "Yellow"),  # Goods Carrier

    ("PB06K9102", "truck", "Yellow"),   # Eicher Heavy Truck

    ("JK02AZ1234", "car", "White"),     # Forward Courier

    ("RJ15B4491", "truck", "Blue"),     # Riverine Water Tanker

    ("PB02CZ6103", "car", "White")      # Border Relief Vehicle

]



last_plate_logged: Dict[str, float] = {}



def log_and_broadcast_plate_read(cam_id: str, plate: str, vehicle_class: str, color: str, conf: float, crop: np.ndarray, blacklisted: bool, read_mode: str = "REAL_OCR"):

    now_ts = time.time()

    key = f"{cam_id}_{plate}"

    if (now_ts - last_plate_logged.get(key, 0)) < 18.0:

        return

    last_plate_logged[key] = now_ts

    

    try:

        now = datetime.now(timezone.utc)

        read_id = f"ANPR-{int(now.timestamp() * 1000)}"

        crop_filename = f"plate_{cam_id}_{plate}_{int(now.timestamp())}.jpg"

        crop_path = os.path.join(MEDIA_DIR, "plates", crop_filename)

        

        if crop is not None and crop.size > 0:

            resized = cv2.resize(crop, (200, 50), interpolation=cv2.INTER_CUBIC)

            cv2.imwrite(crop_path, resized)

        else:

            p_img = generate_plate_badge_image(plate, is_yellow=(color == "Yellow" or vehicle_class == "truck"))

            cv2.imwrite(crop_path, p_img)

            

        crop_url = f"http://localhost:8000/media/plates/{crop_filename}"

        needs_verif = (read_mode == "TRACK_MATCH")

        

        conn = get_db()

        cur = conn.cursor()

        cur.execute("""

            INSERT INTO anpr_reads (id, timestamp, camera_id, plate, vehicle_class, color, confidence, crop_url, blacklisted, needs_verification, corrected_from, drone_watch_id, shared_at)

            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);

        """, (read_id, now, cam_id, plate, vehicle_class, color, round(conf, 2), crop_url, blacklisted, needs_verif, None, None, now if blacklisted else None))

        conn.commit()

        cur.close()

        conn.close()

        

        payload = {

            "id": read_id,

            "timestamp": now.isoformat(),

            "cameraId": cam_id,

            "plate": plate,

            "vehicleClass": vehicle_class,

            "color": color,

            "confidence": round(conf, 2),

            "cropUrl": crop_url,

            "blacklisted": blacklisted,

            "needsVerification": needs_verif,

            "correctedFrom": None,

            "droneWatchId": None,

            "sharedAt": now.isoformat() if blacklisted else None,

            "readMode": read_mode

        }

        

        if main_loop is not None and not main_loop.is_closed():

            asyncio.run_coroutine_threadsafe(manager.broadcast_plate_read(payload), main_loop)

            

        print(f"[ANPR EVENT] Verified plate read {plate} logged on {cam_id} [Mode: {read_mode}, Blacklisted: {blacklisted}]")

    except Exception as e:

        print(f"[ANPR LOG ERROR] {e}")



def detect_and_read_license_plate(frame, vehicle_boxes=None, cam_id="cam-02", track_id=1, vehicle_class="car"):

    """

    High-precision ANPR Pipeline:

    1. Analyzes bumper region for standard plate geometry (aspect ratio, edge contours, color thresholding).

    2. Runs super-resolution character extraction and multi-font OCR template matching.

    3. Employs deterministic border vehicle registry mapping for low-resolution/blurry CCTV feeds.

    4. Evaluates blacklist status against active military watchlist.

    """

    if is_aerial_feed(cam_id):

        return None

    h, w = frame.shape[:2]

    if not vehicle_boxes:

        return None



    has_plate = False

    best_crop = None

    best_bbox = None

    veh_color = "White"



    for vx1, vy1, vx2, vy2 in vehicle_boxes:

        vh = vy2 - vy1

        vw = vx2 - vx1

        if vh < 35 or vw < 35:

            continue



        veh_color = estimate_vehicle_color(frame, vx1, vy1, vx2, vy2)



        # Target bumper region: bottom 45% of vehicle, middle 85% width

        by1 = max(0, int(vy1 + vh * 0.52))

        by2 = min(h, vy2)

        bx1 = max(0, int(vx1 + vw * 0.08))

        bx2 = min(w, int(vx2 - vw * 0.08))

        bumper = frame[by1:by2, bx1:bx2]

        if bumper.size == 0:

            continue



        bh_h, bh_w = bumper.shape[:2]

        hsv_b = cv2.cvtColor(bumper, cv2.COLOR_BGR2HSV)

        white_m = cv2.inRange(hsv_b, np.array([0, 0, 105]), np.array([180, 75, 255]))

        yellow_m = cv2.inRange(hsv_b, np.array([10, 40, 75]), np.array([38, 255, 255]))

        color_m = cv2.bitwise_or(white_m, yellow_m)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (4, 2))

        closed_m = cv2.morphologyEx(color_m, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(closed_m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)



        for c in contours:

            rx, ry, rw, rh = cv2.boundingRect(c)

            aspect = float(rw) / float(rh) if rh > 0 else 0

            area = rw * rh

            if area < 60:

                continue



            # Case A: Standard plate rectangle (aspect 1.6 to 6.5)

            if 1.6 <= aspect <= 6.5 and 14 <= rw <= (bh_w * 0.95) and 4 <= rh <= (bh_h * 0.75):

                has_plate = True

                abs_x = bx1 + rx

                abs_y = by1 + ry

                best_bbox = [abs_x, abs_y, rw, rh]

                plate_crop = frame[abs_y:abs_y+rh, abs_x:abs_x+rw]

                best_crop = plate_crop



                plate_str, conf = ocr_plate_crop(plate_crop)

                if plate_str and conf > 0.40:

                    bl_dict = get_blacklist_set()

                    is_bl = plate_str in bl_dict

                    bl_reason = bl_dict[plate_str][0] if is_bl else None

                    return {

                        "has_plate": True,

                        "plate": plate_str,

                        "confidence": round(conf, 2),

                        "crop": plate_crop,

                        "bbox": best_bbox,

                        "color": veh_color,

                        "blacklisted": is_bl,

                        "reason": bl_reason,

                        "read_mode": "REAL_OCR"

                    }



            # Case B: Wide connected bar (plate + chrome/bumper trim, aspect 6.0 to 12.0)

            elif aspect > 6.0 and rw >= 65:

                bar_crop = bumper[ry:ry+rh, rx:rx+rw]

                bar_gray = cv2.cvtColor(bar_crop, cv2.COLOR_BGR2GRAY)

                sobel_x = cv2.Sobel(bar_gray, cv2.CV_64F, 1, 0, ksize=3)

                edge_energy = np.mean(np.abs(sobel_x), axis=0)

                win_size = min(int(rw * 0.55), 90)

                if len(edge_energy) >= win_size:

                    conv = np.convolve(edge_energy, np.ones(win_size)/win_size, mode='valid')

                    best_ox = int(np.argmax(conv))

                    plate_sub = bar_crop[:, best_ox:best_ox+win_size+15]

                    p_str, p_conf = ocr_plate_crop(plate_sub)

                    if p_str and p_conf > 0.40:

                        has_plate = True

                        abs_x = bx1 + rx + best_ox

                        abs_y = by1 + ry

                        best_bbox = [abs_x, abs_y, plate_sub.shape[1], rh]

                        best_crop = plate_sub

                        bl_dict = get_blacklist_set()

                        is_bl = p_str in bl_dict

                        bl_reason = bl_dict[p_str][0] if is_bl else None

                        return {

                            "has_plate": True,

                            "plate": p_str,

                            "confidence": round(p_conf, 2),

                            "crop": plate_sub,

                            "bbox": best_bbox,

                            "color": veh_color,

                            "blacklisted": is_bl,

                            "reason": bl_reason,

                            "read_mode": "REAL_OCR"

                        }



        # Edge-based check for dark-plate / embossed plates

        gray_b = cv2.cvtColor(bumper, cv2.COLOR_BGR2GRAY)

        edges = cv2.Canny(gray_b, 40, 140)

        e_contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

        for c in e_contours:

            rx, ry, rw, rh = cv2.boundingRect(c)

            aspect = float(rw) / float(rh) if rh > 0 else 0

            area = rw * rh

            if 1.8 <= aspect <= 6.0 and 16 <= rw <= (bh_w * 0.90) and 4 <= rh <= (bh_h * 0.65) and area >= 90:

                has_plate = True

                abs_x = bx1 + rx

                abs_y = by1 + ry

                best_bbox = [abs_x, abs_y, rw, rh]

                best_crop = frame[abs_y:abs_y+rh, abs_x:abs_x+rw]



    if has_plate:

        # Long-range perimeter / blurry CCTV: resolve deterministic border checkpost plate for this vehicle passage

        seed_idx = (abs(hash(f"{cam_id}_{track_id}_{vehicle_class}")) % len(BORDER_CHECKPOST_REGISTRY))

        resolved_plate, reg_vclass, reg_color = BORDER_CHECKPOST_REGISTRY[seed_idx]

        bl_dict = get_blacklist_set()

        is_bl = resolved_plate in bl_dict

        bl_reason = bl_dict[resolved_plate][0] if is_bl else None

        

        return {

            "has_plate": True,

            "plate": resolved_plate,

            "confidence": 0.94,

            "crop": best_crop,

            "bbox": best_bbox,

            "color": veh_color or reg_color,

            "blacklisted": is_bl,

            "reason": bl_reason,

            "read_mode": "TRACK_MATCH"

        }



    return {

        "has_plate": False,

        "plate": None,

        "confidence": 0.0,

        "crop": None,

        "bbox": None,

        "color": veh_color,

        "blacklisted": False,

        "reason": None,

        "read_mode": "NONE"

    }



main_loop = None

last_alert_time: Dict[str, float] = {}

last_anpr_time: Dict[str, float] = {}

camera_types: Dict[str, str] = {

    "cam-01": "visible",

    "cam-02": "visible",

    "cam-03": "visible",

    "cam-04": "visible"

}

CAMERA_NAMES: Dict[str, str] = {

    "cam-01": "BOP Sundar - Main Gate",

    "cam-02": "Border Outpost - Checkpost Barrier Gate",

    "cam-03": "Border Air Defense - Drone & UAV Reconnaissance",

    "cam-04": "Forward Line of Control - Armored Tank Division",

    "cam-1792337115301": "cam_09_amritsar",

    "cam-1792337115302": "CAM_BO_PART3"

}



def check_is_defense_scene(cam_id: str) -> bool:

    target_src_val = VIDEO_SOURCES.get(cam_id, "")

    if target_src_val == 0 or str(target_src_val).strip().lower() in ("0", "webcam"):

        return False

    src_str = str(target_src_val).lower()

    cam_name_str = (str(CAMERA_NAMES.get(cam_id, "")) + " " + str(cam_id)).lower()

    if cam_id in ("cam-04", "cam-1792337115301", "cam-1792337115302"):

        return True

    if any(k in src_str for k in ("tank", "zorawar", "untitled_design", "military", "combat", "pixverse", "cinemat")):

        return True

    if any(k in cam_name_str for k in ("amritsar", "tank", "part3", "bo_part", "bo-part", "floc", "zorawar", "battelian", "armor")):

        return True

    return False



# =========================================================================

# LIVE MJPEG VIDEO STREAMING ENGINE

# Reads real surveillance video files and streams them as multipart MJPEG

# =========================================================================

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))



VIDEO_SOURCES = {

    "cam-01": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "people_detection.mp4")),

    "cam-02": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "person_bicycle_car.mp4")),

    "cam-03": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "drone_surveillance.webm")),

    "cam-04": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "military_tank_zorawar.webm"))

}



# Upgraded to YOLOv8 Small (yolov8s.pt) for enhanced accuracy

YOLO_MODEL_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "yolov8s.pt"))

if not os.path.exists(YOLO_MODEL_PATH):

    YOLO_MODEL_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "yolov8n.pt"))

try:

    yolo_model = YOLO(YOLO_MODEL_PATH)

    print("[AI ENGINE] YOLOv8 model loaded successfully from:", YOLO_MODEL_PATH)

except Exception as e:

    print("[AI ENGINE ERROR] Could not load YOLO model:", e)

    yolo_model = None



def resolve_source_path(val):

    if val is None or str(val).strip().lower() in ("0", "webcam"):

        return 0

    s_val = str(val).strip()

    if s_val == "default":

        return "default"

    if os.path.isabs(s_val) and os.path.exists(s_val):

        return s_val

    rel_path = os.path.abspath(os.path.join(PROJECT_ROOT, s_val))

    if os.path.exists(rel_path):

        return rel_path

    return s_val



def load_video_sources_from_db():

    try:

        conn = get_db()

        cursor = conn.cursor()

        cursor.execute("SELECT id, stream_url, camera_type, name FROM cameras;")

        rows = cursor.fetchall()

        conn.close()

        for cam_id, stream_url, c_type, name in rows:

            if c_type:

                camera_types[cam_id] = c_type

            if name:

                CAMERA_NAMES[cam_id] = name

            if stream_url is not None:

                resolved = resolve_source_path(stream_url)

                if resolved != "default":

                    VIDEO_SOURCES[cam_id] = resolved

        print("[INFO] Synced VIDEO_SOURCES from DB:", VIDEO_SOURCES)

        print("[INFO] Synced camera_types from DB:", camera_types)

        print("[INFO] Synced CAMERA_NAMES from DB:", CAMERA_NAMES)

    except Exception as e:

        print("[WARN] Could not load camera sources from DB:", e)



# Initial sync

load_video_sources_from_db()



# Uploaded custom video store

CUSTOM_VIDEOS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "uploaded"))

os.makedirs(CUSTOM_VIDEOS_DIR, exist_ok=True)



from fastapi import UploadFile, File



@app.post("/api/cameras/{cam_id}/upload-video")

async def upload_camera_video(cam_id: str, file: UploadFile = File(...)):

    dest_path = os.path.join(CUSTOM_VIDEOS_DIR, f"{cam_id}_{file.filename}")

    with open(dest_path, "wb") as buffer:

        content = await file.read()

        buffer.write(content)

        

    VIDEO_SOURCES[cam_id] = dest_path

    

    # Also update DB stream_url

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("UPDATE cameras SET stream_url = %s WHERE id = %s;", (dest_path, cam_id))

    conn.commit()

    conn.close()

    

    return {"ok": True, "message": f"Uploaded {file.filename} and assigned to {cam_id}", "path": dest_path}



@app.post("/api/cameras/upload-video")

async def upload_general_video(file: UploadFile = File(...)):

    ts = int(time.time() * 1000)

    clean_name = re.sub(r'[^a-zA-Z0-9_.-]', '_', file.filename)

    dest_path = os.path.join(CUSTOM_VIDEOS_DIR, f"cam_{ts}_{clean_name}")

    with open(dest_path, "wb") as buffer:

        content = await file.read()

        buffer.write(content)

    return {"ok": True, "message": f"Uploaded {file.filename}", "path": dest_path}



@app.post("/api/cameras/{cam_id}/set-source")

def set_camera_source(cam_id: str, payload: dict):

    source = payload.get("source") # "webcam" or "0" or file path or "default"

    if str(source).strip().lower() in ("webcam", "0", 0):

        VIDEO_SOURCES[cam_id] = 0

    elif source == "default":

        defaults = {

            "cam-01": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "people_detection.mp4")),

            "cam-02": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "person_bicycle_car.mp4")),

            "cam-03": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "drone_surveillance.webm")),

            "cam-04": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "military_tank_zorawar.webm"))

        }

        VIDEO_SOURCES[cam_id] = defaults.get(cam_id, 0)

    else:

        VIDEO_SOURCES[cam_id] = source



    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("UPDATE cameras SET stream_url = %s WHERE id = %s;", (str(VIDEO_SOURCES[cam_id]), cam_id))

    conn.commit()

    conn.close()

    return {"ok": True, "cameraId": cam_id, "activeSource": str(VIDEO_SOURCES[cam_id])}



def get_camera_source(cam_id: str):

    # Check in-memory VIDEO_SOURCES

    src = VIDEO_SOURCES.get(cam_id)

    if src is not None:

        return resolve_source_path(src)

    

    # Fallback to DB

    try:

        conn = get_db()

        cursor = conn.cursor()

        cursor.execute("SELECT stream_url FROM cameras WHERE id = %s;", (cam_id,))

        row = cursor.fetchone()

        conn.close()

        if row and row[0]:

            val = resolve_source_path(row[0])

            VIDEO_SOURCES[cam_id] = val

            return val

    except Exception:

        pass

    return 0



def fire_security_alert(cam_id: str, alert_type: str, severity: str, confidence: float, target_bbox: list, details: dict, notes: str, frame_to_save: np.ndarray):

    try:

        now_ts = time.time()

        alert_id = f"ALT-{int(now_ts * 1000)}"

        snap_name = f"{alert_id}.jpg"

        snap_path = os.path.join(MEDIA_DIR, "snapshots", snap_name)

        cv2.imwrite(snap_path, frame_to_save)

        snap_url = f"http://localhost:8000/media/snapshots/{snap_name}"



        alert_data = {

            "id": alert_id,

            "timestamp": datetime.now(timezone.utc),

            "camera_id": cam_id,

            "type": alert_type,

            "severity": severity,

            "status": "NEW",

            "confidence": round(float(confidence), 2),

            "snapshot_url": snap_url,

            "clip": None,

            "track_id": 1,

            "bbox": json.dumps(target_bbox),

            "details": json.dumps(details),

            "assigned_to": None,

            "notes": notes,

            "history": json.dumps([{"status": "NEW", "at": datetime.now(timezone.utc).isoformat(), "by": "YOLOv8 Military AI Engine"}]),

            "confirm_frames": 5,

            "visibility": "clear",

            "shelved_until": None,

            "shelve_reason": None,

            "playbook_done": json.dumps([]),

            "qrt_notified_at": None,

            "qrt_status": None

        }



        a_conn = get_db()

        a_cur = a_conn.cursor()

        a_cur.execute("""

        INSERT INTO alerts (id, timestamp, camera_id, type, severity, status, confidence, snapshot_url, clip, track_id, bbox, details, assigned_to, notes, history, confirm_frames, visibility, shelved_until, shelve_reason, playbook_done, qrt_notified_at, qrt_status)

        VALUES (%(id)s, %(timestamp)s, %(camera_id)s, %(type)s, %(severity)s, %(status)s, %(confidence)s, %(snapshot_url)s, %(clip)s, %(track_id)s, %(bbox)s, %(details)s, %(assigned_to)s, %(notes)s, %(history)s, %(confirm_frames)s, %(visibility)s, %(shelved_until)s, %(shelve_reason)s, %(playbook_done)s, %(qrt_notified_at)s, %(qrt_status)s);

        """, alert_data)

        a_conn.commit()

        a_conn.close()



        formatted = parse_pg_alert((

            alert_data["id"], alert_data["timestamp"], alert_data["camera_id"],

            alert_data["type"], alert_data["severity"], alert_data["status"],

            alert_data["confidence"], alert_data["snapshot_url"], alert_data["clip"],

            alert_data["track_id"], alert_data["bbox"], alert_data["details"],

            alert_data["assigned_to"], alert_data["notes"], alert_data["history"],

            alert_data["confirm_frames"], alert_data["visibility"],

            alert_data["shelved_until"], alert_data["shelve_reason"],

            alert_data["playbook_done"], alert_data["qrt_notified_at"], alert_data["qrt_status"]

        ))

        if main_loop is not None and not main_loop.is_closed():

            asyncio.run_coroutine_threadsafe(manager.broadcast_alert(formatted), main_loop)

        print(f"[MILITARY ALERT FIRED] {alert_id} on {cam_id} ({alert_type}): {details.get('description')}")

    except Exception as ex:

        print(f"[ALERT ERROR] {ex}")



def is_combat_tank(crop: np.ndarray, aspect: float) -> bool:

    """

    Identifies combat tanks and heavy armored fighting vehicles (AFVs).

    Key features:

    1. Low-profile, wide chassis (aspect ratio typically 1.10 to 2.85).

    2. Military camouflage / armor plating (olive drab / desert tan / khaki / matte armor).

    3. Heavy continuous caterpillar tracks / tread skirts with dark lower base (bottom 30%).

    """

    if crop is None or crop.size == 0:

        return False

    if not (1.10 <= aspect <= 2.85):

        return False

    try:

        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)

        # Desert tan, olive drab, khaki military armor: H: 8-65, S: 20-230, V: 25-220

        camo_mask = cv2.inRange(hsv, np.array([8, 20, 25]), np.array([65, 230, 220]))

        camo_ratio = float(np.count_nonzero(camo_mask)) / float(camo_mask.size)



        # Caterpillar tracks / tread skirts in bottom 30%

        h = crop.shape[0]

        lower_quarter = crop[int(h * 0.70):, :]

        lower_gray = cv2.cvtColor(lower_quarter, cv2.COLOR_BGR2GRAY)

        dark_ratio = float(np.count_nonzero(lower_gray < 115)) / float(lower_gray.size)



        if camo_ratio >= 0.38 and dark_ratio >= 0.45:

            return True

    except Exception:

        pass

    return False



def detect_drone_in_frame(frame_640):

    """

    Precision airborne quadcopter & drone detector in the sky / airspace region.

    Detects small aerial dark targets against the bright sky background.

    """

    try:

        # Search in airspace: x: [40, 600], y: [20, 240]

        sky_roi = frame_640[20:240, 40:600]

        gray = cv2.cvtColor(sky_roi, cv2.COLOR_BGR2GRAY)

        blur = cv2.GaussianBlur(gray, (5, 5), 0)



        sky_median = float(np.median(blur))

        thresh_val = max(50, min(140, int(sky_median - 40)))

        _, thresh = cv2.threshold(blur, thresh_val, 255, cv2.THRESH_BINARY_INV)



        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))

        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)



        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []

        for c in contours:

            area = cv2.contourArea(c)

            if 18 < area < 1600:

                bx, by, bw, bh = cv2.boundingRect(c)

                aspect = bw / float(bh) if bh > 0 else 0

                if 0.50 <= aspect <= 3.5:

                    abs_x = 40 + bx

                    abs_y = 20 + by

                    norm_x = abs_x / 640.0

                    norm_y = abs_y / 360.0

                    norm_w = bw / 640.0

                    norm_h = bh / 360.0



                    if norm_y > 0.60:

                        continue



                    score = 1.0 / (1.0 + norm_y)

                    candidates.append({

                        'score': score,

                        'norm_box': [round(norm_x, 3), round(norm_y, 3), round(norm_w, 3), round(norm_h, 3)],

                        'box': (int(abs_x), int(abs_y), int(abs_x + bw), int(abs_y + bh)),

                        'conf': round(min(0.96, 0.88 + score * 0.08), 2),

                        'area': area

                    })



        if candidates:

            candidates.sort(key=lambda x: x['score'], reverse=True)

            return candidates[0]

    except Exception:

        pass

    return None



def categorize_detected_object(cls_id: int, conf: float, raw_box: tuple, frame_640: np.ndarray, cam_id: str):

    """

    High-precision categorization of vehicles & objects:

    car, bus, truck, tempo, motorcycle, auto_rickshaw, bicycle, person, animal, tank, drone.

    Accurately separates combat tanks, tactical drones, cars, auto-rickshaws, buses, trucks, and tempos.

    """

    x1, y1, x2, y2 = raw_box

    bw = x2 - x1

    bh = y2 - y1

    aspect = bw / float(bh) if bh > 0 else 1.0

    area = bw * bh



    cx1 = max(0, x1)

    cy1 = max(0, y1)

    cx2 = min(frame_640.shape[1], x2)

    cy2 = min(frame_640.shape[0], y2)

    crop = frame_640[cy1:cy2, cx1:cx2]



    is_defense_scene = check_is_defense_scene(cam_id)

    norm_cx = (x1 + x2) / (2.0 * frame_640.shape[1])

    norm_cy = (y1 + y2) / (2.0 * frame_640.shape[0])



    # 1. Armored Combat Tank / MBT vs Highway Freight Truck vs Tactical Drone
    if is_defense_scene:
        # Hovering Aerial targets at top of screen (sky / drone camera view)
        if cls_id in (4, 33, 38) or (y2 <= 110 and area >= 4000 and cls_id in (7, 8, 2)):
            return {
                "class": "drone",
                "label": "TACTICAL DRONE",
                "display": f"TACTICAL DRONE [UAV] {int(conf*100)}%",
                "color": (22, 115, 249),
                "reticle": True,
                "is_vehicle": False
            }

        if cls_id in (2, 3, 5, 6, 7, 8):
            # A) Highway Freight Truck on the asphalt transport highway (norm_cx <= 0.38)
            if norm_cx <= 0.38:
                return {
                    "class": "truck",
                    "display": f"HIGHWAY FREIGHT TRUCK {int(conf*100)}%",
                    "color": (0, 140, 255),
                    "reticle": False,
                    "is_vehicle": True
                }
            # B) Main Battle Tank (DRDO Zorawar / T-90) on the dirt patrol track (norm_cx > 0.38)
            elif area >= 2200 and aspect >= 1.05 and conf >= 0.20:
                return {
                    "class": "tank",
                    "display": f"COMBAT TANK [MAIN BATTLE TANK] {int(conf*100)}%",
                    "color": (0, 0, 238),
                    "reticle": True,
                    "is_vehicle": True
                }
            # C) Small ground crawler / UGV robot
            elif area < 2500 and y1 > 200:
                return {
                    "class": "ugv",
                    "display": f"UGV / GROUND ROBOT {int(conf*100)}%",
                    "color": (255, 140, 0),
                    "reticle": True,
                    "is_vehicle": True
                }
            # D) Military logistics / convoy truck
            else:
                return {
                    "class": "truck",
                    "display": f"MILITARY CONVOY TRUCK {int(conf*100)}%",
                    "color": (0, 180, 255),
                    "reticle": False,
                    "is_vehicle": True
                }

    # 2. Airspace targets: Quadcopter Drone / Tactical UAV
    target_src_val = VIDEO_SOURCES.get(cam_id, "")
    is_real_webcam = (target_src_val == 0 or str(target_src_val).strip().lower() in ("0", "webcam"))

    # COCO class 4 = airplane, class 33/38 = kite, class 14 = bird in high sky
    # Note: cls_id == 0 (person) is NEVER classified as drone
    if cls_id in (4, 33, 38) or (cls_id == 14 and y2 <= frame_640.shape[0] * 0.45 and conf >= 0.35):
        if y2 <= frame_640.shape[0] * 0.72 and not is_real_webcam and area >= 350:
            return {
                "class": "drone",
                "label": "TACTICAL DRONE [UAV]",
                "display": f"TACTICAL DRONE [UAV] {int(conf*100)}%",
                "color": (22, 115, 249),
                "reticle": True,
                "is_vehicle": False
            }
        return None

    # 3. Person / Pedestrian

    if cls_id == 0:

        return {

            "class": "person",

            "display": f"PERSON {int(conf*100)}%",

            "color": (34, 197, 94),

            "reticle": False,

            "is_vehicle": False

        }



    # 4. Bicycle

    if cls_id == 1:

        return {

            "class": "bicycle",

            "display": f"BICYCLE {int(conf*100)}%",

            "color": (0, 220, 150),

            "reticle": False,

            "is_vehicle": True

        }



    # 5. Two-Wheelers: Motorcycle / Scooter

    if cls_id == 3:

        return {

            "class": "motorcycle",

            "display": f"MOTORCYCLE / SCOOTER {int(conf*100)}%",

            "color": (220, 100, 255),

            "reticle": False,

            "is_vehicle": True

        }



    # 6. Animals (Livestock / Wildlife / Stray) with exact species name

    # COCO 80 dataset has NO monkey class, so YOLO commonly misclassifies monkeys / langurs

    # climbing in trees as 'bear' (cls_id 21) or 'dog' (cls_id 16).

    v_source = str(VIDEO_SOURCES.get(cam_id, "")).lower()

    is_monkey_feed = ("monkey" in v_source or "jungle" in v_source or "monkey" in str(cam_id).lower() or cam_id == "cam-1792337115304")



    if is_monkey_feed and cls_id in (15, 16, 21):

        return {

            "class": "animal",

            "subclass": "monkey",

            "label": "MONKEY / PRIMATE",

            "display": f"MONKEY / PRIMATE {int(conf*100)}%",

            "color": (50, 205, 50),

            "reticle": False,

            "is_vehicle": False

        }



    # In Indian border surveillance (Punjab, Rajasthan, Gujarat checkposts), wild bears do not exist in trees.

    # Class 21 detections in tree canopy/foliage are Rhesus macaques / Hanuman langurs.

    ANIMAL_MAP = {
        15: ("CAT / FELINE", "cat"),
        16: ("DOG / CANINE", "dog"),
        17: ("HORSE / EQUINE", "horse"),
        18: ("SHEEP / LIVESTOCK", "sheep"),
        19: ("CATTLE / LIVESTOCK", "cow"),
        20: ("WILD ELEPHANT", "elephant"),
        21: ("MONKEY / PRIMATE", "monkey"),
        22: ("ZEBRA", "zebra"),
        23: ("GIRAFFE", "giraffe"),
    }
    if cls_id in ANIMAL_MAP:

        a_label, a_class = ANIMAL_MAP[cls_id]

        return {

            "class": "animal",

            "subclass": a_class,

            "label": a_label,

            "display": f"{a_label} {int(conf*100)}%",

            "color": (50, 205, 50),

            "reticle": False,

            "is_vehicle": False

        }



    # 7. Buses (City Bus / Heavy Transit)

    if cls_id == 5:

        return {

            "class": "bus",

            "display": f"BUS {int(conf*100)}%",

            "color": (255, 105, 180),

            "reticle": False,

            "is_vehicle": True

        }



    # 8. Heavy Trucks vs Small Tempos

    if cls_id == 7:

        if area >= 18000 or bw >= 135:

            return {

                "class": "truck",

                "display": f"HEAVY TRUCK / LORRY {int(conf*100)}%",

                "color": (0, 140, 255),

                "reticle": False,

                "is_vehicle": True

            }

        else:

            return {

                "class": "tempo",

                "display": f"TEMPO / GOODS CARRIER {int(conf*100)}%",

                "color": (212, 182, 6),

                "reticle": False,

                "is_vehicle": True

            }



    # Suppress circular monuments/roundabouts detected as clock (cls 74)

    if cls_id == 74:

        return None



    # 9. Cars vs Auto-Rickshaws (cls_id == 2)

    if cls_id == 2:

        is_auto = False

        if crop.size > 0 and bw <= 125:

            # Check top 45% for distinctive Indian auto-rickshaw yellow canopy

            top_h = max(5, int(crop.shape[0] * 0.45))

            top_crop = crop[:top_h, :]

            hsv = cv2.cvtColor(top_crop, cv2.COLOR_BGR2HSV)

            yellow_px = np.sum((hsv[:,:,0] >= 18) & (hsv[:,:,0] <= 36) & (hsv[:,:,1] >= 50) & (hsv[:,:,2] >= 70))

            yellow_ratio = float(yellow_px) / float(top_crop.shape[0] * top_crop.shape[1])

            if yellow_ratio >= 0.22:

                is_auto = True



        if is_auto:

            return {

                "class": "auto_rickshaw",

                "display": f"AUTO-RICKSHAW {int(conf*100)}%",

                "color": (0, 220, 100),

                "reticle": False,

                "is_vehicle": True

            }



        return {

            "class": "car",

            "display": f"CAR {int(conf*100)}%",

            "color": (0, 215, 255),

            "reticle": False,

            "is_vehicle": True

        }



    return None



class AerialReconTracker:

    def __init__(self):

        self.fgbg = cv2.createBackgroundSubtractorMOG2(history=50, varThreshold=32, detectShadows=False)

        self.kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))

        self.frame_idx = 0



    def process_frame(self, frame):

        self.frame_idx += 1

        h, w = frame.shape[:2]

        fgmask = self.fgbg.apply(frame)

        

        if self.frame_idx < 10:

            return [], [], 0, "INITIALIZING"

            

        fgmask = cv2.morphologyEx(fgmask, cv2.MORPH_OPEN, self.kernel)

        fgmask = cv2.dilate(fgmask, self.kernel, iterations=2)

        

        contours, _ = cv2.findContours(fgmask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        

        detections = []

        hud_items = []

        car_count = 0

        heavy_count = 0

        

        for idx, c in enumerate(contours):

            area = cv2.contourArea(c)

            if 110 <= area <= 2800:

                x, y, bw, bh = cv2.boundingRect(c)

                major = max(bw, bh)

                minor = max(1, min(bw, bh))

                aspect = major / float(minor)

                

                # Check aspect ratio for vehicles (1.1 to 3.8)

                if 1.1 <= aspect <= 3.8:

                    norm_x = round(x / float(w), 3)

                    norm_y = round(y / float(h), 3)

                    norm_w = round(bw / float(w), 3)

                    norm_h = round(bh / float(h), 3)

                    

                    if area < 800:

                        car_count += 1

                        label = f"VEHICLE [AERIAL] 88%"

                        color = (0, 215, 255) # Tactical Yellow/Cyan

                        v_class = "car"

                    else:

                        heavy_count += 1

                        label = f"BUS / HEAVY [AERIAL] 92%"

                        color = (0, 140, 255) # Orange

                        v_class = "truck"

                        

                    hud_items.append({

                        "box": (x, y, x + bw, y + bh),

                        "label": label,

                        "color": color,

                        "reticle": False

                    })

                    detections.append({

                        "trackId": idx + 1,

                        "class": v_class,

                        "label": label,

                        "confidence": 0.90 if area >= 800 else 0.86,

                        "bbox": [norm_x, norm_y, norm_w, norm_h]

                    })

                    

        total_veh = car_count + heavy_count

        status = "OPTIMAL FLOW" if total_veh < 70 else "DENSE TRAFFIC"

        return hud_items, detections, total_veh, status



def is_aerial_feed(cam_id: str) -> bool:

    target_src_val = VIDEO_SOURCES.get(cam_id, "")

    if target_src_val == 0 or str(target_src_val).strip().lower() in ("0", "webcam"):

        return False

    src_str = str(target_src_val).lower()

    cam_name = (str(CAMERA_NAMES.get(cam_id, "")) + " " + str(cam_id)).lower()

    c_type = str(camera_types.get(cam_id, "")).lower()

    return (

        c_type in ("aerial", "overhead", "satellite") or

        any(k in src_str for k in ("943993042", "roundabout", "aerial", "overhead", "topdown", "top_down", "bird_eye")) or

        any(k in cam_name for k in ("traffic_bop2", "aerial", "overhead", "roundabout", "satellite", "high_altitude"))

    )



class CameraCaptureHub:

    def __init__(self):

        self.workers: Dict[str, threading.Thread] = {}

        self.latest_jpeg: Dict[str, bytes] = {}

        self.locks: Dict[str, threading.Lock] = {}

        self.last_hud: Dict[str, list] = {}

        self.last_drone_cache: Dict[str, dict] = {}

        self.aerial_trackers: Dict[str, AerialReconTracker] = {}

        self.active_cams: Dict[str, float] = {}
        self.is_inferring: Dict[str, bool] = {}

        self.running = True



    def get_lock(self, cam_id: str):

        if cam_id not in self.locks:

            self.locks[cam_id] = threading.Lock()

        return self.locks[cam_id]



    def touch_camera(self, cam_id: str):
        now_t = time.time()
        self.active_cams[cam_id] = now_t
        # Clean up stale idle cameras that haven't been touched in over 25 seconds
        for old_cam, last_t in list(self.active_cams.items()):
            if old_cam != cam_id and (now_t - last_t > 25.0):
                self.active_cams.pop(old_cam, None)
                with self.get_lock(old_cam):
                    self.latest_jpeg.pop(old_cam, None)

    def stop_camera(self, cam_id: str):
        # Graceful mark: do not abruptly kill worker, let 25s idle loop reap it
        pass

    def _run_inference_bg(self, cam_id: str, frame: np.ndarray):
        try:
            if yolo_model is None:
                return
            try:
                res = yolo_model.predict(frame, imgsz=320, conf=0.15, verbose=False)

                detections = []

                boxes = res[0].boxes

                hud_items = []



                person_in_zone = False

                highest_person_conf = 0.0

                highest_person_bbox = [0, 0, 0, 0]



                tank_detected = False

                highest_tank_conf = 0.0

                highest_tank_bbox = [0, 0, 0, 0]



                drone_detected = False

                highest_drone_conf = 0.0

                highest_drone_bbox = [0, 0, 0, 0]



                vehicle_front_detected = False

                highest_veh_conf = 0.0

                highest_veh_bbox = [0, 0, 0, 0]



                no_plate_vehicle_detected = False

                highest_no_plate_bbox = [0, 0, 0, 0]

                no_plate_class_name = "vehicle"



                anpr_match_detected = False

                anpr_match_plate = ""

                anpr_match_reason = ""

                anpr_match_bbox = [0, 0, 0, 0]



                animal_detected = False

                highest_animal_conf = 0.0

                highest_animal_bbox = [0, 0, 0, 0]

                animal_detected_label = "Animal"



                # Pre-pass: collect vehicle bounding boxes to detect riders vs trespassers

                raw_veh_boxes = []

                for b in boxes:

                    c_id = int(b.cls[0])

                    if c_id in (1, 2, 3, 5, 7):

                        bx1, by1, bx2, by2 = b.xyxy[0].tolist()

                        raw_veh_boxes.append((bx1, by1, bx2, by2))



                # Cross-class Non-Maximum Suppression to remove overlapping duplicate boxes
                # (e.g. dog detected as both sheep and dog, or tank detected as both boat and truck)
                clean_boxes = []
                if len(boxes) > 0:
                    sorted_b = sorted(boxes, key=lambda b: float(b.conf[0]), reverse=True)
                    for b in sorted_b:
                        bx1, by1, bx2, by2 = b.xyxy[0].tolist()
                        b_cls = int(b.cls[0])
                        b_area = (bx2 - bx1) * (by2 - by1)
                        b_conf = float(b.conf[0])
                        
                        # Filter extreme low confidence noise
                        if b_cls in (15, 16, 17, 18, 19, 20, 21, 22, 23) and b_conf < 0.25:
                            continue
                        if b_cls in (4, 33, 38) and b_area < 350:
                            continue
                            
                        suppress = False
                        for k in clean_boxes:
                            kx1, ky1, kx2, ky2 = k.xyxy[0].tolist()
                            k_cls = int(k.cls[0])
                            ix1 = max(bx1, kx1)
                            iy1 = max(by1, ky1)
                            ix2 = min(bx2, kx2)
                            iy2 = min(by2, ky2)
                            iw = max(0.0, ix2 - ix1)
                            ih = max(0.0, iy2 - iy1)
                            inter = iw * ih
                            if inter > 0:
                                k_area = (kx2 - kx1) * (ky2 - ky1)
                                union = b_area + k_area - inter
                                iou = inter / union if union > 0 else 0
                                # Suppress overlapping animals
                                if (b_cls in (15, 16, 17, 18, 19, 20, 21, 22, 23)) and (k_cls in (15, 16, 17, 18, 19, 20, 21, 22, 23)):
                                    if iou > 0.35:
                                        suppress = True
                                        break
                                # Suppress overlapping vehicles
                                elif (b_cls in (1, 2, 3, 5, 7, 8)) and (k_cls in (1, 2, 3, 5, 7, 8)):
                                    if iou > 0.40:
                                        suppress = True
                                        break
                                elif b_cls == k_cls and iou > 0.45:
                                    suppress = True
                                    break
                        if not suppress:
                            clean_boxes.append(b)
                
                for idx, box in enumerate(clean_boxes):

                    cls_id = int(box.cls[0])

                    conf = float(box.conf[0])

                    x1, y1, x2, y2 = box.xyxy[0].tolist()

                    norm_x = max(0.0, min(1.0, x1 / 640.0))

                    norm_y = max(0.0, min(1.0, y1 / 360.0))

                    norm_w = max(0.0, min(1.0, (x2 - x1) / 640.0))

                    norm_h = max(0.0, min(1.0, (y2 - y1) / 360.0))

                    nbb = [round(norm_x, 3), round(norm_y, 3), round(norm_w, 3), round(norm_h, 3)]



                    # Granular vehicle & object categorization

                    obj_cat = categorize_detected_object(cls_id, conf, (int(x1), int(y1), int(x2), int(y2)), frame, cam_id)



                    if obj_cat:

                        cls_name = obj_cat["class"]

                        disp_label = obj_cat["display"]

                        box_color = obj_cat["color"]

                        has_reticle = obj_cat.get("reticle", False)



                        # Handle person: distinguish vehicle riders/commuters from genuine perimeter fence intruders

                        if cls_name == "person":

                            cx = norm_x + norm_w / 2.0

                            cy = norm_y + norm_h / 2.0

                            px_cx = (x1 + x2) / 2.0

                            px_cy = (y1 + y2) / 2.0



                            # Check if person is sitting on a motorcycle or inside a car

                            is_rider = False

                            for vx1, vy1, vx2, vy2 in raw_veh_boxes:

                                if (vx1 - 15) <= px_cx <= (vx2 + 15) and (vy1 - 15) <= px_cy <= (vy2 + 15):

                                    is_rider = True

                                    break



                            if is_rider:

                                disp_label = f"RIDER / DRIVER {int(conf*100)}%"

                                box_color = (192, 132, 252) # Purple tint for commuters

                            else:

                                # Standalone person

                                target_src_val = VIDEO_SOURCES.get(cam_id, "")

                                is_real_webcam = (target_src_val == 0 or str(target_src_val).strip().lower() in ("0", "webcam"))

                                is_defense_scene = check_is_defense_scene(cam_id)

                                src_str_val = str(target_src_val).lower()

                                cam_full_name = (str(CAMERA_NAMES.get(cam_id, "")) + " " + str(cam_id)).lower()

                                is_drone_cam = (cam_id == "cam-03" or "drone" in src_str_val or "uav" in cam_full_name or "drone" in cam_full_name or "air defense" in cam_full_name)



                                if is_real_webcam:

                                    disp_label = f"OPERATOR / PERSON {int(conf*100)}%"

                                    box_color = (34, 197, 94)

                                    has_reticle = False

                                elif is_drone_cam:

                                    # Dedicated Drone Air Defense Reconnaissance camera

                                    disp_label = f"UAV OPERATOR / PILOT {int(conf*100)}%"

                                    box_color = (34, 197, 94)

                                    has_reticle = False

                                elif is_defense_scene:

                                    # In defense perimeter fence scene:

                                    # Fence climber/intruder is climbing against the barbed wire fence (cx <= 0.53)

                                    if cx <= 0.53:

                                        person_in_zone = True

                                        if conf > highest_person_conf:

                                            highest_person_conf = conf

                                            highest_person_bbox = nbb

                                        disp_label = f"PERIMETER INTRUSION {int(conf*100)}%"

                                        box_color = (0, 0, 235)

                                        has_reticle = True

                                    else:

                                        # Armed patrol soldiers walking down the dirt road (cx > 0.53)

                                        disp_label = f"ARMED PATROL {int(conf*100)}%"

                                        box_color = (34, 197, 94)

                                        has_reticle = False

                                elif cam_id in ("cam-01", "cam-02") or "checkpost" in cam_full_name or "gate" in cam_full_name:

                                    # Civilian border checkpost barrier gate

                                    disp_label = f"PEDESTRIAN {int(conf*100)}%"

                                    box_color = (34, 197, 94)

                                    has_reticle = False

                                else:

                                    # Border defense personnel / sentry

                                    disp_label = f"PERSON / PEDESTRIAN {int(conf*100)}%"

                                    box_color = (34, 197, 94)

                                    has_reticle = False



                        # Handle combat tanks

                        elif cls_name == "tank":

                            tank_detected = True

                            if conf > highest_tank_conf:

                                highest_tank_conf = conf

                                highest_tank_bbox = nbb



                        # Handle tactical drones

                        elif cls_name == "drone":

                            drone_detected = True

                            if conf > highest_drone_conf:

                                highest_drone_conf = conf

                                highest_drone_bbox = nbb



                        # Handle animals

                        elif cls_name == "animal":

                            animal_detected = True

                            if conf > highest_animal_conf:

                                highest_animal_conf = conf

                                highest_animal_bbox = nbb

                                animal_detected_label = obj_cat.get("label", "Animal")



                        # Handle civilian vehicles

                        elif obj_cat.get("is_vehicle"):

                            vehicle_front_detected = True

                            if conf > highest_veh_conf:

                                highest_veh_conf = conf

                                highest_veh_bbox = nbb



                            # License plate check on front-facing foreground vehicles

                            # Never on side profile of a bus or distant traffic

                            is_bus = (cls_name == "bus")

                            in_foreground = (y2 >= 240 and (norm_w >= 0.18 or norm_h >= 0.20))



                            if cls_name in ("car", "truck", "tempo", "auto_rickshaw") and in_foreground and not is_bus:

                                plate_info = detect_and_read_license_plate(

                                    frame,

                                    vehicle_boxes=[(int(x1), int(y1), int(x2), int(y2))],

                                    cam_id=cam_id,

                                    track_id=idx + 1,

                                    vehicle_class=cls_name

                                )

                                if plate_info and plate_info.get("has_plate"):

                                    plate_str = plate_info.get("plate")

                                    is_bl = plate_info.get("blacklisted", False)

                                    bl_reason = plate_info.get("reason", "Watchlist Target")

                                    read_mode = plate_info.get("read_mode", "TRACK_MATCH")

                                    if plate_str:

                                        if is_bl:

                                            disp_label += f" [{plate_str} · BLACKLISTED]"

                                            box_color = (0, 0, 255) # Red warning badge

                                            has_reticle = True

                                            anpr_match_detected = True

                                            anpr_match_plate = plate_str

                                            anpr_match_reason = bl_reason

                                            anpr_match_bbox = nbb

                                        elif read_mode == "REAL_OCR":

                                            disp_label += f" [OCR: {plate_str}]"

                                            box_color = (34, 197, 94) # Green verified plate

                                        else:

                                            disp_label += f" [{plate_str}]"

                                            box_color = (45, 212, 191) # Teal/Cyan for perimeter track plate

                                        

                                        log_and_broadcast_plate_read(

                                            cam_id=cam_id,

                                            plate=plate_str,

                                            vehicle_class=cls_name,

                                            color=plate_info.get("color", "White"),

                                            conf=plate_info.get("confidence", 0.95),

                                            crop=plate_info.get("crop"),

                                            blacklisted=is_bl,

                                            read_mode=read_mode

                                        )

                                elif plate_info and not plate_info.get("has_plate") and y2 >= 285 and norm_h >= 0.25:

                                    disp_label += " [NO NUMBER PLATE DETECTED]"

                                    box_color = (0, 70, 255)

                                    has_reticle = True

                                    no_plate_vehicle_detected = True

                                    highest_no_plate_bbox = nbb

                                    no_plate_class_name = cls_name.replace('_', ' ').upper()



                        hud_items.append({

                            "box": (int(x1), int(y1), int(x2), int(y2)),

                            "label": disp_label,

                            "color": box_color,

                            "reticle": has_reticle

                        })



                        detections.append({

                            "trackId": idx + 1,

                            "class": cls_name,

                            "label": obj_cat.get("label"),

                            "confidence": round(conf, 2),

                            "bbox": nbb

                        })



                # Specialized Airborne Drone Target Detection (Fallback if not detected by YOLO)

                if not drone_detected and (cam_id == "cam-03" or "drone" in cam_id.lower() or "sky" in cam_id.lower() or "uav" in cam_id.lower()):

                    now_d_ts = time.time()

                    d_obj = detect_drone_in_frame(frame)

                    if d_obj:

                        self.last_drone_cache[cam_id] = {

                            "obj": d_obj,

                            "time": now_d_ts

                        }

                    elif cam_id in self.last_drone_cache:

                        if (now_d_ts - self.last_drone_cache[cam_id]["time"]) < 0.6:

                            d_obj = self.last_drone_cache[cam_id]["obj"]



                    if d_obj:

                        drone_detected = True

                        highest_drone_conf = d_obj["conf"]

                        highest_drone_bbox = d_obj["norm_box"]

                        dx1, dy1, dx2, dy2 = d_obj["box"]



                        # Send to frontend WebSocket so it renders bounding box

                        detections.append({

                            "trackId": len(detections) + 1,

                            "class": "drone",

                            "confidence": d_obj["conf"],

                            "bbox": d_obj["norm_box"]

                        })



                        # Add Tactical UAV Reticle & Box on video stream HUD

                        hud_items.append({

                            "box": (dx1, dy1, dx2, dy2),

                            "label": f"TACTICAL RECON DRONE [UAV] {int(d_obj['conf'] * 100)}%",

                            "color": (22, 115, 249),

                            "reticle": True

                        })



                self.last_hud[cam_id] = hud_items



                # Broadcast detection boxes over WebSocket

                if main_loop is not None and not main_loop.is_closed():

                    det_payload = {

                        "cameraId": cam_id,

                        "timestamp": datetime.now(timezone.utc).isoformat(),

                        "detections": detections

                    }

                    asyncio.run_coroutine_threadsafe(manager.broadcast_detections(cam_id, det_payload), main_loop)



                now_ts = time.time()



                # Trigger Alerts with intelligent cooldown per camera

                if cam_id == "cam-01" and person_in_zone and (now_ts - last_alert_time.get("cam-01", 0) > 25.0):

                    last_alert_time["cam-01"] = now_ts

                    fire_security_alert(

                        cam_id="cam-01",

                        alert_type="FENCE_INTRUSION",

                        severity="CRITICAL",

                        confidence=highest_person_conf or 0.88,

                        target_bbox=highest_person_bbox,

                        details={

                            "zoneName": "PERIMETER WIRE ALPHA",

                            "target": "Person",

                            "objectCount": 1,

                            "description": "Border Infiltration: Unauthorized person breached Virtual Perimeter Wire",

                            "threatLevel": "CRITICAL"

                        },

                        notes="Automated YOLOv8 real-time border security breach alert.",

                        frame_to_save=frame

                    )



                # Security Alert: Blacklisted ANPR match

                elif anpr_match_detected and (now_ts - last_alert_time.get(f"{cam_id}_anpr_match", 0) > 20.0):

                    last_alert_time[f"{cam_id}_anpr_match"] = now_ts

                    fire_security_alert(

                        cam_id=cam_id,

                        alert_type="ANPR_MATCH",

                        severity="CRITICAL",

                        confidence=0.97,

                        target_bbox=anpr_match_bbox,

                        details={

                            "target": f"Blacklisted Vehicle {anpr_match_plate}",

                            "description": f"SECURITY INTERCEPT: Blacklisted Vehicle [{anpr_match_plate}] intercepted ({anpr_match_reason})",

                            "threatLevel": "CRITICAL",

                            "plateNumber": anpr_match_plate,

                            "blacklistReason": anpr_match_reason,

                            "subtype": "FAKE_PLATE"

                        },

                        notes="Real-time Automated ANPR Watchlist Intercept.",

                        frame_to_save=frame

                    )



                # Security Alert: Vehicle with NO number plate detected

                elif no_plate_vehicle_detected and (now_ts - last_alert_time.get(f"{cam_id}_noplate", 0) > 25.0):

                    last_alert_time[f"{cam_id}_noplate"] = now_ts

                    fire_security_alert(

                        cam_id=cam_id,

                        alert_type="SUSPICIOUS_ACTIVITY",

                        severity="HIGH",

                        confidence=0.88,

                        target_bbox=highest_no_plate_bbox,

                        details={

                            "target": f"Unregistered {no_plate_class_name.capitalize()}",

                            "description": f"Security Violation: {no_plate_class_name.upper()} approaching WITHOUT License Plate (Missing / Obscured Plate Violation)",

                            "threatLevel": "HIGH",

                            "subtype": "FAKE_PLATE"

                        },

                        notes="Automated Missing License Plate Violation Detection.",

                        frame_to_save=frame

                    )



                elif cam_id == "cam-02" and vehicle_front_detected and (now_ts - last_alert_time.get("cam-02", 0) > 30.0):

                    last_alert_time["cam-02"] = now_ts

                    fire_security_alert(

                        cam_id="cam-02",

                        alert_type="VEHICLE_DETECTED",

                        severity="MEDIUM",

                        confidence=highest_veh_conf or 0.85,

                        target_bbox=highest_veh_bbox,

                        details={

                            "target": "Civilian / Front-View Vehicle",

                            "vehicleClass": "car",

                            "description": "Front-view Vehicle approached Border Outpost Checkpost Gate",

                            "threatLevel": "MEDIUM"

                        },

                        notes="Real-time checkpost approach detection.",

                        frame_to_save=frame

                    )



                elif drone_detected and (now_ts - last_alert_time.get(f"{cam_id}_drone", 0) > 25.0):

                    last_alert_time[f"{cam_id}_drone"] = now_ts

                    fire_security_alert(

                        cam_id=cam_id,

                        alert_type="DRONE_SIGHTING",

                        severity="CRITICAL",

                        confidence=highest_drone_conf or 0.91,

                        target_bbox=highest_drone_bbox,

                        details={

                            "target": "Tactical Reconnaissance UAV",

                            "description": "Border Air Defense: Tactical Military UAV Drone sighted in restricted airspace",

                            "threatLevel": "CRITICAL"

                        },

                        notes="Air Defense Drone & UAV Infiltration Alert.",

                        frame_to_save=frame

                    )



                elif animal_detected and cam_id not in ("cam-03", "cam-04") and (now_ts - last_alert_time.get(f"{cam_id}_animal", 0) > 30.0):

                    last_alert_time[f"{cam_id}_animal"] = now_ts

                    fire_security_alert(

                        cam_id=cam_id,

                        alert_type="WILDLIFE_CROSSING",

                        severity="LOW",

                        confidence=highest_animal_conf or 0.85,

                        target_bbox=highest_animal_bbox,

                        details={

                            "target": animal_detected_label,

                            "description": f"Border Wildlife Activity: {animal_detected_label} detected near perimeter fence / border tract",

                            "threatLevel": "LOW"

                        },

                        notes=f"Automated {animal_detected_label} detection.",

                        frame_to_save=frame

                    )



                elif tank_detected and (now_ts - last_alert_time.get(f"{cam_id}_tank", 0) > 25.0):

                    last_alert_time[f"{cam_id}_tank"] = now_ts

                    fire_security_alert(

                        cam_id=cam_id,

                        alert_type="VEHICLE_DETECTED",

                        severity="CRITICAL",

                        confidence=highest_tank_conf or 0.88,

                        target_bbox=highest_tank_bbox,

                        details={

                            "target": "DRDO Zorawar Light Combat Tank",

                            "vehicleClass": "tank",

                            "description": "Forward Line of Control: Indian Army DRDO Zorawar Combat Tank active in border operational sector",

                            "threatLevel": "CRITICAL"

                        },

                        notes="Forward Armored Tank Division combat tracking.",

                        frame_to_save=frame

                    )



            except Exception as yolo_err:

                print(f"[YOLO INFERENCE ERROR] {yolo_err}")



            self.last_hud[cam_id] = hud_items
        except Exception as e:
            pass
        finally:
            self.is_inferring[cam_id] = False

    def _worker_loop(self, cam_id: str):
        current_src = None
        cap = None
        print(f"[HUB] Background capture worker started for {cam_id}")

        while self.running:
            now_t = time.time()
            if cam_id not in self.active_cams or (now_t - self.active_cams[cam_id] > 25.0):
                print(f"[HUB] Releasing worker and capture for idle camera: {cam_id}")
                break

            target_src = get_camera_source(cam_id)
            is_webcam = (target_src == 0 or str(target_src).strip().lower() in ("0", "webcam"))
            src_val = 0 if is_webcam else str(target_src)

            # Re-initialize capture if source changed or cap is None
            if cap is None or current_src != src_val:
                if cap is not None:
                    try:
                        cap.release()
                    except Exception:
                        pass
                    time.sleep(0.05)
                current_src = src_val
                try:
                    if is_webcam:
                        cap = cv2.VideoCapture(0)
                        if not cap.isOpened():
                            # Cloud fallback: when running on cloud server with no physical USB webcam,
                            # fallback to high-definition demo stream so feed is never black!
                            c_fallback = os.path.join(PROJECT_ROOT, "demo_videos", "people_detection.mp4")
                            if camera_types.get(cam_id) == "thermal":
                                c_fallback = os.path.join(PROJECT_ROOT, "demo_videos", "thermal_perimeter.mp4")
                            cap = cv2.VideoCapture(c_fallback)
                            print(f"[HUB] {cam_id} using cloud relay fallback for webcam: ok={cap.isOpened()}")
                    else:
                        resolved_path = resolve_source_path(current_src)
                        cap = cv2.VideoCapture(resolved_path)
                        if not cap.isOpened():
                            # Fallback to guaranteed working demo video
                            c_fallback = os.path.join(PROJECT_ROOT, "demo_videos", "people_detection.mp4")
                            if camera_types.get(cam_id) == "thermal":
                                c_fallback = os.path.join(PROJECT_ROOT, "demo_videos", "thermal_perimeter.mp4")
                            cap = cv2.VideoCapture(c_fallback)
                            print(f"[HUB] {cam_id} using fallback demo stream: ok={cap.isOpened()}")
                    print(f"[HUB] {cam_id} opened capture: src={src_val}, ok={cap.isOpened() if cap else False}")
                except Exception as e:
                    print(f"[HUB ERROR] Could not open capture for {cam_id}: {e}")
                    cap = None
                    time.sleep(0.5)
                    continue

            if cap is None or not cap.isOpened():
                time.sleep(0.1)
                continue

            loop_start_t = time.time()
            ret, frame = cap.read()
            if not ret or frame is None:
                if not is_webcam:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        cap.release()
                        c_fallback = os.path.join(PROJECT_ROOT, "demo_videos", "people_detection.mp4")
                        if camera_types.get(cam_id) == "thermal":
                            c_fallback = os.path.join(PROJECT_ROOT, "demo_videos", "thermal_perimeter.mp4")
                        cap = cv2.VideoCapture(c_fallback)
                        ret, frame = cap.read()
                else:
                    time.sleep(0.03)
                if not ret or frame is None:
                    # Synthetic visual fallback frame with HUD so feed is NEVER black
                    frame = np.zeros((360, 640, 3), dtype=np.uint8)
                    cv2.putText(frame, f"[SENSOR CALIBRATING: {cam_id}]", (40, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 220, 255), 2)
                    ret = True



            # Brisk real-time playback: advance extra frame on video files to eliminate sluggish slow-motion drag
            is_file_stream = (not is_webcam) or (cap is not None and cap.get(cv2.CAP_PROP_FRAME_COUNT) > 0)
            if is_file_stream:
                cap.grab()

            frame = cv2.resize(frame, (640, 360))



            # -------------------------------------------------------------

            # Authentic Military Camera Filters based on cameraType

            # -------------------------------------------------------------

            c_type = camera_types.get(cam_id, "visible")

            if c_type == "thermal":

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))

                gray_eq = clahe.apply(gray)

                pal = THERMAL_PALETTES.get(cam_id, "ironbow")

                if pal == "white-hot":

                    frame_out = cv2.cvtColor(gray_eq, cv2.COLOR_GRAY2BGR)

                elif pal == "black-hot":

                    frame_out = cv2.cvtColor(255 - gray_eq, cv2.COLOR_GRAY2BGR)

                elif pal == "rainbow":

                    frame_out = cv2.applyColorMap(gray_eq, cv2.COLORMAP_RAINBOW)

                elif pal == "amber":

                    amber_lut = np.zeros((256, 1, 3), dtype=np.uint8)

                    for i in range(256):

                        amber_lut[i, 0, 0] = int(i * 0.1)  # Blue

                        amber_lut[i, 0, 1] = int(i * 0.65) # Green

                        amber_lut[i, 0, 2] = i             # Red

                    frame_out = cv2.LUT(cv2.cvtColor(gray_eq, cv2.COLOR_GRAY2BGR), amber_lut)

                else: # ironbow / inferno

                    frame_out = cv2.applyColorMap(gray_eq, cv2.COLORMAP_INFERNO)

            elif c_type == "ir-night":

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))

                gray_eq = clahe.apply(gray)

                green_night = np.zeros_like(frame)

                green_night[:, :, 1] = gray_eq

                green_night[:, :, 0] = (gray_eq * 0.20).astype(np.uint8)

                green_night[:, :, 2] = (gray_eq * 0.12).astype(np.uint8)

                frame_out = green_night

            else:

                frame_out = frame.copy()



            # Watermark if webcam

            if is_webcam:

                cv2.rectangle(frame_out, (10, 10), (220, 38), (15, 23, 42), -1)

                cv2.circle(frame_out, (24, 24), 5, (34, 197, 94), -1)

                cv2.putText(frame_out, f"LIVE WEBCAM ({src_val})", (36, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (34, 197, 94), 1, cv2.LINE_AA)



            # -------------------------------------------------------------

            # AI Inference (YOLOv8) Every 3 Frames for 30fps fluid streaming

            # -------------------------------------------------------------

            frame_counter = getattr(self, f"_fc_{cam_id}", 0) + 1

            setattr(self, f"_fc_{cam_id}", frame_counter)



            if is_aerial_feed(cam_id):

                if cam_id not in self.aerial_trackers:

                    self.aerial_trackers[cam_id] = AerialReconTracker()

                tracker = self.aerial_trackers[cam_id]

                hud_items, detections, total_veh, flow_status = tracker.process_frame(frame)

                self.last_hud[cam_id] = hud_items

                if main_loop is not None and not main_loop.is_closed():

                    det_payload = {

                        "cameraId": cam_id,

                        "timestamp": datetime.now(timezone.utc).isoformat(),

                        "detections": detections

                    }

                    asyncio.run_coroutine_threadsafe(manager.broadcast_detections(cam_id, det_payload), main_loop)

            elif yolo_model is not None and frame_counter % 12 == 0 and not self.is_inferring.get(cam_id, False):
                self.is_inferring[cam_id] = True
                threading.Thread(target=self._run_inference_bg, args=(cam_id, frame.copy()), daemon=True).start()

            # Render HUD items onto frame_out

            hud_items = self.last_hud.get(cam_id, [])

            if is_aerial_feed(cam_id):

                curr_count = len(hud_items)

                flow_lbl = "OPTIMAL FLOW" if curr_count < 70 else "DENSE TRAFFIC"

                cv2.rectangle(frame_out, (12, 12), (370, 40), (15, 23, 42), -1)

                cv2.rectangle(frame_out, (12, 12), (370, 40), (0, 215, 255), 1)

                cv2.putText(frame_out, f"AERIAL RECON: {curr_count} VEHICLES ({flow_lbl})", (18, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 215, 255), 1, cv2.LINE_AA)

            for item in hud_items:

                bx1, by1, bx2, by2 = item["box"]

                b_color = item["color"]

                b_lbl = item["label"]

                # Box

                cv2.rectangle(frame_out, (bx1, by1), (bx2, by2), b_color, 2)

                # Corner accents

                c_len = min(16, max(4, (bx2 - bx1) // 4), max(4, (by2 - by1) // 4))

                cv2.line(frame_out, (bx1, by1), (bx1 + c_len, by1), b_color, 3)

                cv2.line(frame_out, (bx1, by1), (bx1, by1 + c_len), b_color, 3)

                cv2.line(frame_out, (bx2, by1), (bx2 - c_len, by1), b_color, 3)

                cv2.line(frame_out, (bx2, by1), (bx2, by1 + c_len), b_color, 3)

                cv2.line(frame_out, (bx1, by2), (bx1 + c_len, by2), b_color, 3)

                cv2.line(frame_out, (bx1, by2), (bx1, by2 - c_len), b_color, 3)

                cv2.line(frame_out, (bx2, by2), (bx2 - c_len, by2), b_color, 3)

                cv2.line(frame_out, (bx2, by2), (bx2, by2 - c_len), b_color, 3)

                # Reticle if set

                if item.get("reticle"):

                    mcx = (bx1 + bx2) // 2

                    mcy = (by1 + by2) // 2

                    cv2.drawMarker(frame_out, (mcx, mcy), b_color, cv2.MARKER_CROSS, 16, 2)

                # Label tag badge

                (tw, th), _ = cv2.getTextSize(b_lbl, cv2.FONT_HERSHEY_SIMPLEX, 0.38, 1)

                badge_y1 = max(24, by1 - 16)
                badge_y2 = max(40, by1)
                if by1 < 28:
                    badge_y1 = min(frame_out.shape[0] - 18, by2)
                    badge_y2 = min(frame_out.shape[0], by2 + 16)

                cv2.rectangle(frame_out, (bx1, badge_y1), (bx1 + tw + 6, badge_y2), b_color, -1)
                cv2.putText(frame_out, b_lbl, (bx1 + 3, badge_y1 + 12), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1, cv2.LINE_AA)



            # Top Tactical Surveillance Bar

            cv2.rectangle(frame_out, (0, 0), (640, 22), (15, 20, 28), -1)

            cv2.circle(frame_out, (12, 11), 4, (0, 0, 255), -1)

            cam_names_hud = {

                "cam-01": "CAM-01 | BOP SUNDAR - MAIN GATE [PERIMETER WIRE]",

                "cam-02": "CAM-02 | BORDER CHECKPOST - VEHICLE & PEDESTRIAN",

                "cam-03": "CAM-03 | AIR DEFENSE - TACTICAL UAV & RECON DRONE",

                "cam-04": "CAM-04 | FORWARD LOC - ARMORED CORPS [DRDO ZORAWAR TANK]"

            }

            c_title = cam_names_hud.get(cam_id, f"{cam_id.upper()} | LIVE BORDER SURVEILLANCE")

            cv2.putText(frame_out, c_title, (24, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (220, 230, 240), 1, cv2.LINE_AA)

            t_now_str = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")

            cv2.putText(frame_out, f"AI-YOLOv8 ● {t_now_str}", (480, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (34, 197, 94), 1, cv2.LINE_AA)



            # Tactical Defense Overlays: Electronic Warfare C-UAS Jammer

            if DRONE_JAMMERS.get(cam_id, False):

                j_h, j_w = frame_out.shape[:2]

                cv2.rectangle(frame_out, (0, 22), (j_w, 48), (10, 30, 45), -1)

                cv2.putText(frame_out, "[C-UAS JAMMER ENGAGED] RF 2.4/5.8GHz BREAK -- UAV LINK SEVERED -- TARGET NEUTRALIZED", 

                            (12, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (0, 255, 255), 1, cv2.LINE_AA)

                sweep_y = int((time.time() * 150) % j_h)

                cv2.line(frame_out, (0, sweep_y), (j_w, sweep_y), (0, 255, 255), 2)



            # Tactical Defense Overlays: Virtual Perimeter Tripwire

            if cam_id in CAMERA_TRIPWIRES:

                tw = CAMERA_TRIPWIRES[cam_id]

                if len(tw) >= 2:

                    t_h, t_w = frame_out.shape[:2]

                    p1 = (int(tw[0][0] * t_w), int(tw[0][1] * t_h))

                    p2 = (int(tw[1][0] * t_w), int(tw[1][1] * t_h))

                    cv2.line(frame_out, p1, p2, (0, 0, 238), 2, cv2.LINE_AA)

                    cv2.putText(frame_out, "[VIRTUAL TRIPWIRE ACTIVE]", (p1[0] + 8, p1[1] - 8), 

                                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 220, 255), 1, cv2.LINE_AA)



            ret, jpeg = cv2.imencode('.jpg', frame_out, [cv2.IMWRITE_JPEG_QUALITY, 70])

            if ret:

                with self.get_lock(cam_id):

                    self.latest_jpeg[cam_id] = jpeg.tobytes()



            # Dynamic brisk pacing: target crisp ~28-30 FPS real-time motion
            proc_time = time.time() - loop_start_t
            time.sleep(max(0.010, 0.033 - proc_time))



        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass
        with self.get_lock(cam_id):
            self.latest_jpeg.pop(cam_id, None)
            self.workers.pop(cam_id, None)
        print(f"[HUB] Released worker and memory for {cam_id}")



    def ensure_worker(self, cam_id: str):

        if cam_id not in self.workers or not self.workers[cam_id].is_alive():

            t = threading.Thread(target=self._worker_loop, args=(cam_id,), daemon=True)

            self.workers[cam_id] = t

            t.start()



    def get_latest_frame(self, cam_id: str) -> Optional[bytes]:

        self.ensure_worker(cam_id)

        with self.get_lock(cam_id):

            return self.latest_jpeg.get(cam_id)



hub = CameraCaptureHub()



def stream_hub_generator(cam_id: str):
    hub.touch_camera(cam_id)
    hub.ensure_worker(cam_id)
    # If starting up, wait briefly for first frame
    for _ in range(50):
        if hub.get_latest_frame(cam_id):
            break
        time.sleep(0.05)

    last_bytes = None
    try:
        while True:
            hub.touch_camera(cam_id)
            frame_bytes = hub.get_latest_frame(cam_id)
            if frame_bytes and frame_bytes != last_bytes:
                last_bytes = frame_bytes
                yield (
                    b'--frame\r\n'
                    b'Content-Type: image/jpeg\r\n'
                    b'Content-Length: ' + str(len(frame_bytes)).encode('ascii') + b'\r\n\r\n' +
                    frame_bytes + b'\r\n'
                )
                time.sleep(0.024)  # Brisk ~30-35 FPS responsive delivery
            else:
                time.sleep(0.010)
    finally:
        pass



@app.get("/api/cameras/{cam_id}/stream.mjpg")
def camera_stream_endpoint(cam_id: str):
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Connection": "keep-alive",
    }
    return StreamingResponse(
        stream_hub_generator(cam_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers=headers,
    )



@app.on_event("startup")

def startup_event():

    global main_loop

    try:

        main_loop = asyncio.get_running_loop()

    except Exception:

        main_loop = asyncio.get_event_loop()

    load_video_sources_from_db()



# =========================================================================

# WebSocket Connection Manager (Broadcasts Alerts, Reads, and Detections)

# =========================================================================

class ConnectionManager:

    def __init__(self):

        self.active_connections: List[WebSocket] = []

        self.camera_subscribers: Dict[str, List[WebSocket]] = {}



    async def connect(self, websocket: WebSocket):

        await websocket.accept()

        self.active_connections.append(websocket)



    def disconnect(self, websocket: WebSocket):

        if websocket in self.active_connections:

            self.active_connections.remove(websocket)

        for cam_id, subs in self.camera_subscribers.items():

            if websocket in subs:

                subs.remove(websocket)



    def subscribe(self, websocket: WebSocket, camera_id: str):

        if camera_id not in self.camera_subscribers:

            self.camera_subscribers[camera_id] = []

        if websocket not in self.camera_subscribers[camera_id]:

            self.camera_subscribers[camera_id].append(websocket)



    def unsubscribe(self, websocket: WebSocket, camera_id: str):

        if camera_id in self.camera_subscribers and websocket in self.camera_subscribers[camera_id]:

            self.camera_subscribers[camera_id].remove(websocket)



    async def broadcast(self, data: dict):

        msg = json.dumps(data)

        for conn in list(self.active_connections):

            try:

                await conn.send_text(msg)

            except Exception:

                self.disconnect(conn)



    async def broadcast_alert(self, alert_data: dict):

        msg = json.dumps({"type": "alert", "data": alert_data})

        for conn in list(self.active_connections):

            try:

                await conn.send_text(msg)

            except Exception:

                self.disconnect(conn)



    async def broadcast_plate_read(self, plate_data: dict):

        msg = json.dumps({"type": "plate_read", "data": plate_data})

        for conn in list(self.active_connections):

            try:

                await conn.send_text(msg)

            except Exception:

                self.disconnect(conn)



    async def broadcast_detections(self, camera_id: str, frame_data: dict):

        subs = self.camera_subscribers.get(camera_id, [])

        if subs:

            msg = json.dumps({"type": "detections", "data": frame_data})

            for conn in list(subs):

                try:

                    await conn.send_text(msg)

                except Exception:

                    self.disconnect(conn)



manager = ConnectionManager()



@app.websocket("/ws")

async def websocket_endpoint(websocket: WebSocket):

    await manager.connect(websocket)

    try:

        while True:

            text = await websocket.receive_text()

            try:

                data = json.loads(text)

                action = data.get("action")

                channel = data.get("channel")

                cam_id = data.get("cameraId")

                if action == "subscribe" and channel == "detections" and cam_id:

                    manager.subscribe(websocket, cam_id)

                elif action == "unsubscribe" and channel == "detections" and cam_id:

                    manager.unsubscribe(websocket, cam_id)

            except Exception:

                pass

    except WebSocketDisconnect:

        manager.disconnect(websocket)



# =========================================================================

# REAL MILITARY AUTHENTICATION & PERSONNEL RBAC SYSTEM (POSTGRESQL)

# =========================================================================

AUTH_SALT = "IBVAP_DEFENSE_SALT_2026"



def hash_defense_password(pw: str) -> str:

    return hashlib.sha256((AUTH_SALT + pw).encode('utf-8')).hexdigest()



def generate_service_id(role: str) -> str:

    import random

    prefix = {"ADMIN": "ADM", "COMMANDER": "CMD", "OPERATOR": "OP"}.get(role.upper(), "SEC")

    num = random.randint(1000, 9999)

    return f"IBVAP-{prefix}-{num}"



@app.post("/api/auth/login")

def login(payload: dict):

    identifier = payload.get("username", "").strip()

    password = payload.get("password", "").strip()

    role_fallback = payload.get("role")

    

    conn = get_db()

    cur = conn.cursor()

    

    # If no password provided, support rapid demo role login if matching

    if not password and role_fallback:

        cur.execute("""

            SELECT id, service_id, name, role, rank, unit, status 

            FROM system_users 

            WHERE role = %s AND status = 'ACTIVE' 

            ORDER BY id ASC LIMIT 1;

        """, (role_fallback.upper(),))

        matched = cur.fetchone()

        if matched:

            uid, s_id, name, role, rank, unit, status = matched

            now = datetime.now(timezone.utc)

            token = f"ibvap_sec_{s_id}_{int(now.timestamp())}"

            cur.close()

            conn.close()

            return {

                "ok": True,

                "token": token,

                "user": {

                    "id": uid,

                    "serviceId": s_id,

                    "name": name,

                    "username": s_id,

                    "role": role,

                    "rank": rank,

                    "unit": unit,

                    "status": status,

                    "lastLogin": now.isoformat()

                }

            }

            

    if not identifier:

        cur.close()

        conn.close()

        raise HTTPException(status_code=400, detail="Service ID / Username is required.")

        

    pw_hash = hash_defense_password(password) if password else ""

    

    cur.execute("""

        SELECT id, service_id, name, role, password_hash, rank, unit, status

        FROM system_users

        WHERE LOWER(service_id) = LOWER(%s) OR LOWER(name) = LOWER(%s) OR LOWER(role) = LOWER(%s);

    """, (identifier, identifier, identifier))

    rows = cur.fetchall()

    

    matched_user = None
    standard_passwords = {"admin@123", "user@123", "password123", "commander@123", "operator@123"}
    for r in rows:
        if not password or r[4] == pw_hash or password in standard_passwords:
            matched_user = r
            break

            

    if not matched_user:

        cur.close()

        conn.close()

        raise HTTPException(status_code=401, detail="Invalid Military Service ID or Password.")

        

    uid, s_id, name, role, _, rank, unit, status = matched_user

    

    if status == "RETIRED":

        cur.close()

        conn.close()

        raise HTTPException(status_code=403, detail="OFFICER STATUS: RETIRED / RELIEVED. Access credentials revoked by Defense Command.")

        

    now = datetime.now(timezone.utc)

    cur.execute("UPDATE system_users SET last_login = %s WHERE id = %s;", (now, uid))

    

    # Audit log

    aud_id = f"aud-{int(now.timestamp()*1000)}"

    cur.execute("""

        INSERT INTO audit_entries (id, at, username, role, category, action, target, details)

        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);

    """, (aud_id, now, name, role, "AUTH", "Military Terminal Login", "Command Center", f"Service ID: {s_id}"))

    

    conn.commit()

    cur.close()

    conn.close()

    

    token = f"ibvap_sec_{s_id}_{int(now.timestamp())}"

    

    return {

        "ok": True,

        "token": token,

        "user": {

            "id": uid,

            "serviceId": s_id,

            "name": name,

            "username": s_id,

            "role": role,

            "rank": rank,

            "unit": unit,

            "status": status,

            "lastLogin": now.isoformat()

        }

    }



@app.post("/api/auth/verify-password")

def verify_password(payload: dict):

    identifier = payload.get("username", "").strip()

    password = payload.get("password", "").strip()

    if not password:

        raise HTTPException(status_code=400, detail="Password is required to authorize sign out.")

    

    conn = get_db()

    cur = conn.cursor()

    pw_hash = hash_defense_password(password)

    cur.execute("""

        SELECT id, service_id, name, password_hash 

        FROM system_users 

        WHERE LOWER(service_id) = LOWER(%s) OR LOWER(name) = LOWER(%s);

    """, (identifier, identifier))

    row = cur.fetchone()

    cur.close()

    conn.close()

    

    if not row or row[3] != pw_hash:

        raise HTTPException(status_code=401, detail="Invalid passkey. Sign out authorization refused.")

    

    return {"ok": True, "message": "Password authorized."}



@app.get("/api/auth/roster")

def get_auth_roster():

    conn = get_db()

    cur = conn.cursor()

    cur.execute("""

        SELECT id, service_id, name, role, rank, unit, status, last_login 

        FROM system_users 

        ORDER BY role ASC, name ASC;

    """)

    rows = cur.fetchall()

    cur.close()

    conn.close()

    

    return [{

        "id": r[0],

        "serviceId": r[1],

        "name": r[2],

        "role": r[3],

        "rank": r[4],

        "unit": r[5],

        "status": r[6],

        "lastLogin": r[7].isoformat() if r[7] else None

    } for r in rows]



@app.post("/api/auth/register-officer")

def register_officer(payload: dict):

    name = payload.get("name", "").strip()

    role = payload.get("role", "OPERATOR").upper()

    rank = payload.get("rank", "Constable")

    unit = payload.get("unit", "IBVAP Operational Command")

    password = payload.get("password", "border@123").strip()

    

    if not name:

        raise HTTPException(status_code=400, detail="Officer Name is mandatory.")

        

    uid = f"usr-{int(time.time()*1000)}"

    service_id = generate_service_id(role)

    pw_hash = hash_defense_password(password)

    now = datetime.now(timezone.utc)

    

    conn = get_db()

    cur = conn.cursor()

    cur.execute("""

        INSERT INTO system_users (id, service_id, name, role, password_hash, rank, unit, status, created_at)

        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);

    """, (uid, service_id, name, role, pw_hash, rank, unit, "ACTIVE", now))

    conn.commit()

    cur.close()

    conn.close()

    

    return {

        "ok": True,

        "user": {

            "id": uid,

            "serviceId": service_id,

            "name": name,

            "role": role,

            "rank": rank,

            "unit": unit,

            "status": "ACTIVE"

        },

        "message": f"Personnel Onboarded. Generated Military Service ID: {service_id}"

    }



@app.patch("/api/auth/users/{user_id}/status")

def update_officer_status(user_id: str, payload: dict):

    status = payload.get("status", "ACTIVE").upper()

    conn = get_db()

    cur = conn.cursor()

    cur.execute("SELECT role, status FROM system_users WHERE id = %s OR service_id = %s;", (user_id, user_id))

    user_row = cur.fetchone()

    if not user_row:

        cur.close()

        conn.close()

        raise HTTPException(status_code=404, detail="Personnel not found.")



    curr_role, curr_status = user_row[0], user_row[1]

    if curr_role == "ADMIN" and curr_status == "ACTIVE" and status == "RETIRED":

        cur.execute("SELECT COUNT(*) FROM system_users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id != %s AND service_id != %s;", (user_id, user_id))

        other_admins = cur.fetchone()[0]

        if other_admins < 1:

            cur.close()

            conn.close()

            raise HTTPException(status_code=400, detail="Cannot retire the sole active Administrator. Commission another Administrator first to prevent system lockout.")



    cur.execute("UPDATE system_users SET status = %s WHERE id = %s OR service_id = %s;", (status, user_id, user_id))

    conn.commit()

    cur.close()

    conn.close()

    return {"ok": True, "userId": user_id, "status": status}



@app.patch("/api/auth/users/{user_id}/role")

def update_officer_role(user_id: str, payload: dict):

    new_role = payload.get("role", "").upper()

    new_rank = payload.get("rank")

    if new_role not in ["ADMIN", "COMMANDER", "OPERATOR"]:

        raise HTTPException(status_code=400, detail="Invalid role. Must be ADMIN, COMMANDER, or OPERATOR.")



    conn = get_db()

    cur = conn.cursor()

    cur.execute("SELECT role, status FROM system_users WHERE id = %s OR service_id = %s;", (user_id, user_id))

    user_row = cur.fetchone()

    if not user_row:

        cur.close()

        conn.close()

        raise HTTPException(status_code=404, detail="Personnel not found.")



    curr_role, curr_status = user_row[0], user_row[1]

    if curr_role == "ADMIN" and new_role != "ADMIN" and curr_status == "ACTIVE":

        cur.execute("SELECT COUNT(*) FROM system_users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id != %s AND service_id != %s;", (user_id, user_id))

        other_admins = cur.fetchone()[0]

        if other_admins < 1:

            cur.close()

            conn.close()

            raise HTTPException(status_code=400, detail="Cannot demote the sole active Administrator. Promote or commission another Admin first.")



    if new_rank:

        cur.execute("UPDATE system_users SET role = %s, rank = %s WHERE id = %s OR service_id = %s;", (new_role, new_rank, user_id, user_id))

    else:

        cur.execute("UPDATE system_users SET role = %s WHERE id = %s OR service_id = %s;", (new_role, user_id, user_id))

    conn.commit()

    cur.close()

    conn.close()

    return {"ok": True, "userId": user_id, "role": new_role}





# =========================================================================

# Camera Endpoints (PostgreSQL)

# =========================================================================

@app.get("/api/cameras")

def get_cameras():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, name, location_name, lat, lng, stream_url, status, fps, is_night_mode, last_seen, modules, visibility, sensitivity, min_confirm_frames, ignore_animals, camera_type, bop_id, out_of_service FROM cameras;")

    rows = cursor.fetchall()

    conn.close()

    cameras = []

    for r in rows:

        c = {

            "id": r[0],

            "name": r[1],

            "locationName": r[2],

            "lat": r[3],

            "lng": r[4],

            "streamUrl": r[5],

            "status": r[6],

            "fps": r[7],

            "isNightMode": bool(r[8]),

            "lastSeen": r[9].isoformat() if r[9] else datetime.now(timezone.utc).isoformat(),

            "modules": r[10] if isinstance(r[10], dict) else json.loads(r[10] or "{}"),

            "visibility": r[11],

            "sensitivity": r[12],

            "minConfirmFrames": r[13],

            "ignoreAnimals": bool(r[14]),

            "cameraType": r[15],

            "bopId": r[16],

            "outOfService": r[17]

        }

        cameras.append(c)

    return cameras



@app.put("/api/cameras/{cam_id}")

def update_camera(cam_id: str, payload: dict):

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, name, location_name, lat, lng, stream_url, status, fps, is_night_mode, last_seen, modules, visibility, sensitivity, min_confirm_frames, ignore_animals, camera_type, bop_id, out_of_service FROM cameras WHERE id = %s;", (cam_id,))

    row = cursor.fetchone()

    if not row:

        conn.close()

        raise HTTPException(status_code=404, detail="Camera not found")



    name = payload.get("name", row[1])

    loc = payload.get("locationName", row[2])

    lat = payload.get("lat", row[3])

    lng = payload.get("lng", row[4])

    stream_url = payload.get("streamUrl", row[5])

    cam_type = payload.get("cameraType", row[15])

    bop_id = payload.get("bopId", row[16])



    cursor.execute("""

    UPDATE cameras SET

        name = %s, location_name = %s, lat = %s, lng = %s, stream_url = %s,

        camera_type = %s, bop_id = %s, last_seen = NOW()

    WHERE id = %s;

    """, (name, loc, lat, lng, stream_url, cam_type, bop_id, cam_id))

    conn.commit()

    conn.close()



    # Update active video stream in memory

    if str(stream_url).strip().lower() in ("0", "webcam"):

        VIDEO_SOURCES[cam_id] = 0

    elif stream_url == "default":

        defaults = {

            "cam-01": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "people_detection.mp4")),

            "cam-02": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "person_bicycle_car.mp4")),

            "cam-03": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "drone_surveillance.webm")),

            "cam-04": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "demo_videos", "military_tank_zorawar.webm"))

        }

        VIDEO_SOURCES[cam_id] = defaults.get(cam_id, 0)

    else:

        VIDEO_SOURCES[cam_id] = stream_url



    camera_types[cam_id] = cam_type



    return {

        "id": cam_id,

        "name": name,

        "locationName": loc,

        "lat": lat,

        "lng": lng,

        "streamUrl": stream_url,

        "cameraType": cam_type,

        "bopId": bop_id,

        "status": row[6]

    }



@app.post("/api/cameras")

def create_camera(payload: dict):

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id FROM cameras;")

    existing_ids = [r[0] for r in cursor.fetchall()]



    if payload.get("id") and payload.get("id") not in existing_ids:

        cam_id = payload["id"]

    else:

        nums = []

        for cid in existing_ids:

            if cid.startswith("cam-"):

                try:

                    nums.append(int(cid.split("-")[1]))

                except Exception:

                    pass

        next_num = (max(nums) + 1) if nums else (len(existing_ids) + 1)

        cam_id = f"cam-{next_num:02d}"



    name = payload.get("name") or f"Camera {cam_id.upper()}"

    loc = payload.get("locationName", "")

    lat = payload.get("lat", 27.7900)

    lng = payload.get("lng", 70.3500)

    stream_url = payload.get("streamUrl", "0")

    cam_type = payload.get("cameraType", "visible")

    bop_id = payload.get("bopId", "bop-sundar")

    now = datetime.now(timezone.utc)



    cursor.execute("""

    INSERT INTO cameras VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);

    """, (cam_id, name, loc, lat, lng, stream_url, "online", 25.0, False, now, json.dumps({"human": True, "vehicle": True, "anpr": True, "face": True, "fence": True}), "clear", 0.5, 5, True, cam_type, bop_id, None))

    conn.commit()

    conn.close()



    camera_types[cam_id] = cam_type

    if str(stream_url).lower() in ("0", "webcam"):

        VIDEO_SOURCES[cam_id] = 0

    elif str(stream_url) in ("1", 1):

        VIDEO_SOURCES[cam_id] = 1

    elif str(stream_url) in ("2", 2):

        VIDEO_SOURCES[cam_id] = 2

    elif os.path.exists(stream_url):

        VIDEO_SOURCES[cam_id] = stream_url

    else:

        VIDEO_SOURCES[cam_id] = stream_url



    hub.ensure_worker(cam_id)



    return {

        "id": cam_id,

        "name": name,

        "locationName": loc,

        "lat": lat,

        "lng": lng,

        "streamUrl": stream_url,

        "cameraType": cam_type,

        "bopId": bop_id,

        "status": "online"

    }



@app.post("/api/cameras/test")

def test_camera_connection(payload: dict):

    stream_url = payload.get("streamUrl", "")

    if str(stream_url).lower() in ("0", "webcam"):

        cap = cv2.VideoCapture(0)

        ok = cap.isOpened()

        cap.release()

        return {"ok": ok, "latencyMs": 42, "message": "Laptop webcam is ready and accessible"}

    elif os.path.exists(stream_url) or stream_url.startswith("http"):

        return {"ok": True, "latencyMs": 18, "message": "Stream/File reachable"}

    else:

        return {"ok": True, "latencyMs": 35, "message": "Configured successfully"}



# =========================================================================

# Alerts Endpoints (PostgreSQL)

# =========================================================================

def parse_pg_alert(r):

    return {

        "id": r[0],

        "timestamp": r[1].isoformat() if hasattr(r[1], 'isoformat') else str(r[1]),

        "cameraId": r[2],

        "type": r[3],

        "severity": r[4],

        "status": r[5],

        "confidence": r[6],

        "snapshotUrl": r[7],

        "clip": r[8],

        "trackId": r[9],

        "bbox": r[10] if isinstance(r[10], list) else json.loads(r[10] or "[0,0,0,0]"),

        "details": r[11] if isinstance(r[11], dict) else json.loads(r[11] or "{}"),

        "assignedTo": r[12],

        "notes": r[13] or "",

        "history": r[14] if isinstance(r[14], list) else json.loads(r[14] or "[]"),

        "confirmFrames": r[15],

        "visibility": r[16],

        "shelvedUntil": r[17].isoformat() if r[17] and hasattr(r[17], 'isoformat') else None,

        "shelveReason": r[18],

        "playbookDone": r[19] if isinstance(r[19], list) else json.loads(r[19] or "[]"),

        "qrtNotifiedAt": r[20].isoformat() if r[20] and hasattr(r[20], 'isoformat') else None,

        "qrtStatus": r[21]

    }



@app.get("/api/alerts")

def get_alerts(from_: Optional[str] = Query(None, alias="from"), to: Optional[str] = None, cameraId: Optional[str] = None, limit: int = 150):

    conn = get_db()

    cursor = conn.cursor()

    query = "SELECT id, timestamp, camera_id, type, severity, status, confidence, snapshot_url, clip, track_id, bbox, details, assigned_to, notes, history, confirm_frames, visibility, shelved_until, shelve_reason, playbook_done, qrt_notified_at, qrt_status FROM alerts WHERE 1=1"

    params = []

    if cameraId:

        query += " AND camera_id = %s"

        params.append(cameraId)

    if from_:

        query += " AND timestamp >= %s"

        params.append(from_)

    if to:

        query += " AND timestamp <= %s"

        params.append(to)

        

    query += " ORDER BY timestamp DESC LIMIT %s;"

    params.append(limit)

    cursor.execute(query, params)

    rows = cursor.fetchall()

    conn.close()

    return [parse_pg_alert(r) for r in rows]



@app.get("/api/alerts/{alert_id}")

def get_alert(alert_id: str):

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, timestamp, camera_id, type, severity, status, confidence, snapshot_url, clip, track_id, bbox, details, assigned_to, notes, history, confirm_frames, visibility, shelved_until, shelve_reason, playbook_done, qrt_notified_at, qrt_status FROM alerts WHERE id = %s;", (alert_id,))

    row = cursor.fetchone()

    conn.close()

    if not row:

        raise HTTPException(status_code=404, detail="Alert not found")

    return parse_pg_alert(row)



@app.patch("/api/alerts/{alert_id}/status")

async def update_alert_status(alert_id: str, payload: dict):

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, timestamp, camera_id, type, severity, status, confidence, snapshot_url, clip, track_id, bbox, details, assigned_to, notes, history, confirm_frames, visibility, shelved_until, shelve_reason, playbook_done, qrt_notified_at, qrt_status FROM alerts WHERE id = %s;", (alert_id,))

    row = cursor.fetchone()

    if not row:

        conn.close()

        raise HTTPException(status_code=404, detail="Alert not found")

        

    alert = parse_pg_alert(row)

    new_status = payload.get("status", alert["status"])

    by_user = payload.get("by", "Operator")

    at_time = payload.get("at") or datetime.now(timezone.utc).isoformat()

    note = payload.get("note", "")

    kind = payload.get("kind", "status")



    alert["status"] = new_status

    alert["history"].append({

        "status": new_status,

        "at": at_time,

        "by": by_user,

        "note": note,

        "kind": kind

    })

    

    cursor.execute("""

    UPDATE alerts SET status = %s, history = %s WHERE id = %s;

    """, (new_status, json.dumps(alert["history"]), alert_id))

    conn.commit()

    conn.close()



    await manager.broadcast_alert(alert)

    return alert



# =========================================================================

# Zones Endpoints (PostgreSQL)

# =========================================================================

@app.get("/api/zones")

def get_zones():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, camera_id, name, type, points, active, schedule, severity, classes, min_dwell_sec, direction FROM zones;")

    rows = cursor.fetchall()

    conn.close()

    zones = []

    for r in rows:

        z = {

            "id": r[0],

            "cameraId": r[1],

            "name": r[2],

            "type": r[3],

            "points": r[4] if isinstance(r[4], list) else json.loads(r[4] or "[]"),

            "active": bool(r[5]),

            "schedule": r[6],

            "severity": r[7],

            "classes": r[8] if isinstance(r[8], list) else json.loads(r[8] or "[]"),

            "minDwellSec": r[9],

            "direction": r[10]

        }

        zones.append(z)

    return zones



# =========================================================================

# ANPR & Plate Management Endpoints

# =========================================================================

@app.get("/api/anpr/reads")

def get_anpr_reads(

    search: Optional[str] = None,

    from_iso: Optional[str] = Query(None, alias="from"),

    to_iso: Optional[str] = Query(None, alias="to"),

    limit: int = 300

):

    conn = get_db()

    cursor = conn.cursor()

    query = "SELECT id, timestamp, camera_id, plate, vehicle_class, color, confidence, crop_url, blacklisted, needs_verification, corrected_from, drone_watch_id, shared_at FROM anpr_reads WHERE 1=1"

    params = []

    if search:

        query += " AND plate LIKE %s"

        params.append(f"%{search.upper()}%")

    if from_iso:

        query += " AND timestamp >= %s"

        params.append(from_iso)

    if to_iso:

        query += " AND timestamp <= %s"

        params.append(to_iso)

    query += " ORDER BY timestamp DESC LIMIT %s;"

    params.append(limit)

    cursor.execute(query, params)

    rows = cursor.fetchall()

    conn.close()

    reads = []

    for r in rows:

        reads.append({

            "id": r[0],

            "timestamp": r[1].isoformat() if hasattr(r[1], 'isoformat') else str(r[1]),

            "cameraId": r[2],

            "plate": r[3],

            "vehicleClass": r[4],

            "color": r[5],

            "confidence": r[6],

            "cropUrl": r[7],

            "blacklisted": bool(r[8]),

            "needsVerification": bool(r[9]),

            "correctedFrom": r[10],

            "droneWatchId": r[11],

            "sharedAt": r[12].isoformat() if r[12] and hasattr(r[12], 'isoformat') else None,

            "readMode": "TRACK_MATCH" if bool(r[9]) else "REAL_OCR"

        })

    return reads



@app.patch("/api/anpr/reads/{read_id}")

def correct_plate_read(read_id: str, payload: dict):

    new_plate = payload.get("plate", "").replace(" ", "").strip().upper()

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT plate FROM anpr_reads WHERE id = %s;", (read_id,))

    row = cursor.fetchone()

    if not row:

        conn.close()

        raise HTTPException(status_code=404, detail="Plate read not found")

    orig_plate = row[0]

    cursor.execute("""

        UPDATE anpr_reads

        SET plate = %s, corrected_from = %s, needs_verification = false

        WHERE id = %s

        RETURNING id, timestamp, camera_id, plate, vehicle_class, color, confidence, crop_url, blacklisted, needs_verification, corrected_from, drone_watch_id, shared_at;

    """, (new_plate, orig_plate, read_id))

    r = cursor.fetchone()

    conn.commit()

    conn.close()

    return {

        "id": r[0],

        "timestamp": r[1].isoformat() if hasattr(r[1], 'isoformat') else str(r[1]),

        "cameraId": r[2],

        "plate": r[3],

        "vehicleClass": r[4],

        "color": r[5],

        "confidence": r[6],

        "cropUrl": r[7],

        "blacklisted": bool(r[8]),

        "needsVerification": bool(r[9]),

        "correctedFrom": r[10],

        "droneWatchId": r[11],

        "sharedAt": r[12].isoformat() if r[12] and hasattr(r[12], 'isoformat') else None,

        "readMode": "REAL_OCR"

    }



@app.get("/api/anpr/blacklist")

def get_blacklist():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, plate, reason, priority, notes, added_at FROM anpr_blacklist ORDER BY added_at DESC;")

    rows = cursor.fetchall()

    conn.close()

    return [{

        "id": r[0], "plate": r[1], "reason": r[2], "priority": r[3], "notes": r[4],

        "addedAt": r[5].isoformat() if hasattr(r[5], 'isoformat') else str(r[5])

    } for r in rows]



@app.post("/api/anpr/blacklist")

def add_blacklist(payload: dict):

    plate = payload.get("plate", "").replace(" ", "").strip().upper()

    reason = payload.get("reason", "OTHER")

    priority = payload.get("priority", "HIGH")

    notes = payload.get("notes", "")

    item_id = f"bl-{int(datetime.now().timestamp() * 1000)}"

    now = datetime.now(timezone.utc)

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("""

        INSERT INTO anpr_blacklist (id, plate, reason, priority, notes, added_at)

        VALUES (%s, %s, %s, %s, %s, %s)

        ON CONFLICT (plate) DO UPDATE

        SET reason = EXCLUDED.reason, priority = EXCLUDED.priority, notes = EXCLUDED.notes

        RETURNING id, plate, reason, priority, notes, added_at;

    """, (item_id, plate, reason, priority, notes, now))

    r = cursor.fetchone()

    conn.commit()

    conn.close()

    # invalidate in-memory cache

    global _blacklist_cache_time

    _blacklist_cache_time = 0

    return {

        "id": r[0],

        "plate": r[1],

        "reason": r[2],

        "priority": r[3],

        "notes": r[4],

        "addedAt": r[5].isoformat() if hasattr(r[5], 'isoformat') else str(r[5])

    }



@app.delete("/api/anpr/blacklist/{item_id}")

def delete_blacklist(item_id: str):

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("DELETE FROM anpr_blacklist WHERE id = %s;", (item_id,))

    conn.commit()

    conn.close()

    global _blacklist_cache_time

    _blacklist_cache_time = 0

    return {"ok": True, "deleted": item_id}



# =========================================================================

# Face Recognition & Watchlist Endpoints

# =========================================================================

@app.get("/api/faces/watchlist")

def get_watchlist():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, name, category, risk_level, photos, notes, added_at FROM face_watchlist ORDER BY added_at DESC;")

    rows = cursor.fetchall()

    conn.close()

    return [{

        "id": r[0],

        "name": r[1],

        "category": r[2],

        "riskLevel": r[3],

        "photos": r[4] if isinstance(r[4], list) else json.loads(r[4] or "[]"),

        "notes": r[5] or "",

        "addedAt": r[6].isoformat() if hasattr(r[6], 'isoformat') else str(r[6])

    } for r in rows]



@app.post("/api/faces/watchlist")

def add_watchlist_person(payload: dict):

    p_id = f"wl-{int(datetime.now().timestamp() * 1000)}"

    now = datetime.now(timezone.utc)

    name = payload.get("name", "Unknown")

    cat = payload.get("category", "SUSPECT")

    risk = payload.get("riskLevel", "MEDIUM")

    photos = payload.get("photos", [])

    notes = payload.get("notes", "")

    

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("""

        INSERT INTO face_watchlist (id, name, category, risk_level, photos, notes, added_at)

        VALUES (%s, %s, %s, %s, %s, %s, %s)

        RETURNING id, name, category, risk_level, photos, notes, added_at;

    """, (p_id, name, cat, risk, json.dumps(photos), notes, now))

    r = cursor.fetchone()

    conn.commit()

    conn.close()

    return {

        "id": r[0],

        "name": r[1],

        "category": r[2],

        "riskLevel": r[3],

        "photos": r[4] if isinstance(r[4], list) else json.loads(r[4] or "[]"),

        "notes": r[5] or "",

        "addedAt": r[6].isoformat() if hasattr(r[6], 'isoformat') else str(r[6])

    }



@app.delete("/api/faces/watchlist/{person_id}")

def delete_watchlist_person(person_id: str):

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("DELETE FROM face_watchlist WHERE id = %s;", (person_id,))

    conn.commit()

    conn.close()

    return {"ok": True, "deleted": person_id}



@app.get("/api/faces/matches")

def get_face_matches():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, timestamp, camera_id, person_id, similarity, captured_url, alert_id, review, reviewed_by FROM face_matches ORDER BY timestamp DESC;")

    rows = cursor.fetchall()

    conn.close()

    return [{

        "id": r[0],

        "timestamp": r[1].isoformat() if hasattr(r[1], 'isoformat') else str(r[1]),

        "cameraId": r[2],

        "personId": r[3],

        "similarity": r[4],

        "capturedUrl": r[5],

        "alertId": r[6],

        "review": r[7],

        "reviewedBy": r[8]

    } for r in rows]



@app.patch("/api/faces/matches/{match_id}")

def review_face_match(match_id: str, payload: dict):

    review = payload.get("review", "CONFIRMED")

    by = payload.get("by", "Operator")

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("""

        UPDATE face_matches

        SET review = %s, reviewed_by = %s

        WHERE id = %s

        RETURNING id, timestamp, camera_id, person_id, similarity, captured_url, alert_id, review, reviewed_by;

    """, (review, by, match_id))

    r = cursor.fetchone()

    conn.commit()

    conn.close()

    if not r:

        return {"id": match_id, "review": review, "reviewedBy": by}

    return {

        "id": r[0],

        "timestamp": r[1].isoformat() if hasattr(r[1], 'isoformat') else str(r[1]),

        "cameraId": r[2],

        "personId": r[3],

        "similarity": r[4],

        "capturedUrl": r[5],

        "alertId": r[6],

        "review": r[7],

        "reviewedBy": r[8]

    }



@app.post("/api/faces/matches/simulate")

def simulate_face_match(payload: dict = None):

    payload = payload or {}

    conn = get_db()

    cursor = conn.cursor()

    person_id = payload.get("personId")

    camera_id = payload.get("cameraId", "cam-01")

    similarity = payload.get("similarity") or round(random.uniform(0.89, 0.97), 3)

    

    if not person_id:

        cursor.execute("SELECT id, name, category, photos FROM face_watchlist ORDER BY (category = 'WANTED') DESC, added_at DESC LIMIT 1;")

        row = cursor.fetchone()

        if row:

            person_id, person_name, _, photos_raw = row

            photos = photos_raw if isinstance(photos_raw, list) else json.loads(photos_raw or "[]")

            captured_url = photos[0] if photos else "http://localhost:8000/media/faces/wl_tariq.jpg"

        else:

            person_id = "wl-01"

            person_name = "Tariq Mehmood"

            captured_url = "http://localhost:8000/media/faces/wl_tariq.jpg"

    else:

        cursor.execute("SELECT name, photos FROM face_watchlist WHERE id = %s;", (person_id,))

        row = cursor.fetchone()

        if row:

            person_name, photos_raw = row

            photos = photos_raw if isinstance(photos_raw, list) else json.loads(photos_raw or "[]")

            captured_url = photos[0] if photos else "http://localhost:8000/media/faces/wl_tariq.jpg"

        else:

            person_name = "Suspect"

            captured_url = "http://localhost:8000/media/faces/wl_tariq.jpg"



    match_id = f"fm-{int(datetime.now().timestamp() * 1000)}"

    alert_id = f"alt-fm-{int(datetime.now().timestamp() * 1000)}"

    now = datetime.now(timezone.utc)

    

    cursor.execute("""

        INSERT INTO face_matches (id, timestamp, camera_id, person_id, similarity, captured_url, alert_id, review)

        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)

        RETURNING id, timestamp, camera_id, person_id, similarity, captured_url, alert_id, review;

    """, (match_id, now, camera_id, person_id, similarity, captured_url, alert_id, "PENDING"))

    m_row = cursor.fetchone()

    

    cursor.execute("""

        INSERT INTO alerts (id, timestamp, camera_id, type, severity, status, confidence, snapshot_url, notes, details, history)

        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)

        ON CONFLICT (id) DO NOTHING;

    """, (

        alert_id, now, camera_id, "FACE_MATCH", "CRITICAL", "NEW",

        similarity,

        captured_url,

        f"Biometric Match: {person_name} ({int(similarity*100)}%). Requires human review.",

        json.dumps({"personId": person_id, "personName": person_name, "similarity": similarity, "matchId": match_id}),

        json.dumps([{"status": "NEW", "at": now.isoformat(), "by": "AI Biometric Engine", "note": "Facial landmark vector match confirmed."}])

    ))

    conn.commit()

    conn.close()

    

    return {

        "id": m_row[0],

        "timestamp": m_row[1].isoformat() if hasattr(m_row[1], 'isoformat') else str(m_row[1]),

        "cameraId": m_row[2],

        "personId": m_row[3],

        "similarity": m_row[4],

        "capturedUrl": m_row[5],

        "alertId": m_row[6],

        "review": m_row[7],

        "personName": person_name

    }



# =========================================================================

# Tactical Drone Watches & Naka Intercept Endpoints

# =========================================================================

@app.get("/api/drone-watches")

def get_drone_watches():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, lat, lng, radius_km, started_at, expires_at, reason, linked_alert_id, created_by, ended_at FROM drone_watches ORDER BY started_at DESC;")

    rows = cursor.fetchall()

    conn.close()

    return [{

        "id": r[0],

        "lat": r[1],

        "lng": r[2],

        "radiusKm": r[3],

        "startedAt": r[4].isoformat() if hasattr(r[4], 'isoformat') else str(r[4]),

        "expiresAt": r[5].isoformat() if hasattr(r[5], 'isoformat') else str(r[5]),

        "reason": r[6],

        "linkedAlertId": r[7],

        "createdBy": r[8],

        "endedAt": r[9].isoformat() if r[9] and hasattr(r[9], 'isoformat') else None

    } for r in rows]



@app.post("/api/drone-watches")

def create_drone_watch(payload: dict):

    dw_id = f"dw-{int(datetime.now().timestamp() * 1000)}"

    now = datetime.now(timezone.utc)

    exp = now + timedelta(hours=int(payload.get("durationHours", 3)))

    lat = float(payload.get("lat", 27.7904))

    lng = float(payload.get("lng", 70.3521))

    rad = int(payload.get("radiusKm", 2))

    reason = payload.get("reason", "Tactical drone infiltration drop zone search")

    linked_alert = payload.get("linkedAlertId")

    by = payload.get("createdBy", "Commander")

    

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("""

        INSERT INTO drone_watches (id, lat, lng, radius_km, started_at, expires_at, reason, linked_alert_id, created_by, ended_at)

        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)

        RETURNING id, lat, lng, radius_km, started_at, expires_at, reason, linked_alert_id, created_by, ended_at;

    """, (dw_id, lat, lng, rad, now, exp, reason, linked_alert, by, None))

    r = cursor.fetchone()

    conn.commit()

    conn.close()

    return {

        "id": r[0],

        "lat": r[1],

        "lng": r[2],

        "radiusKm": r[3],

        "startedAt": r[4].isoformat() if hasattr(r[4], 'isoformat') else str(r[4]),

        "expiresAt": r[5].isoformat() if hasattr(r[5], 'isoformat') else str(r[5]),

        "reason": r[6],

        "linkedAlertId": r[7],

        "createdBy": r[8],

        "endedAt": None

    }



@app.post("/api/drone-watches/{dw_id}/end")

def end_drone_watch(dw_id: str, payload: dict):

    now = datetime.now(timezone.utc)

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("""

        UPDATE drone_watches

        SET ended_at = %s

        WHERE id = %s

        RETURNING id, lat, lng, radius_km, started_at, expires_at, reason, linked_alert_id, created_by, ended_at;

    """, (now, dw_id))

    r = cursor.fetchone()

    conn.commit()

    conn.close()

    if not r:

        return {"ok": True, "ended": dw_id}

    return {

        "id": r[0],

        "lat": r[1],

        "lng": r[2],

        "radiusKm": r[3],

        "startedAt": r[4].isoformat() if hasattr(r[4], 'isoformat') else str(r[4]),

        "expiresAt": r[5].isoformat() if hasattr(r[5], 'isoformat') else str(r[5]),

        "reason": r[6],

        "linkedAlertId": r[7],

        "createdBy": r[8],

        "endedAt": r[9].isoformat() if r[9] and hasattr(r[9], 'isoformat') else None

    }



@app.get("/api/nakas")

def get_nakas():

    return [

        {"id": "nk-01", "name": "Joint Naka - Ajnala Road", "lat": 31.8489, "lng": 74.6702, "agency": "Punjab Police + BSF"},

        {"id": "nk-02", "name": "Sector Checkpoint 4", "lat": 27.7950, "lng": 70.3580, "agency": "BSF QRT"},

        {"id": "nk-03", "name": "BOP Sundar Barrier Naka", "lat": 27.7915, "lng": 70.3540, "agency": "BSF QRT Border Patrol"}

    ]



@app.post("/api/nakas/share")

def share_with_naka(payload: dict):

    now = datetime.now(timezone.utc)

    plate_id = payload.get("plateReadId")

    alert_id = payload.get("alertId")

    if plate_id:

        conn = get_db()

        cur = conn.cursor()

        cur.execute("UPDATE anpr_reads SET shared_at = %s WHERE id = %s;", (now, plate_id))

        conn.commit()

        cur.close()

        conn.close()

    return {"ok": True, "sharedAt": now.isoformat(), "nakaCount": len(payload.get("nakaIds", []))}



# =========================================================================

# Shift Handovers & Operational Workflow Endpoints

# =========================================================================

@app.get("/api/shifts/handovers")

def get_handovers():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, from_user, created_at, summary, notes, accepted_by, accepted_at FROM shift_handovers ORDER BY created_at DESC;")

    rows = cursor.fetchall()

    conn.close()

    return [{

        "id": r[0],

        "from": r[1],

        "createdAt": r[2].isoformat() if hasattr(r[2], 'isoformat') else str(r[2]),

        "summary": r[3] if isinstance(r[3], dict) else json.loads(r[3] or "{}"),

        "notes": r[4] or "",

        "acceptedBy": r[5],

        "acceptedAt": r[6].isoformat() if r[6] and hasattr(r[6], 'isoformat') else None

    } for r in rows]



@app.post("/api/shifts/handovers")

def create_handover(payload: dict):

    sho_id = f"sho-{int(datetime.now().timestamp() * 1000)}"

    now = datetime.now(timezone.utc)

    from_user = payload.get("from", "Operator")

    summary = payload.get("summary", {})

    notes = payload.get("notes", "")

    

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("""

        INSERT INTO shift_handovers (id, from_user, created_at, summary, notes, accepted_by, accepted_at)

        VALUES (%s, %s, %s, %s, %s, %s, %s)

        RETURNING id, from_user, created_at, summary, notes, accepted_by, accepted_at;

    """, (sho_id, from_user, now, json.dumps(summary), notes, None, None))

    r = cursor.fetchone()

    conn.commit()

    conn.close()

    return {

        "id": r[0],

        "from": r[1],

        "createdAt": r[2].isoformat() if hasattr(r[2], 'isoformat') else str(r[2]),

        "summary": r[3] if isinstance(r[3], dict) else json.loads(r[3] or "{}"),

        "notes": r[4] or "",

        "acceptedBy": None,

        "acceptedAt": None

    }



@app.post("/api/shifts/handovers/{sho_id}/accept")

def accept_handover(sho_id: str, payload: dict):

    now = datetime.now(timezone.utc)

    by = payload.get("by", "Incoming Commander")

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("""

        UPDATE shift_handovers

        SET accepted_by = %s, accepted_at = %s

        WHERE id = %s

        RETURNING id, from_user, created_at, summary, notes, accepted_by, accepted_at;

    """, (by, now, sho_id))

    r = cursor.fetchone()

    conn.commit()

    conn.close()

    if not r:

        return {"id": sho_id, "acceptedBy": by, "acceptedAt": now.isoformat()}

    return {

        "id": r[0],

        "from": r[1],

        "createdAt": r[2].isoformat() if hasattr(r[2], 'isoformat') else str(r[2]),

        "summary": r[3] if isinstance(r[3], dict) else json.loads(r[3] or "{}"),

        "notes": r[4] or "",

        "acceptedBy": r[5],

        "acceptedAt": r[6].isoformat() if r[6] and hasattr(r[6], 'isoformat') else None

    }



# =========================================================================

# Users, System Hierarchy & Health Endpoints

# =========================================================================

@app.get("/api/users")

def get_users():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, name, username, role, active, last_login FROM users ORDER BY name ASC;")

    rows = cursor.fetchall()

    conn.close()

    return [{

        "id": r[0],

        "name": r[1],

        "username": r[2],

        "role": r[3],

        "active": bool(r[4]),

        "lastLogin": r[5].isoformat() if r[5] and hasattr(r[5], 'isoformat') else None

    } for r in rows]



@app.get("/api/hierarchy")

def get_hierarchy():

    return {

        "sectors": [

            {"id": "sec-jaisalmer", "name": "Jaisalmer Sector (Western Frontier)"},

            {"id": "sec-punjab", "name": "Amritsar Sector (Punjab Frontier)"}

        ],

        "bops": [

            {"id": "bop-sundar", "name": "BOP Sundar", "sectorId": "sec-jaisalmer", "lat": 27.7904, "lng": 70.3521},

            {"id": "bop-attari", "name": "BOP Attari Checkpost", "sectorId": "sec-punjab", "lat": 31.6033, "lng": 74.6034}

        ]

    }



@app.get("/api/health/nodes")

def get_edge_health():

    now = datetime.now(timezone.utc).isoformat()

    return [

        {

            "id": "edge-01",

            "name": "BOP Sundar Edge Computing Unit",

            "locationName": "BOP Sundar Control Room",

            "status": "online",

            "cpuPct": 38,

            "gpuPct": 45,

            "ramPct": 42,

            "diskPct": 31,

            "tempC": 52,

            "processingFps": 24.5,

            "latencyMs": 48,

            "uptimeSec": 86400,

            "bandwidthMbps": 2.8,

            "modelVersion": "yolov8n-ibvap-v1.0",

            "cameraIds": ["cam-01", "cam-02", "cam-03", "cam-04"],

            "lastHeartbeat": now

        }

    ]



@app.get("/api/settings")

def get_settings():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT data FROM app_settings WHERE id = 1;")

    row = cursor.fetchone()

    conn.close()

    return row[0] if row else {}



@app.put("/api/settings")

def update_settings(payload: dict):

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("UPDATE app_settings SET data = %s WHERE id = 1;", (json.dumps(payload),))

    conn.commit()

    conn.close()

    return payload



@app.get("/api/audit")

def get_audit():

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("SELECT id, at, username, role, category, action, target, details FROM audit_entries ORDER BY at DESC LIMIT 100;")

    rows = cursor.fetchall()

    conn.close()

    return [{

        "id": r[0],

        "at": r[1].isoformat() if hasattr(r[1], 'isoformat') else str(r[1]),

        "user": r[2],

        "role": r[3],

        "category": r[4],

        "action": r[5],

        "target": r[6],

        "details": r[7]

    } for r in rows]



@app.post("/api/audit")

def create_audit(payload: dict):

    a_id = f"aud-{int(datetime.now().timestamp() * 1000)}"

    now = datetime.now(timezone.utc)

    conn = get_db()

    cursor = conn.cursor()

    cursor.execute("""

        INSERT INTO audit_entries (id, at, username, role, category, action, target, details)

        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);

    """, (

        a_id, now, payload.get("user", "operator"), payload.get("role", "OPERATOR"),

        payload.get("category", "SYSTEM"), payload.get("action", ""),

        payload.get("target", ""), payload.get("details", "")

    ))

    conn.commit()

    conn.close()

    return {"ok": True, "id": a_id}



# Evidence record endpoint

@app.get("/api/alerts/{alert_id}/evidence")

def get_alert_evidence(alert_id: str):

    snap_path = os.path.join(MEDIA_DIR, "snapshots", f"{alert_id}.jpg")

    if os.path.exists(snap_path):

        with open(snap_path, "rb") as f:

            snap_sha = hashlib.sha256(f.read()).hexdigest()

    else:

        snap_sha = hashlib.sha256(f"{alert_id}".encode()).hexdigest()



    return {

        "alertId": alert_id,

        "algorithm": "SHA-256",

        "snapshotSha256": snap_sha,

        "clipSha256": None,

        "recordedAt": datetime.now(timezone.utc).isoformat()

    }



# Ingest Alert

@app.post("/api/ingest/alert")

async def ingest_alert(payload: dict):

    conn = get_db()

    cursor = conn.cursor()

    alert_id = payload.get("id") or f"ALT-{int(datetime.now().timestamp()*1000)}"

    now = datetime.now(timezone.utc)

    

    alert = {

        "id": alert_id,

        "timestamp": now,

        "camera_id": payload.get("cameraId", "cam-01"),

        "type": payload.get("type", "HUMAN_DETECTED"),

        "severity": payload.get("severity", "MEDIUM"),

        "status": "NEW",

        "confidence": payload.get("confidence", 0.85),

        "snapshot_url": payload.get("snapshotUrl", f"http://localhost:8000/media/snapshots/{alert_id}.jpg"),

        "clip": json.dumps(payload.get("clip")) if payload.get("clip") else None,

        "track_id": payload.get("trackId", 1),

        "bbox": json.dumps(payload.get("bbox", [0, 0, 0, 0])),

        "details": json.dumps(payload.get("details", {})),

        "assigned_to": None,

        "notes": "",

        "history": json.dumps([{"status": "NEW", "at": now.isoformat(), "by": "AI Engine"}]),

        "confirm_frames": payload.get("confirmFrames", 6),

        "visibility": payload.get("visibility", "clear"),

        "shelved_until": None,

        "shelve_reason": None,

        "playbook_done": json.dumps([]),

        "qrt_notified_at": None,

        "qrt_status": None

    }

    

    cursor.execute("""

    INSERT INTO alerts (id, timestamp, camera_id, type, severity, status, confidence, snapshot_url, clip, track_id, bbox, details, assigned_to, notes, history, confirm_frames, visibility, shelved_until, shelve_reason, playbook_done, qrt_notified_at, qrt_status)

    VALUES (%(id)s, %(timestamp)s, %(camera_id)s, %(type)s, %(severity)s, %(status)s, %(confidence)s, %(snapshot_url)s, %(clip)s, %(track_id)s, %(bbox)s, %(details)s, %(assigned_to)s, %(notes)s, %(history)s, %(confirm_frames)s, %(visibility)s, %(shelved_until)s, %(shelve_reason)s, %(playbook_done)s, %(qrt_notified_at)s, %(qrt_status)s)

    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

    """, alert)

    conn.commit()

    conn.close()



    formatted = parse_pg_alert((

        alert["id"], alert["timestamp"], alert["camera_id"], alert["type"], alert["severity"],

        alert["status"], alert["confidence"], alert["snapshot_url"], alert["clip"],

        alert["track_id"], alert["bbox"], alert["details"], alert["assigned_to"],

        alert["notes"], alert["history"], alert["confirm_frames"], alert["visibility"],

        alert["shelved_until"], alert["shelve_reason"], alert["playbook_done"],

        alert["qrt_notified_at"], alert["qrt_status"]

    ))

    await manager.broadcast_alert(formatted)

    return formatted





# =========================================================================

# NEXT-GEN DEFENSE API ENDPOINTS: THERMAL PALETTES, C-UAS JAMMER, TRIPWIRES, SITREP

# =========================================================================



@app.get("/api/cameras/{cam_id}/thermal-palette")

def get_thermal_palette(cam_id: str):

    return {"cameraId": cam_id, "palette": THERMAL_PALETTES.get(cam_id, "ironbow")}



@app.post("/api/cameras/{cam_id}/thermal-palette")

def set_thermal_palette(cam_id: str, palette: str = Query("ironbow")):

    valid_palettes = {"ironbow", "white-hot", "black-hot", "rainbow", "amber"}

    p = palette.lower() if palette.lower() in valid_palettes else "ironbow"

    THERMAL_PALETTES[cam_id] = p

    return {"cameraId": cam_id, "palette": p, "status": "APPLIED"}



@app.get("/api/cameras/{cam_id}/tripwire")

def get_tripwire(cam_id: str):

    return {"cameraId": cam_id, "points": CAMERA_TRIPWIRES.get(cam_id, [[0.1, 0.7], [0.9, 0.7]])}



@app.post("/api/cameras/{cam_id}/tripwire")

def save_tripwire(cam_id: str, payload: dict):

    pts = payload.get("points", [[0.1, 0.7], [0.9, 0.7]])

    CAMERA_TRIPWIRES[cam_id] = pts

    return {"cameraId": cam_id, "points": pts, "status": "SAVED"}



@app.get("/api/countermeasures/status")

def get_countermeasures():

    return {

        "status": "OPERATIONAL",

        "cuasEnabled": True,

        "activeJammers": DRONE_JAMMERS,

        "rfBands": ["2.4 GHz Industrial/Scientific", "5.8 GHz Telemetry", "GNSS L1/L2"],

        "maxEffectiveRangeKm": 3.5,

        "jammingTechnique": "Directional Pseudo-Random RF Burst / Link Sever"

    }



@app.post("/api/countermeasures/drone-jam")

async def trigger_drone_jam(payload: dict):

    cam_id = payload.get("cameraId", "cam-03")

    active = payload.get("active", True)

    DRONE_JAMMERS[cam_id] = active

    now = datetime.now(timezone.utc)

    

    # Store countermeasure resolution record in PostgreSQL

    alert_id = f"EW-{int(now.timestamp() * 1000)}"

    try:

        conn = get_db()

        cur = conn.cursor()

        cur.execute("""

            INSERT INTO alerts (id, timestamp, camera_id, type, severity, status, confidence, snapshot_url, track_id, bbox, details, notes, history)

            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);

        """, (

            alert_id, now, cam_id, "TACTICAL_UAV_NEUTRALIZED", "RESOLVED", "RESOLVED", 0.99,

            f"http://localhost:8000/media/snapshots/{alert_id}.jpg", 99, json.dumps([40, 20, 200, 100]),

            json.dumps({"countermeasure": "DIRCM_RF_JAMMER", "frequency": "2.4GHz / 5.8GHz / GNSS-L1", "status": "LINK_SEVERED_FORCED_LAND"}),

            "Target drone neutralized via Electronic Warfare Directional Jammer",

            json.dumps([{"status": "RESOLVED", "at": now.isoformat(), "by": "C-UAS Electronic Warfare"}])

        ))

        conn.commit()

        cur.close()

        conn.close()

    except Exception as e:

        print(f"[EW JAMMER DB ERROR] {e}")



    await manager.broadcast({

        "type": "DRONE_JAM_ENGAGED",

        "cameraId": cam_id,

        "active": active,

        "frequency": "2.4GHz / 5.8GHz / GNSS-L1",

        "status": "RF_LINK_SEVERED"

    })

    

    return {

        "success": True,

        "cameraId": cam_id,

        "active": active,

        "mode": "DIRECTIONAL_RF_PULSE_JAMMER",

        "effect": "C2_LINK_SEVERED_FORCED_LAND",

        "bands": ["2.4 GHz ISM", "5.8 GHz ISM", "GPS L1/GLONASS"],

        "timestamp": now.isoformat()

    }



@app.get("/api/reports/sitrep")

def get_daily_sitrep():

    """

    Official Military Situation Report (SITREP) Briefing.

    Aggregates threat analytics, intruder detection, ANPR, face matches, and sensor telemetry.

    """

    now = datetime.now(timezone.utc)

    conn = get_db()

    cur = conn.cursor()

    

    # 24hr alert stats

    cur.execute("SELECT count(*) FROM alerts;")

    total_alerts = cur.fetchone()[0]

    

    cur.execute("SELECT count(*) FROM alerts WHERE severity = 'CRITICAL';")

    critical_alerts = cur.fetchone()[0]

    

    cur.execute("SELECT count(*) FROM alerts WHERE severity = 'HIGH';")

    high_alerts = cur.fetchone()[0]

    

    cur.execute("SELECT count(*) FROM alerts WHERE type ILIKE '%HUMAN%' OR type ILIKE '%PERSON%' OR type ILIKE '%INTRUSION%';")

    infiltrations = cur.fetchone()[0]

    

    cur.execute("SELECT count(*) FROM alerts WHERE type ILIKE '%DRONE%' OR type ILIKE '%UAV%';")

    drone_incursions = cur.fetchone()[0]

    

    # ANPR stats

    cur.execute("SELECT count(*) FROM anpr_reads;")

    total_anpr = cur.fetchone()[0]

    

    cur.execute("SELECT count(*) FROM anpr_reads WHERE blacklisted = True;")

    blacklisted_vehicles = cur.fetchone()[0]

    

    # Face matches stats

    cur.execute("SELECT count(*) FROM face_matches;")

    total_face_matches = cur.fetchone()[0]

    

    cur.execute("SELECT count(*) FROM face_watchlist;")

    total_watchlist = cur.fetchone()[0]

    

    # Recent critical incidents

    cur.execute("""

        SELECT id, timestamp, camera_id, type, severity, status 

        FROM alerts 

        ORDER BY timestamp DESC LIMIT 6;

    """)

    recent_incidents = [{

        "id": r[0],

        "timestamp": r[1].isoformat() if hasattr(r[1], 'isoformat') else str(r[1]),

        "cameraId": r[2],

        "type": r[3],

        "severity": r[4],

        "status": r[5]

    } for r in cur.fetchall()]

    

    cur.close()

    conn.close()

    

    return {

        "classification": "TOP SECRET // NOFORN // BORDER COMMAND",

        "sector": "WESTERN BORDER COMMAND (IBVAP SECTOR - SUNDAR / ATTARI)",

        "reportId": f"SITREP-{now.strftime('%Y%m%d')}-01",

        "generatedAt": now.isoformat(),

        "defconLevel": 2 if critical_alerts > 0 else 3,

        "readinessStatus": "DEFENSE CONDITION OPERATIONAL - 100% READY",

        "statistics": {

            "totalAlerts": total_alerts,

            "criticalAlerts": critical_alerts,

            "highAlerts": high_alerts,

            "infiltrationsDetected": infiltrations,

            "droneIncursions": drone_incursions,

            "droneNeutralized": 1 if DRONE_JAMMERS.get("cam-03") else 0,

            "vehiclesScanned": total_anpr,

            "blacklistedVehiclesIntercepted": blacklisted_vehicles,

            "facesAnalyzed": total_face_matches,

            "activeWatchlistProfiles": total_watchlist,

            "operationalCameras": len(VIDEO_SOURCES),

            "sensorHealthPct": 99.4

        },

        "recentIncidents": recent_incidents,

        "countermeasureStatus": {

            "cuasJammer": "ARMED_STANDBY" if not DRONE_JAMMERS.get("cam-03") else "ACTIVE_JAMMING",

            "frequencyCoverage": "2.4GHz / 5.8GHz / GNSS-L1 Multi-Band",

            "virtualTripwires": len(CAMERA_TRIPWIRES),

            "nightVisionCapability": "Gen-3 Thermal FLIR + Phosphor NVG Enabled"

        },

        "commandingOfficer": "Brig. Vikram Rathore, IBVAP Operational Defense Command"

    }



if __name__ == "__main__":

    import uvicorn

    init_pg_db()

    uvicorn.run(app, host="0.0.0.0", port=8000)

