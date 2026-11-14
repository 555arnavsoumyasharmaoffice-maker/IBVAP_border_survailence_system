import os
import psycopg2
from psycopg2.extras import RealDictCursor
import json
from datetime import datetime, timezone, timedelta

PG_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "postgre123",
    "dbname": "ibvap_db"
}

def get_db():
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        return psycopg2.connect(db_url)
    conn = psycopg2.connect(**PG_CONFIG)
    return conn

def init_pg_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Cameras
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cameras (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128),
        location_name VARCHAR(256),
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        stream_url TEXT,
        status VARCHAR(32),
        fps DOUBLE PRECISION,
        is_night_mode BOOLEAN,
        last_seen TIMESTAMPTZ,
        modules JSONB,
        visibility VARCHAR(32),
        sensitivity DOUBLE PRECISION,
        min_confirm_frames INTEGER,
        ignore_animals BOOLEAN,
        camera_type VARCHAR(32),
        bop_id VARCHAR(64),
        out_of_service JSONB
    );
    """)

    # 2. Alerts
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id VARCHAR(64) PRIMARY KEY,
        timestamp TIMESTAMPTZ,
        camera_id VARCHAR(64),
        type VARCHAR(64),
        severity VARCHAR(32),
        status VARCHAR(32),
        confidence DOUBLE PRECISION,
        snapshot_url TEXT,
        clip JSONB,
        track_id INTEGER,
        bbox JSONB,
        details JSONB,
        assigned_to VARCHAR(128),
        notes TEXT,
        history JSONB,
        confirm_frames INTEGER,
        visibility VARCHAR(32),
        shelved_until TIMESTAMPTZ,
        shelve_reason TEXT,
        playbook_done JSONB,
        qrt_notified_at TIMESTAMPTZ,
        qrt_status VARCHAR(32)
    );
    """)

    # 3. Zones
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS zones (
        id VARCHAR(64) PRIMARY KEY,
        camera_id VARCHAR(64),
        name VARCHAR(128),
        type VARCHAR(32),
        points JSONB,
        active BOOLEAN,
        schedule VARCHAR(32),
        severity VARCHAR(32),
        classes JSONB,
        min_dwell_sec DOUBLE PRECISION,
        direction VARCHAR(32)
    );
    """)

    # 4. ANPR Reads
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS anpr_reads (
        id VARCHAR(64) PRIMARY KEY,
        timestamp TIMESTAMPTZ,
        camera_id VARCHAR(64),
        plate VARCHAR(32),
        vehicle_class VARCHAR(32),
        color VARCHAR(32),
        confidence DOUBLE PRECISION,
        crop_url TEXT,
        blacklisted BOOLEAN,
        needs_verification BOOLEAN,
        corrected_from VARCHAR(32),
        drone_watch_id VARCHAR(64),
        shared_at TIMESTAMPTZ
    );
    """)

    # 5. Blacklist Vehicles
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS anpr_blacklist (
        id VARCHAR(64) PRIMARY KEY,
        plate VARCHAR(32) UNIQUE,
        reason VARCHAR(128),
        priority VARCHAR(32),
        notes TEXT,
        added_at TIMESTAMPTZ
    );
    """)

    # 6. Audit Entries
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audit_entries (
        id VARCHAR(64) PRIMARY KEY,
        at TIMESTAMPTZ,
        username VARCHAR(128),
        role VARCHAR(32),
        category VARCHAR(64),
        action VARCHAR(128),
        target VARCHAR(128),
        details TEXT
    );
    """)

    # 7. App Settings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data JSONB
    );
    """)

    # 8. Face Watchlist
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS face_watchlist (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128),
        category VARCHAR(32),
        risk_level VARCHAR(32),
        photos JSONB,
        notes TEXT,
        added_at TIMESTAMPTZ
    );
    """)

    # 9. Face Matches
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS face_matches (
        id VARCHAR(64) PRIMARY KEY,
        timestamp TIMESTAMPTZ,
        camera_id VARCHAR(64),
        person_id VARCHAR(64),
        similarity DOUBLE PRECISION,
        captured_url TEXT,
        alert_id VARCHAR(64),
        review VARCHAR(32),
        reviewed_by VARCHAR(128)
    );
    """)

    # 10. Drone Watches
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS drone_watches (
        id VARCHAR(64) PRIMARY KEY,
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        radius_km INTEGER,
        started_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        reason TEXT,
        linked_alert_id VARCHAR(64),
        created_by VARCHAR(128),
        ended_at TIMESTAMPTZ
    );
    """)

    # 11. Shift Handovers
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shift_handovers (
        id VARCHAR(64) PRIMARY KEY,
        from_user VARCHAR(128),
        created_at TIMESTAMPTZ,
        summary JSONB,
        notes TEXT,
        accepted_by VARCHAR(128),
        accepted_at TIMESTAMPTZ
    );
    """)

    # 12. Users
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(128),
        username VARCHAR(64) UNIQUE,
        role VARCHAR(32),
        active BOOLEAN,
        last_login TIMESTAMPTZ
    );
    """)

    # 13. System Users (Military Auth Roster)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS system_users (
        id VARCHAR(64) PRIMARY KEY,
        service_id VARCHAR(64) UNIQUE NOT NULL,
        name VARCHAR(128) NOT NULL,
        role VARCHAR(32) NOT NULL,
        password_hash VARCHAR(128) NOT NULL,
        rank VARCHAR(64),
        unit VARCHAR(128),
        status VARCHAR(32) DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
    );
    """)

    # Check and seed tables if empty
    seed_pg(cursor)

    conn.commit()
    conn.close()
    print("[PostgreSQL] ibvap_db tables initialized successfully!")

def seed_pg(cursor):
    now = datetime.now(timezone.utc)
    
    cursor.execute("SELECT COUNT(*) FROM cameras;")
    if cursor.fetchone()[0] == 0:
        cameras = [
            ("cam-01", "BOP Sundar - Main Gate", "BOP Sundar, Jaisalmer Sector (RJ)", 27.7904, 70.3521, "demo_videos/people_detection.mp4", "online", 25.0, False, now, json.dumps({"human": True, "vehicle": True, "anpr": True, "face": True, "fence": True}), "clear", 0.5, 5, True, "visible", "bop-sundar", None),
            ("cam-02", "Border Outpost - Checkpost ANPR", "BOP Sundar Gate 2 (RJ)", 27.7915, 70.3540, "demo_videos/indian_checkpost_anpr.mp4", "online", 25.0, False, now, json.dumps({"human": True, "vehicle": True, "anpr": True, "face": False, "fence": True}), "clear", 0.5, 5, True, "visible", "bop-sundar", None),
            ("cam-03", "Sector 4 Night Patrol", "Sector 4 Outer Perimeter", 27.8010, 70.3620, "demo_videos/night_surveillance.mp4", "online", 25.0, True, now, json.dumps({"human": True, "vehicle": True, "anpr": False, "face": False, "fence": True}), "low-light", 0.4, 6, True, "ir-night", "bop-sundar", None),
            ("cam-04", "Thermal Imager FLIR - Border Wire", "BOP Sundar Riverine Gap", 27.7850, 70.3480, "demo_videos/thermal_perimeter.mp4", "online", 25.0, True, now, json.dumps({"human": True, "vehicle": True, "anpr": False, "face": False, "fence": True}), "clear", 0.5, 5, True, "thermal", "bop-sundar", None)
        ]
        cursor.executemany("""
        INSERT INTO cameras VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """, cameras)

    cursor.execute("SELECT COUNT(*) FROM zones;")
    if cursor.fetchone()[0] == 0:
        zones = [
            ("zone-01", "cam-01", "Perimeter Wire Alpha", "polygon", json.dumps([[0.1, 0.45], [0.9, 0.45], [0.9, 0.95], [0.1, 0.95]]), True, "always", "CRITICAL", json.dumps(["person"]), 0, None),
            ("zone-02", "cam-02", "Checkpost Entry Tripwire", "line", json.dumps([[0.05, 0.5], [0.95, 0.5]]), True, "always", "HIGH", json.dumps(["person", "vehicle"]), 0, "forward")
        ]
        cursor.executemany("""
        INSERT INTO zones VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
        """, zones)

    cursor.execute("SELECT COUNT(*) FROM anpr_blacklist;")
    if cursor.fetchone()[0] == 0:
        blacklist = [
            ("bl-01", "RJ14AB1234", "SMUGGLING", "HIGH", "Suspected border contraband runner", now),
            ("bl-02", "DL01CA9999", "STOLEN", "HIGH", "Stolen pickup truck alert", now),
            ("bl-03", "PB02AX5555", "WANTED", "CRITICAL", "High-risk border infiltration alert", now)
        ]
        cursor.executemany("""
        INSERT INTO anpr_blacklist VALUES (%s, %s, %s, %s, %s, %s);
        """, blacklist)

    cursor.execute("SELECT COUNT(*) FROM app_settings;")
    if cursor.fetchone()[0] == 0:
        settings = {
            "confidenceThreshold": 0.5,
            "loiteringSeconds": 30,
            "nightMode": "auto",
            "webhookUrl": "",
            "retention": {"clipsDays": 30, "snapshotsDays": 90, "faceDataDays": 30},
            "blurFacesInExports": True,
            "sessionTimeoutMin": 15
        }
        cursor.execute("INSERT INTO app_settings VALUES (1, %s);", (json.dumps(settings),))

    cursor.execute("SELECT COUNT(*) FROM users;")
    if cursor.fetchone()[0] == 0:
        users = [
            ("usr-01", "Subedar Major R. K. Singh", "commander", "COMMANDER", True, now),
            ("usr-02", "Havildar Amit Verma", "operator", "OPERATOR", True, now),
            ("usr-03", "Admin Unit Jaisalmer", "admin", "ADMIN", True, now)
        ]
        cursor.executemany("INSERT INTO users VALUES (%s, %s, %s, %s, %s, %s);", users)

    cursor.execute("SELECT COUNT(*) FROM face_watchlist;")
    if cursor.fetchone()[0] == 0:
        watchlist = [
            ("wl-01", "Tariq Mehmood", "WANTED", "HIGH", json.dumps(["http://localhost:8000/media/faces/wl_tariq.jpg"]), "Suspected cross-border infiltrator / Handler link. Intercept immediately.", now),
            ("wl-02", "Rashid Khan", "SUSPECT", "MEDIUM", json.dumps(["http://localhost:8000/media/faces/wl_rashid.jpg"]), "Crossed riverine gap in 2025; active in contraband courier network.", now),
            ("wl-03", "Subedar Gurmeet Singh", "AUTHORISED", "LOW", json.dumps(["http://localhost:8000/media/faces/wl_gurmeet.jpg"]), "BSF Sector 4 QRT Lead Officer - Authorized Command Personnel.", now)
        ]
        cursor.executemany("INSERT INTO face_watchlist VALUES (%s, %s, %s, %s, %s, %s, %s);", watchlist)

    cursor.execute("SELECT COUNT(*) FROM drone_watches;")
    if cursor.fetchone()[0] == 0:
        drone_watches = [
            ("dw-01", 27.7904, 70.3521, 2, now - timedelta(hours=1), now + timedelta(hours=3), "Active tactical drone sighting near BOP Sundar sector", "ALT-DRONE-01", "commander", None)
        ]
        cursor.executemany("INSERT INTO drone_watches VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);", drone_watches)

    cursor.execute("SELECT COUNT(*) FROM shift_handovers;")
    if cursor.fetchone()[0] == 0:
        handovers = [
            ("sho-01", "Havildar Amit Verma", now - timedelta(hours=8), json.dumps({"openIncidents": ["ALT-01"], "shelved": [], "droneWatches": ["dw-01"], "camerasOutOfService": []}), "Night shift quiet except tactical drone detected at 0340 hrs near Pillar 642. Forward posts alerted.", "Subedar Major R. K. Singh", now - timedelta(hours=7))
        ]
        cursor.executemany("INSERT INTO shift_handovers VALUES (%s, %s, %s, %s, %s, %s, %s);", handovers)

if __name__ == "__main__":
    init_pg_db()
