import os
import json
import sqlite3
import hashlib
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "ibvap.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Cameras table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cameras (
        id TEXT PRIMARY KEY,
        name TEXT,
        locationName TEXT,
        lat REAL,
        lng REAL,
        streamUrl TEXT,
        status TEXT,
        fps REAL,
        isNightMode INTEGER,
        lastSeen TEXT,
        modules TEXT,
        visibility TEXT,
        sensitivity REAL,
        minConfirmFrames INTEGER,
        ignoreAnimals INTEGER,
        cameraType TEXT,
        bopId TEXT,
        outOfService TEXT
    )
    """)

    # 2. Alerts table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        timestamp TEXT,
        cameraId TEXT,
        type TEXT,
        severity TEXT,
        status TEXT,
        confidence REAL,
        snapshotUrl TEXT,
        clip TEXT,
        trackId INTEGER,
        bbox TEXT,
        details TEXT,
        assignedTo TEXT,
        notes TEXT,
        history TEXT,
        confirmFrames INTEGER,
        visibility TEXT,
        shelvedUntil TEXT,
        shelveReason TEXT,
        playbookDone TEXT,
        qrtNotifiedAt TEXT,
        qrtStatus TEXT
    )
    """)

    # 3. Zones table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS zones (
        id TEXT PRIMARY KEY,
        cameraId TEXT,
        name TEXT,
        type TEXT,
        points TEXT,
        active INTEGER,
        schedule TEXT,
        severity TEXT,
        classes TEXT,
        minDwellSec REAL,
        direction TEXT
    )
    """)

    # 4. Zone Audit table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS zone_audit (
        id TEXT PRIMARY KEY,
        at TEXT,
        by TEXT,
        action TEXT,
        zoneId TEXT,
        zoneName TEXT,
        cameraId TEXT,
        changes TEXT
    )
    """)

    # 5. ANPR Plate Reads
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS anpr_reads (
        id TEXT PRIMARY KEY,
        timestamp TEXT,
        cameraId TEXT,
        plate TEXT,
        vehicleClass TEXT,
        color TEXT,
        confidence REAL,
        cropUrl TEXT,
        blacklisted INTEGER,
        needsVerification INTEGER,
        correctedFrom TEXT,
        droneWatchId TEXT,
        sharedAt TEXT
    )
    """)

    # 6. ANPR Blacklist
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS anpr_blacklist (
        id TEXT PRIMARY KEY,
        plate TEXT UNIQUE,
        reason TEXT,
        priority TEXT,
        notes TEXT,
        addedAt TEXT
    )
    """)

    # 7. Watchlist Person
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS watchlist_persons (
        id TEXT PRIMARY KEY,
        name TEXT,
        category TEXT,
        riskLevel TEXT,
        photos TEXT,
        notes TEXT,
        addedAt TEXT
    )
    """)

    # 8. Face Matches
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS face_matches (
        id TEXT PRIMARY KEY,
        timestamp TEXT,
        cameraId TEXT,
        personId TEXT,
        similarity REAL,
        capturedUrl TEXT,
        alertId TEXT,
        review TEXT,
        reviewedBy TEXT
    )
    """)

    # 9. Audit Entries
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_entries (
        id TEXT PRIMARY KEY,
        at TEXT,
        user TEXT,
        role TEXT,
        category TEXT,
        action TEXT,
        target TEXT,
        details TEXT
    )
    """)

    # 10. App Settings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT
    )
    """)

    # 11. Drone Watches
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS drone_watches (
        id TEXT PRIMARY KEY,
        lat REAL,
        lng REAL,
        radiusKm REAL,
        durationH REAL,
        reason TEXT,
        linkedAlertId TEXT,
        createdBy TEXT,
        startedAt TEXT,
        expiresAt TEXT,
        endedAt TEXT
    )
    """)

    # 12. Nakas
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS nakas (
        id TEXT PRIMARY KEY,
        name TEXT,
        lat REAL,
        lng REAL,
        agency TEXT
    )
    """)

    # Seed initial data if tables are empty
    cursor.execute("SELECT COUNT(*) FROM cameras")
    if cursor.fetchone()[0] == 0:
        seed_database(cursor)

    conn.commit()
    conn.close()
    print("[Database] SQLite initialized at:", DB_PATH)

