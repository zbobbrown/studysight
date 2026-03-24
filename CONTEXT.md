---
name: StudySight architecture
description: Complete project context — app structure, design system, state machine, Goals page, dark mode, all decisions made so far
type: project
---

## What it is
StudySight is a Pomodoro timer Mac desktop app (Tauri v2) that integrates with a Python-based focus detection system (webcam + CV). When focus score is high enough at the end of a session, the timer pauses instead of going to break. App name is a placeholder — user plans to rename.

## Repo location
`/Users/zackbrown/focusflow-app/`

## Project structure
```
focusflow-app/
├── src/
│   ├── index.html         # SPA — Timer, Stats, Settings, Goals views
│   ├── style.css          # TrafficTrace design system + dark mode + Goals CSS
│   └── js/
│       ├── timer.js       # State machine + WebSocket client
│       ├── app.js         # UI bridge, settings, session storage, alarm
│       ├── stats.js       # Canvas charts, session data
│       └── goals.js       # Goals page — data, modal, checkbox, chart
├── focus-engine/
│   ├── focus_server.py    # WebSocket server (port 8765)
│   └── requirements.txt
└── src-tauri/
    ├── src/
    │   ├── main.rs        # Entry point (calls studysight_lib::run())
    │   └── lib.rs         # Tray setup, update_tray_tooltip command, shell plugin
    ├── Cargo.toml         # name="studysight", lib name="studysight_lib"
    ├── tauri.conf.json    # 1100x750, identifier=com.studysight.timer
    └── capabilities/default.json  # shell:allow-spawn/execute/kill
```

## Layout — TrafficTrace design system
- **Sidebar**: 240px fixed, `#1E2124` dark charcoal, SVG icon nav items (Timer, Stats, Goals, Settings)
- **Page bg**: `#F8F9FB` light gray (dark mode: `#0F1117`)
- **Cards**: `#ffffff`, `1px solid #E5E7EB`, `border-radius: 12px`, `0 1px 3px rgba(0,0,0,0.06)` shadow
- **Brand blue**: `#3B82F6` (buttons, ring fill focus, chart 1)
- **Green**: `#10B981` (ring fill break, positive, locked-in)
- **Text primary**: `#111827`, secondary: `#6B7280`, muted: `#9CA3AF`
- **Nav item active bg**: `#2D3035`
- Design system file: `/Users/zackbrown/Downloads/trafficTrace-design-system.md`

## Dark mode
- Implemented via `[data-theme="dark"]` attribute on `<html>`
- Toggle in Settings → General → "Dark mode" toggle
- Persisted in localStorage under `studysight_settings.darkMode`
- `applyTheme(dark)` in app.js sets the attribute
- Dark mode overrides all `--color-*` CSS variables
- Dark sidebar bg: `#13151A`, card bg: `#1A1D23`, page bg: `#0F1117`

## Timer state machine (timer.js)
```
IDLE → (start) → FOCUS
FOCUS → (≤watchWindow secs left) → FOCUS_WATCHING  [engine sampling]
FOCUS_WATCHING → (score≥90 for 30s) → LOCKED_IN    [timer paused]
LOCKED_IN → (score drops) → LOCKED_IN_WARNING
LOCKED_IN_WARNING → (recovers) → LOCKED_IN
LOCKED_IN_WARNING → (45s distracted) → BREAK        [alarm fires]
FOCUS / FOCUS_WATCHING → (timer hits 0) → BREAK
BREAK → (countdown ends) → IDLE
```

Key config (all user-configurable in Advanced settings):
- `threshold`: 90 (focus score to lock in)
- `lockInSecs`: 30 (seconds at threshold to lock in)
- `distractSecs`: 45 (grace period before break triggers)
- `watchWindow`: 60 (seconds before end to activate engine)
- `wsPort`: 8765

## Goals page (goals.js) — FULLY IMPLEMENTED THIS SESSION
Goals page is a real user-managed goals system stored in localStorage.

### Data model (localStorage key: `studysight_goals`)
```js
{
  id:          string,       // String(Date.now())
  type:        string,       // 'study'|'exercise'|'reading'|'habit'|'project'|'other'
  title:       string,
  notes:       string,
  dueDate:     string|null,  // e.g. "2026-03-25"
  status:      'active'|'cancelled',
  createdAt:   number,       // timestamp
  completions: { [dateKey]: boolean }  // dateKey = "YYYY-M-D"
}
```

### Features built
1. **Empty state** — starts blank, shows "No goals yet / Click + Add goal"
2. **Add Goal modal** — two steps: pick type (6 options with emoji icons) → fill title/notes/due date → Save
3. **Goal cards** — rendered by JS into `#g-goal-list`, each has: type pill, title, optional notes, optional due date, 3-dot menu, daily checkbox
4. **Daily checkbox** — checking grays out + strikes through the title, persisted in `completions[todayKey]`
5. **3-dot menu** — Edit (re-opens modal), Mark as cancelled / Restore goal, Delete (with confirm)
6. **Activity chart** — canvas bar chart showing how many goals completed per day, wired to real `completions` data, dropdown to switch 7/14/30 day period
7. **Edit** — same modal as Add, pre-filled with existing data

