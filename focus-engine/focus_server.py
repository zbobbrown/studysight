"""
focus_server.py
Restructured focus detection engine with a WebSocket server.

The engine runs the camera loop in a background thread.
The WebSocket server broadcasts focus scores to connected clients.

Commands accepted from clients (JSON):
  {"cmd": "start_watching"}  — begin sampling (timer has ≤watchWindow secs left)
  {"cmd": "stop_watching"}   — stop sampling and release camera

Broadcasts to clients:
  {"focus_score": <int 0-100>}
"""

import asyncio
import base64
import csv
import json
import joblib
import logging
import pathlib
import subprocess
import sys
import threading
import time
from collections import deque

import cv2
import mediapipe as mp
import numpy as np
import websockets
from pynput import keyboard
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO, format="[FocusEngine] %(message)s")
log = logging.getLogger(__name__)

DEFAULT_PORT        = 8765
TRAINING_DATA_DIR   = pathlib.Path(__file__).parent / "training-data"
MODEL_PATH          = pathlib.Path(__file__).parent / "focus_model.pkl"
LOG_INTERVAL_SECS   = 2.0   # snapshot every 2 seconds during watching

# ── Palette (BGR, for optional debug window) ──────────────────────────────────
RED    = (  0,  40, 255)
ORANGE = (  0, 165, 255)
GREEN  = ( 40, 255,  80)
WHITE  = (220, 220, 220)
DIM    = ( 70,  70,  70)


# ── Gaming Detector (unchanged from original) ─────────────────────────────────

class GamingDetector:

    GAMING_KEYS     = {"w", "a", "s", "d"}
    WASD_THRESHOLD  = 0.55
    MIN_KEYS        = 8
    SUSTAIN_SECS    = 15.0
    IDLE_RESET_SECS = 3.0

    def __init__(self):
        self.key_log        = deque(maxlen=60)
        self.last_key_time  = 0.0
        self.dominant_since = None
        self.space_times    = deque(maxlen=20)
        keyboard.Listener(on_press=self._on_press).start()

    def _on_press(self, key):
        now = time.time()
        if self.last_key_time and (now - self.last_key_time) > self.IDLE_RESET_SECS:
            self.key_log.clear()
            self.dominant_since = None
        self.last_key_time = now
        try:
            k = key.char.lower()
        except AttributeError:
            k = str(key)
        self.key_log.append(k in self.GAMING_KEYS)
        if k == " ":
            self.space_times.append(now)

    def reset(self):
        self.key_log.clear()
        self.dominant_since = None
        self.space_times.clear()

    def wasd_ratio(self):
        if len(self.key_log) < self.MIN_KEYS:
            return 0.0
        return sum(self.key_log) / len(self.key_log)

    def gaming(self):
        now   = time.time()
        ratio = self.wasd_ratio()
        if ratio >= self.WASD_THRESHOLD:
            if self.dominant_since is None:
                self.dominant_since = now
            elif now - self.dominant_since >= self.SUSTAIN_SECS:
                return True
        else:
            self.dominant_since = None
        return False


# ── Focus Engine ───────────────────────────────────────────────────────────────