def seed_database(cursor):
    now = datetime.now(timezone.utc).isoformat()

    # Seed Default Cameras
    cameras = [
        ("cam-01", "BOP Sundar - Main Gate", "BOP Sundar, Jaisalmer Sector (RJ)", 27.7904, 70.3521, "demo_videos/people_detection.mp4", "online", 25.0, 0, now, json.dumps({"human": True, "vehicle": True, "anpr": True, "face": True, "fence": True}), "clear", 0.5, 5, 1, "visible", "bop-sundar", None),
        ("cam-02", "Border Outpost - Checkpost ANPR", "BOP Sundar Gate 2 (RJ)", 27.7915, 70.3540, "demo_videos/indian_checkpost_anpr.mp4", "online", 25.0, 0, now, json.dumps({"human": True, "vehicle": True, "anpr": True, "face": False, "fence": True}), "clear", 0.5, 5, 1, "visible", "bop-sundar", None),
        ("cam-03", "Sector 4 Night Patrol", "Sector 4 Outer Perimeter", 27.8010, 70.3620, "demo_videos/night_surveillance.mp4", "online", 25.0, 1, now, json.dumps({"human": True, "vehicle": True, "anpr": False, "face": False, "fence": True}), "low-light", 0.4, 6, 1, "ir-night", "bop-sundar", None),
        ("cam-04", "Thermal Imager FLIR - Border Wire", "BOP Sundar Riverine Gap", 27.7850, 70.3480, "demo_videos/thermal_perimeter.mp4", "online", 25.0, 1, now, json.dumps({"human": True, "vehicle": True, "anpr": False, "face": False, "fence": True}), "clear", 0.5, 5, 1, "thermal", "bop-sundar", None)
    ]
    cursor.executemany("""
    INSERT INTO cameras VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, cameras)

    # Seed Default Zones
    zones = [
        ("zone-01", "cam-01", "Perimeter Wire Alpha", "polygon", json.dumps([[0.1, 0.45], [0.9, 0.45], [0.9, 0.95], [0.1, 0.95]]), 1, "always", "CRITICAL", json.dumps(["person"]), 0, None),
        ("zone-02", "cam-02", "Checkpost Entry Tripwire", "line", json.dumps([[0.05, 0.5], [0.95, 0.5]]), 1, "always", "HIGH", json.dumps(["person", "vehicle"]), 0, "forward")
    ]
    cursor.executemany("INSERT INTO zones VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", zones)

    # Seed Blacklist Vehicles
    blacklist = [
        ("bl-01", "RJ14AB1234", "SMUGGLING", "HIGH", "Suspected border contraband runner", now),
        ("bl-02", "DL01CA9999", "STOLEN", "HIGH", "Stolen pickup truck alert", now),
        ("bl-03", "PB02AX5555", "WANTED", "CRITICAL", "High-risk border infiltration alert", now)
    ]
    cursor.executemany("INSERT INTO anpr_blacklist VALUES (?, ?, ?, ?, ?, ?)", blacklist)

    # Seed Watchlist Person
    watchlist = [
        ("wp-01", "Subject W-014", "WANTED", "HIGH", json.dumps(["http://localhost:8000/media/faces/wp-01.jpg"]), "Cross-border contraband suspect", now)
    ]
    cursor.executemany("INSERT INTO watchlist_persons VALUES (?, ?, ?, ?, ?, ?, ?)", watchlist)

    # Seed Nakas
    nakas = [
        ("nk-01", "Joint Naka - Ajnala Road", 31.8489, 74.6702, "Punjab Police + BSF"),
        ("nk-02", "Sector Checkpoint 4", 27.7950, 70.3580, "BSF QRT")
    ]
    cursor.executemany("INSERT INTO nakas VALUES (?, ?, ?, ?, ?)", nakas)

    # Seed Settings
    settings = {
        "confidenceThreshold": 0.5,
        "loiteringSeconds": 30,
        "nightMode": "auto",
        "webhookUrl": "",
        "retention": {"clipsDays": 30, "snapshotsDays": 90, "faceDataDays": 30},
        "blurFacesInExports": True,
        "sessionTimeoutMin": 15
    }
    cursor.execute("INSERT INTO app_settings VALUES (1, ?)", (json.dumps(settings),))

    # Seed Sample Initial Alert
    alert = {
        "id": "ALT-00101",
        "timestamp": now,
        "cameraId": "cam-01",
        "type": "FENCE_INTRUSION",
        "severity": "CRITICAL",
        "status": "NEW",
        "confidence": 0.94,
        "snapshotUrl": "http://localhost:8000/media/snapshots/ALT-00101.jpg",
        "clip": None,
        "trackId": 12,
        "bbox": json.dumps([0.35, 0.48, 0.15, 0.35]),
        "details": json.dumps({"zoneId": "zone-01", "zoneName": "Perimeter Wire Alpha", "objectCount": 1, "objectClass": "person"}),
        "assignedTo": None,
        "notes": "",
        "history": json.dumps([{"status": "NEW", "at": now, "by": "AI Engine"}]),
        "confirmFrames": 7,
        "visibility": "clear",
        "shelvedUntil": None,
        "shelveReason": None,
        "playbookDone": json.dumps([]),
        "qrtNotifiedAt": None,
        "qrtStatus": None
    }
    cursor.execute("""
    INSERT INTO alerts VALUES (
        :id, :timestamp, :cameraId, :type, :severity, :status, :confidence,
        :snapshotUrl, :clip, :trackId, :bbox, :details, :assignedTo, :notes,
        :history, :confirmFrames, :visibility, :shelvedUntil, :shelveReason,
        :playbookDone, :qrtNotifiedAt, :qrtStatus
    )
    """, alert)

if __name__ == "__main__":
    init_db()
