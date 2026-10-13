"""
IBVAP - Dashboard (Starter)
Run:  pip install streamlit pandas opencv-python
      streamlit run app.py

Abhi ye DUMMY data pe chalta hai. Jab AI part ready ho:
  1. AI engine har alert ko SQLite (alerts.db, table 'alerts') mein save kare
  2. Neeche USE_DUMMY = False kar do
"""
import sqlite3
import random
from datetime import datetime, timedelta

import pandas as pd
import streamlit as st

USE_DUMMY = True
DB_PATH = "alerts.db"

st.set_page_config(page_title="IBVAP Dashboard", page_icon="🛡️", layout="wide")

# ---------------- Data layer ----------------
ALERT_TYPES = ["Fence Intrusion", "Vehicle Detected", "ANPR Blacklist Match",
               "Face Watchlist Match", "Loitering", "Night Movement"]
CAMERAS = ["CAM-01 BOP Gate", "CAM-02 Border Road", "CAM-03 Check Post", "CAM-04 Fence East"]
SEVERITY = {"Fence Intrusion": "High", "ANPR Blacklist Match": "High", "Face Watchlist Match": "High",
            "Loitering": "Medium", "Night Movement": "Medium", "Vehicle Detected": "Low"}


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("""CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time TEXT, camera TEXT, type TEXT, severity TEXT,
        details TEXT, snapshot TEXT)""")
    con.commit()
    con.close()


def dummy_alerts(n=25):
    now = datetime.now()
    rows = []
    for i in range(n):
        t = random.choice(ALERT_TYPES)
        details = {"ANPR Blacklist Match": f"Plate: RJ14 AB {random.randint(1000, 9999)}",
                   "Face Watchlist Match": "Match: Suspect #3 (82%)",
                   "Vehicle Detected": random.choice(["Truck", "Car", "Bike", "Tractor"])}.get(t, "Person detected")
        rows.append({"time": (now - timedelta(minutes=i * random.randint(2, 9))).strftime("%Y-%m-%d %H:%M:%S"),
                     "camera": random.choice(CAMERAS), "type": t, "severity": SEVERITY[t],
                     "details": details, "snapshot": ""})
    return pd.DataFrame(rows)


def load_alerts():
    if USE_DUMMY:
        if "dummy" not in st.session_state:
            st.session_state.dummy = dummy_alerts()
        return st.session_state.dummy
    con = sqlite3.connect(DB_PATH)
    df = pd.read_sql("SELECT * FROM alerts ORDER BY time DESC", con)
    con.close()
    return df


init_db()
df = load_alerts()

# ---------------- Sidebar ----------------
st.sidebar.title("🛡️ IBVAP")
st.sidebar.caption("Intelligent Border Video Analytics Platform")
page = st.sidebar.radio("Menu", ["Live Monitoring", "Alerts & Event Log", "Watchlist", "Settings"])
st.sidebar.divider()
st.sidebar.success("System: Online")
st.sidebar.write(f"Cameras active: **{len(CAMERAS)}**")

SEV_ICON = {"High": "🔴", "Medium": "🟠", "Low": "🟢"}

# ---------------- Page 1: Live Monitoring ----------------
if page == "Live Monitoring":
    st.title("Live Monitoring")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Total alerts (today)", len(df))
    c2.metric("High severity", int((df["severity"] == "High").sum()))
    c3.metric("Intrusions", int((df["type"] == "Fence Intrusion").sum()))
    c4.metric("Plates read", int(df["type"].str.contains("ANPR|Vehicle").sum()))

    left, right = st.columns([2, 1])
    with left:
        cam = st.selectbox("Camera", CAMERAS)
        frame_box = st.empty()
        # TODO (integration): yahan AI engine ka processed frame dikhana hai.
        # Example:
        #   import cv2
        #   cap = cv2.VideoCapture("rtsp://..." or "demo.mp4")
        #   ok, frame = cap.read()
        #   frame_box.image(frame, channels="BGR")
        frame_box.info(f"📹 {cam} - video feed yahan aayegi (AI engine se jodna baaki hai)")

    with right:
        st.subheader("Latest alerts")
        for _, r in df.head(8).iterrows():
            with st.container(border=True):
                st.markdown(f"{SEV_ICON[r['severity']]} **{r['type']}**")
                st.caption(f"{r['camera']} | {r['time']}")
                st.write(r["details"])

# ---------------- Page 2: Alerts & Event Log ----------------
elif page == "Alerts & Event Log":
    st.title("Alerts & Event Log")
    f1, f2, f3 = st.columns(3)
    types = f1.multiselect("Alert type", ALERT_TYPES)
    cams = f2.multiselect("Camera", CAMERAS)
    sev = f3.multiselect("Severity", ["High", "Medium", "Low"])

    view = df.copy()
    if types:
        view = view[view["type"].isin(types)]
    if cams:
        view = view[view["camera"].isin(cams)]
    if sev:
        view = view[view["severity"].isin(sev)]

    st.dataframe(view.drop(columns=["snapshot"]), use_container_width=True, hide_index=True)
    st.download_button("⬇️ Export CSV", view.to_csv(index=False), "ibvap_alerts.csv", "text/csv")

    st.subheader("Alerts by type")
    st.bar_chart(view["type"].value_counts())

# ---------------- Page 3: Watchlist ----------------
elif page == "Watchlist":
    st.title("Watchlist")
    tab1, tab2 = st.tabs(["Faces", "Vehicle numbers"])
    with tab1:
        name = st.text_input("Person name / ID")
        photo = st.file_uploader("Face photo", type=["jpg", "jpeg", "png"])
        if st.button("Add to face watchlist") and name and photo:
            # TODO: photo ko 'watchlist/faces/' mein save karo, AI engine wahan se padhega
            st.success(f"{name} watchlist mein add ho gaya (demo)")
    with tab2:
        plate = st.text_input("Number plate (e.g. RJ14AB1234)")
        if st.button("Add to blacklist") and plate:
            # TODO: plate ko DB / file mein save karo
            st.success(f"{plate.upper()} blacklist mein add ho gaya (demo)")

# ---------------- Page 4: Settings ----------------
else:
    st.title("Settings")
    st.subheader("Cameras")
    st.dataframe(pd.DataFrame({"Camera": CAMERAS,
                               "Stream URL": ["rtsp://192.168.1.10:8554/cam1", "demo_videos/road.mp4",
                                              "http://192.168.1.5:8080/video", "demo_videos/fence.mp4"]}),
                 hide_index=True, use_container_width=True)
    st.subheader("Detection")
    st.slider("Confidence threshold", 0.1, 0.9, 0.5)
    st.slider("Loitering time (seconds)", 10, 120, 30)
    st.toggle("Night mode enhancement", value=True)
    st.toggle("Alert sound", value=True)