class FocusEngine:
    """
    Runs focus detection in a background thread.
    Call start_watching() / stop_watching() to control sampling.
    Read focus_score for the current score.
    """

    FRAME_INTERVAL = 1 / 30  # ~30 fps

    def __init__(self, show_debug_window: bool = False, label: str = None):
        self.show_debug_window = show_debug_window
        self._watching        = False
        self._show_camera     = False
        self._lock             = threading.Lock()
        self.focus_score       = 100
        self.is_gaming         = False
        self.camera_frame_b64  = None  # base64 JPEG of latest frame, or None

        # Camera + models (lazy-loaded when watching starts)
        self._cap   = None
        self._face  = None
        self._yolo  = None
        self._model = None

        # Gaze / blink / head-pose state
        self._gaze_history  = deque(maxlen=120)
        self._blink_times   = deque(maxlen=60)
        self._ear_prev      = 1.0
        self._blink_rate    = 0.0
        self._pitch_history = deque(maxlen=30)
        self._yaw_history   = deque(maxlen=30)

        self._gaming = GamingDetector()

        # Training data collection (session-based, triggered by end_session command)
        self._log_rows         = []
        self._session_start_ts = None
        self._last_log_time    = 0.0

        # Label mode (manual collection via --label flag)
        self._label           = label
        self._label_file      = None
        self._label_writer    = None
        self._label_row_count = 0
        self._label_path      = None

        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        log.info("Focus engine thread started")

    # ── Control ──────────────────────────────────────────────────────────

    def start_watching(self):
        with self._lock:
            if self._watching:
                return
            self._watching = True
            self._log_rows         = []
            self._session_start_ts = time.time()
            self._last_log_time    = 0.0
            log.info("Watching started — session log reset")

    def stop_watching(self):
        with self._lock:
            self._watching = False
            # Only release camera if preview is also off
            if not self._show_camera and self._cap is not None:
                self._cap.release()
                self._cap = None
            log.info("Watching stopped")

    def set_show_camera(self, show: bool):
        with self._lock:
            self._show_camera = show
            if not show:
                self.camera_frame_b64 = None
                if not self._watching and self._cap is not None:
                    self._cap.release()
                    self._cap = None
        log.info(f"Show camera: {show}")

    def is_watching(self) -> bool:
        with self._lock:
            return self._watching

    # ── Detection helpers (same logic as original main.py) ───────────────

    def _ensure_models_loaded(self):
        if self._face is None:
            mp_face = mp.solutions.face_mesh
            self._face = mp_face.FaceMesh(max_num_faces=1, refine_landmarks=True)
            log.info("MediaPipe FaceMesh loaded")
        if self._yolo is None:
            self._yolo = YOLO("yolov8n.pt")
            log.info("YOLOv8 loaded")
        if self._model is None:
            if MODEL_PATH.exists():
                self._model = joblib.load(MODEL_PATH)
                log.info(f"Focus model loaded from {MODEL_PATH}")
            else:
                log.warning(f"Focus model not found at {MODEL_PATH} — score will be 50 until trained")

    def _ensure_camera_open(self) -> bool:
        if self._cap is None or not self._cap.isOpened():
            self._cap = cv2.VideoCapture(0)
            if not self._cap.isOpened():
                log.warning("Could not open camera")
                return False
        return True

    def _detect_phone(self, frame) -> bool:
        phone = False
        results = self._yolo(frame, verbose=False)
        for r in results:
            for box in r.boxes:
                if int(box.cls[0]) == 67:
                    phone = True
                    if self.show_debug_window:
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        cv2.rectangle(frame, (x1, y1), (x2, y2), RED, 3)
                        cv2.putText(frame, "PHONE", (x1, y1 - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, RED, 2)
        return phone

    def _compute_ear(self, lm) -> float:
        def _dist(a, b):
            return np.hypot(a.x - b.x, a.y - b.y)
        l_ear = _dist(lm[159], lm[145]) / (_dist(lm[33], lm[133]) + 1e-6)
        r_ear = _dist(lm[386], lm[374]) / (_dist(lm[362], lm[263]) + 1e-6)
        return (l_ear + r_ear) / 2.0

    def _update_blink(self, ear):
        if self._ear_prev < 0.2 and ear >= 0.2:
            self._blink_times.append(time.time())
        self._ear_prev = ear
        now = time.time()
        self._blink_rate = len([t for t in self._blink_times if now - t <= 60.0])

    # ── Label mode (manual data collection) ──────────────────────────────

    def start_label_session(self):
        TRAINING_DATA_DIR.mkdir(parents=True, exist_ok=True)
        ts_str = time.strftime("%Y%m%d_%H%M%S")
        self._label_path   = TRAINING_DATA_DIR / f"{self._label}_{ts_str}.csv"
        fieldnames = ["timestamp", "gaze_std", "head_var", "blink_rate",
                      "face_present", "phone_present", "pitch", "yaw", "label"]
        self._label_file   = open(self._label_path, "w", newline="")
        self._label_writer = csv.DictWriter(self._label_file, fieldnames=fieldnames)
        self._label_writer.writeheader()
        self._label_row_count = 0
        self.start_watching()
        log.info(f"Label session '{self._label}' started → {self._label_path}")
        log.info("Press Ctrl+C to stop and save.")

    def stop_label_session(self):
        if self._label_file is None:
            return
        self._label_file.flush()
        self._label_file.close()
        self._label_file   = None
        self._label_writer = None
        log.info(f"Label session saved: {self._label_row_count} rows → {self._label_path}")

    def _write_label_row(self, face_present: bool, phone_present: bool,
                         pitch: float, yaw: float):
        now = time.time()

        if len(self._gaze_history) >= 10:
            recent   = list(self._gaze_history)[-30:]
            gaze_std = np.std([p[0] for p in recent]) + np.std([p[1] for p in recent])
        else:
            gaze_std = 0.0

        if len(self._pitch_history) >= 10:
            head_var = np.std(list(self._pitch_history)) + np.std(list(self._yaw_history))
        else:
            head_var = 0.0

        self._label_writer.writerow({
            "timestamp":     round(now, 3),
            "gaze_std":      round(float(gaze_std), 6),
            "head_var":      round(float(head_var), 6),
            "blink_rate":    round(self._blink_rate, 2),
            "face_present":  int(face_present),
            "phone_present": int(phone_present),
            "pitch":         round(pitch, 4),
            "yaw":           round(yaw, 4),
            "label":         self._label,
        })
        self._label_row_count += 1
        if self._label_row_count % 30 == 0:   # flush ~once per second
            self._label_file.flush()

    def _maybe_log_snapshot(self, face_present: bool, phone_present: bool):
        now = time.time()
        if now - self._last_log_time < LOG_INTERVAL_SECS:
            return
        self._last_log_time = now

        if len(self._gaze_history) >= 10:
            recent   = list(self._gaze_history)[-30:]
            gaze_std = np.std([p[0] for p in recent]) + np.std([p[1] for p in recent])
        else:
            gaze_std = 0.0

        if len(self._pitch_history) >= 10:
            head_var = np.std(list(self._pitch_history)) + np.std(list(self._yaw_history))
        else:
            head_var = 0.0

        self._log_rows.append({
            "timestamp":     round(now, 3),
            "gaze_std":      round(float(gaze_std), 6),
            "head_var":      round(float(head_var), 6),
            "blink_rate":    round(self._blink_rate, 2),
            "face_present":  int(face_present),
            "phone_present": int(phone_present),
        })

    def _save_training_csv(self, rating: int):
        rows = self._log_rows
        if not rows:
            log.info("No rows logged — skipping CSV write")
            return
        TRAINING_DATA_DIR.mkdir(parents=True, exist_ok=True)
        ts_str = time.strftime(
            "%Y%m%d_%H%M%S",
            time.localtime(self._session_start_ts or time.time())
        )
        path = TRAINING_DATA_DIR / f"session_{ts_str}.csv"
        fieldnames = ["timestamp", "gaze_std", "head_var",
                      "blink_rate", "face_present", "phone_present", "rating"]
        with open(path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow({**row, "rating": rating})
        self._log_rows         = []
        self._session_start_ts = None
        log.info(f"Saved {len(rows)} rows → {path}")

    def _compute_focus(self, face_present: bool, phone_present: bool,
                        pitch: float, yaw: float) -> int:
        # ── Enforcement layer (hard overrides) ────────────────────────────
        if not face_present:
            return 0
        if phone_present:
            return 0

        # Update histories
        self._pitch_history.append(pitch)
        self._yaw_history.append(yaw)

        # Fall back to 50 if model not loaded
        if self._model is None:
            return 50

        # Compute rolling features (match training schema exactly)
        if len(self._gaze_history) >= 10:
            recent   = list(self._gaze_history)[-30:]
            gaze_std = float(np.std([p[0] for p in recent]) + np.std([p[1] for p in recent]))
        else:
            gaze_std = 0.0

        if len(self._pitch_history) >= 10:
            head_var = float(np.std(list(self._pitch_history)) + np.std(list(self._yaw_history)))
        else:
            head_var = 0.0

        # ── Model inference ───────────────────────────────────────────────
        features = np.array([[gaze_std, head_var, self._blink_rate, pitch, yaw]])
        prob_focused = float(self._model.predict_proba(features)[0][1])
        return max(0, min(100, int(prob_focused * 100)))

    # ── Main camera loop ──────────────────────────────────────────────────

    def _loop(self):
        pitch, yaw = 0.0, 0.0

        while True:
            with self._lock:
                watching = self._watching
                show_cam = self._show_camera

            if not watching and not show_cam:
                # Nothing active — release camera if open
                if self._cap is not None:
                    self._cap.release()
                    self._cap = None
                time.sleep(0.1)
                continue

            # Camera needed for either detection or preview
            if watching:
                self._ensure_models_loaded()
            if not self._ensure_camera_open():
                time.sleep(1.0)
                continue

            ret, frame = self._cap.read()
            if not ret:
                time.sleep(0.1)
                continue

            if watching:
                phone = self._detect_phone(frame)

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                res = self._face.process(rgb)

                face_present = False
                if res.multi_face_landmarks:
                    face_present = True
                    mesh = res.multi_face_landmarks[0]
                    lm   = mesh.landmark

                    # Gaze
                    left  = lm[468]
                    right = lm[473]
                    gx = (left.x + right.x) / 2
                    gy = (left.y + right.y) / 2
                    self._gaze_history.append((gx, gy))

                    # Head pose
                    pitch = (lm[199].y - lm[1].y) * 120
                    yaw   = (lm[454].x - lm[234].x - 0.45) * 200

                    # Blink
                    ear = self._compute_ear(lm)
                    self._update_blink(ear)

                self.focus_score = self._compute_focus(face_present, phone, pitch, yaw)
                self._maybe_log_snapshot(face_present, phone)
                if self._label_writer is not None:
                    self._write_label_row(face_present, phone, pitch, yaw)
                self.is_gaming   = self._gaming.gaming()

                if self.is_gaming:
                    self._close_active_tab()
                    self._gaming.reset()

                if self.show_debug_window:
                    self._draw_debug_window(frame, pitch, yaw, phone)

            # Encode frame for "See yourself" preview
            if show_cam:
                ok, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
                self.camera_frame_b64 = base64.b64encode(buf).decode('ascii') if ok else None

            time.sleep(self.FRAME_INTERVAL)

    def _close_active_tab(self):
        try:
            subprocess.run(
                ["osascript", "-e",
                 'tell application "Google Chrome" to close active tab of front window'],
                check=False
            )
            log.info("Gaming detected — closed active Chrome tab")
        except Exception as e:
            log.warning(f"Could not close tab: {e}")

    def _draw_debug_window(self, frame, pitch, yaw, phone):
        h, w = frame.shape[:2]
        overlay = frame.copy()
        cv2.rectangle(overlay, (10, 10), (270, 140), (20, 20, 20), -1)
        cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)
        lines = [
            (f"FOCUS: {self.focus_score:3d}", (0, 255, 180)),
            (f"GAMING: {'YES' if self.is_gaming else 'NO'}",
             RED if self.is_gaming else (0, 200, 80)),
            (f"PHONE:  {'YES' if phone else 'NO'}",
             RED if phone else (0, 200, 80)),
            (f"BLINK:  {self._blink_rate:.0f}/min", (200, 200, 255)),
            (f"PITCH: {pitch:+.1f}  YAW: {yaw:+.1f}", (200, 200, 255)),
        ]
        for i, (text, color) in enumerate(lines):
            cv2.putText(frame, text, (20, 34 + i * 24),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.56, color, 2, cv2.LINE_AA)
        cv2.imshow("StudySight Debug", frame)
        cv2.waitKey(1)


# ── WebSocket server ───────────────────────────────────────────────────────────

_engine: FocusEngine = None
_clients: set = set()


async def _handler(websocket):
    _clients.add(websocket)
    log.info(f"Client connected ({len(_clients)} total)")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                cmd  = data.get("cmd")
                if cmd == "start_watching":
                    _engine.start_watching()
                elif cmd == "stop_watching":
                    _engine.stop_watching()
                elif cmd == "set_camera":
                    _engine.set_show_camera(bool(data.get("show", False)))
                elif cmd == "end_session":
                    rating = int(data.get("rating", 0))
                    if 1 <= rating <= 5:
                        _engine._save_training_csv(rating)
            except json.JSONDecodeError:
                pass
    except websockets.exceptions.ConnectionClosedError:
        pass
    finally:
        _clients.discard(websocket)
        # If no clients remain, stop watching to save resources
        if not _clients:
            _engine.stop_watching()
        log.info(f"Client disconnected ({len(_clients)} remaining)")


async def _broadcast_loop():
    """Sends focus score (and optional camera frame) to all clients every 500ms."""
    while True:
        if _clients:
            payload = {"focus_score": _engine.focus_score}
            if _engine.camera_frame_b64 is not None:
                payload["camera_frame"] = _engine.camera_frame_b64
            msg = json.dumps(payload)
            dead = set()
            for ws in list(_clients):
                try:
                    await ws.send(msg)
                except Exception:
                    dead.add(ws)
            _clients.difference_update(dead)
        await asyncio.sleep(0.5)


async def _main(port: int, show_debug: bool, label: str = None):
    global _engine
    _engine = FocusEngine(show_debug_window=show_debug, label=label)

    if label:
        _engine.start_label_session()

    broadcast_task = asyncio.create_task(_broadcast_loop())

    async with websockets.serve(_handler, "127.0.0.1", port):
        log.info(f"WebSocket server listening on ws://127.0.0.1:{port}")
        await asyncio.Future()  # run forever


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="StudySight focus engine server")
    parser.add_argument("--port",  type=int, default=DEFAULT_PORT,
                        help="WebSocket port (default: 8765)")
    parser.add_argument("--debug-window", action="store_true",
                        help="Show OpenCV debug window when watching")
    parser.add_argument("--label", type=str, default=None,
                        help="Start a manual label session, e.g. 'off_task_computer'. "
                             "Logs every frame to training-data/<label>_<timestamp>.csv. "
                             "Press Ctrl+C to stop and save.")
    args = parser.parse_args()

    try:
        asyncio.run(_main(args.port, args.debug_window, args.label))
    except KeyboardInterrupt:
        log.info("Shutting down")
        if _engine:
            _engine.stop_label_session()
            _engine.stop_watching()
        if cv2:
            cv2.destroyAllWindows()