### HTML structure (in index.html)
```
#view-goals
├── .page-header → #g-add-goal-btn
├── .goals-layout (55/45 grid)
│   ├── .goals-col-left → .g-card → #g-goal-list (JS-rendered)
│   └── .goals-col-right → .g-card.g-activity-card → #g-activity-chart (canvas)
└── #g-modal-overlay.g-modal--hidden → .g-modal-box → #g-modal-body (JS-rendered)
```

### Key CSS classes
- `.g-goal-card`, `.g-goal-card--cancelled` — card layout
- `.g-checkbox`, `.g-checkbox--checked` — daily check button
- `.g-goal-title--done` — strikethrough style when checked
- `.g-context-menu`, `.g-menu-item`, `.g-menu-item--danger` — 3-dot dropdown
- `.g-modal-overlay`, `.g-modal--hidden`, `.g-modal-box` — add/edit modal
- `.g-type-btn`, `.g-type-grid` — type picker grid
- `.g-input`, `.g-textarea` — form fields
- `.g-activity-card`, `#g-activity-chart` — canvas chart card
- `.g-chart-period-select` — period dropdown
- `.g-empty-state` — empty list state

### Goals CSS variables (in :root — dark by default, light pass TBD)
```css
--g-page-bg: #111214
--g-card-bg: #1A1C1F
--g-card-bg-elevated: #222428
--g-card-border: rgba(255,255,255,0.06)
--g-accent-green: #22C55E
--g-accent-red: #DC2626
--g-accent-blue: #3B82F6
--g-text-primary: #F1F1F1
--g-text-secondary: #9CA3AF
--g-text-muted: #4B5563
```

### Public API (Goals object)
- `Goals.init()` — called on boot, wires Add button, modal overlay, list events
- `Goals.refresh()` — called when nav switches to Goals view, renders cards + chart

## Buttons (3 buttons on timer)
- **Start** (`#btn-start`): enabled when IDLE. Text becomes "Resume" when paused.
- **Pause** (`#btn-pause`): enabled when running
- **Reset** (`#btn-reset`): always enabled
- **Stop Alarm** (`#btn-stop-alarm`) in `#alarm-banner`: appears only when break alarm is ringing

## Ring animation
- Uses `requestAnimationFrame` in app.js (NOT CSS transition) — smooth continuous motion
- Interpolates between 1-second timer ticks using `performance.now()`
- Ring SVG: `stroke-dasharray: 628` (2π × 100), track `#F3F4F6`, fill `#3B82F6`/`#10B981`

## Session data
- Stored in `localStorage` key `studysight_sessions` — always local, never sent anywhere
- Timer resets on app close (no remaining-time persistence)
- Stats: 4 KPI cards + 2 canvas charts

## Settings storage
- `localStorage` key `studysight_settings`
- Alarm sounds: chime, bell, soft, custom file (base64)
- Advanced: show focus score live, show camera feed, all threshold values
- General: study/break duration, watch window, **dark mode toggle**

## Focus engine (focus_server.py)
- Spawned as subprocess by Tauri when timer starts
- WebSocket server on `ws://127.0.0.1:8765`
- Commands: `{"cmd": "start_watching"}` / `{"cmd": "stop_watching"}`
- Broadcasts: `{"focus_score": N}` every 500ms
- Camera only opens when `start_watching` is received
- Detection: gaze stability, head pose, blink rate, phone (YOLO class 67), face presence
- Gaming detection (WASD ratio) → closes active Chrome tab via osascript

## Tauri
- v2.10.1, Rust 1.94.0, Node v25.8.1
- Tray: shows time remaining in tooltip, menu has "Open StudySight" + "Quit"
- `update_tray_tooltip` Tauri command called from JS each tick
- Python engine spawned via `window.__TAURI__.shell.Command.create('python3', [...])`
- Build: `cd focusflow-app && source "$HOME/.cargo/env" && cargo tauri build`
- Dev: `cargo tauri dev` (run from `focusflow-app/`)
- Install Python deps: `pip3 install -r focus-engine/requirements.txt`

## Nav items (sidebar, in order)
1. Timer (`data-view="timer"`) — clock icon
2. Stats (`data-view="stats"`) — bar chart icon
3. Goals (`data-view="goals"`) — bullseye/target icon
4. Settings (`data-view="settings"`) — gear icon (under "Preferences" label)

## app.js boot sequence
```
Goals.init()
applySettingsToInputs()   ← also calls applyTheme(settings.darkMode)
updateSessionCountDisplay()
setRingStatic(...)
Timer.init(callbacks, config)
Notification.requestPermission()
```

## What's NOT yet built (future work)
- Goals page light mode CSS overrides (dark is base, light pass requested next)
- "See yourself" camera feed toggle (setting exists, not wired)
- ML model trained on user data (replaces heuristic focus scoring)
- Marketing website with platform download buttons
- Windows/Linux support (only Mac-specific code is osascript tab-close)
- App rename (user plans to rename from "StudySight")

## ECONNRESET fix
When I (Claude) write too much in one response, the API connection resets. Solution: do one feature/file at a time, say "keep going" or "go" between each step. This is the pattern that works.

## Original files (not actively developed)
- `/Users/zackbrown/main.py` — original monolithic focus detection script
- `/Users/zackbrown/focusflow/` — original Chrome MV3 extension
