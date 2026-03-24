# StudySight — Claude Code Project Context

> **Living document.** After every completed feature, update the relevant section below before ending the session. This keeps context accurate across sessions and prevents re-explaining architecture.

---

## What this app is

StudySight is a Pomodoro timer Mac desktop app (Tauri v2) that integrates with a Python webcam-based focus detection system. When focus score is high enough near the end of a session, the timer pauses instead of forcing a break — the user stays in a "Locked In" state as long as focus holds. App name is a placeholder, user plans to rename.

---

## Repo location

```
/Users/zackbrown/focusflow-app/
```


## Project scope

This is not just the desktop app. The full project includes:
- **StudySight desktop app** — Tauri v2, Mac-first, webcam focus detection (active)
- **Marketing website** — landing page, screenshots, download button, email capture (not started)
- **Backend / payments** — Stripe or Paddle for freemium monetization (not started)
- **TikTok / social content** — student-targeted organic marketing (not started)

App rename is pending — current name "StudySight" is a placeholder. Target audience: students studying/doing homework.

---

## Rules Claude must always follow

1. **Read the relevant file(s) first** before writing any code — always use `cat` or `read_file` on the file you're about to change. Then update CLAUDE.md to reflect any structural changes made.
2. **State your approach and ask if it's right** before writing code. One sentence is enough: "I'm going to add X to goals.js by doing Y — does that sound right?"
3. **Complete the full feature without stopping.** Once the user approves the approach, make all the changes needed to finish it — one file per response, but move straight to the next file automatically without asking "should I continue?" or "want me to do the next part?". Only stop and ask if you hit something genuinely unexpected or ambiguous mid-task. Never say "go ahead and say go to continue" — just keep going until the feature is done.
4. **Match existing code style.** Use the same patterns already in the file. If you spot a potential issue with existing code, flag it in one line but don't fix it unless asked.
5. **Update this file (CLAUDE.md) after every completed feature.** When the user confirms something is done, update the task list AND the relevant architecture section to reflect the new state. This is mandatory — do it before the session ends.
6. **Security check before shipping anything to users.** Before any feature touching payments, network ports, user data, or external APIs — run `/vibe-security` first. Install: `npx skills add https://github.com/raroque/vibe-security-skill --skill vibe-security`. The WebSocket server on port 8765 must never be exposed outside localhost. No API keys hardcoded anywhere. When Stripe/Paddle is added, never trust client-submitted prices — always validate server-side.

---

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

---

## Design system — TrafficTrace

| Token | Value |
|---|---|
| Sidebar | 240px fixed, `#1E2124` dark charcoal |
| Page bg | `#F8F9FB` light / `#0F1117` dark |
| Cards | `#ffffff`, `1px solid #E5E7EB`, `border-radius: 12px`, `0 1px 3px rgba(0,0,0,0.06)` |
| Brand blue | `#3B82F6` (buttons, ring fill focus, chart 1) |
| Green | `#10B981` (ring fill break, positive, locked-in) |
| Text primary | `#111827` |
| Text secondary | `#6B7280` |
| Text muted | `#9CA3AF` |
| Nav active bg | `#2D3035` |

Design system file: `/Users/zackbrown/Downloads/trafficTrace-design-system.md`

---

## Dark mode

- Implemented via `[data-theme="dark"]` on `<html>`
- Toggle: Settings → General → "Dark mode"
- Persisted in `localStorage` under `studysight_settings.darkMode`
- `applyTheme(dark)` in `app.js` sets the attribute
- Dark sidebar bg: `#13151A`, card bg: `#1A1D23`, page bg: `#0F1117`
- Goals page has its own CSS variable block — both light and dark passes are complete ✅

---

## Timer state machine (timer.js)

```
IDLE → (start) → FOCUS
FOCUS → (≤watchWindow secs left) → FOCUS_WATCHING      [engine sampling]
FOCUS_WATCHING → (score≥90 for 30s) → LOCKED_IN        [timer paused]
LOCKED_IN → (score drops) → LOCKED_IN_WARNING
LOCKED_IN_WARNING → (recovers) → LOCKED_IN
LOCKED_IN_WARNING → (45s distracted) → BREAK            [alarm fires]
FOCUS / FOCUS_WATCHING → (timer hits 0) → BREAK
BREAK → (countdown ends) → IDLE
```

**Configurable values** (all in Advanced settings):

| Key | Default | Description |
|---|---|---|
| `threshold` | 90 | Focus score to lock in |
| `lockInSecs` | 30 | Seconds at threshold before locking |
| `distractSecs` | 45 | Grace period before break triggers |
| `watchWindow` | 60 | Seconds before end to activate engine |
| `wsPort` | 8765 | WebSocket port |

**Tray state label mapping** (for future tray tooltip update):

| State | Display |
|---|---|
| IDLE | "Ready" |
| FOCUS | "Focusing" |
| FOCUS_WATCHING | "Focusing" |
| LOCKED_IN | "Locked In" |
| LOCKED_IN_WARNING | "Losing Focus" |
| BREAK | "Break" |

---

## Goals page (goals.js)

### Data model — `localStorage` key: `studysight_goals`

```js
{
  id:          string,       // String(Date.now())
  type:        string,       // 'study'|'exercise'|'reading'|'habit'|'project'|'other'
  title:       string,
  notes:       string,
  dueDate:     string|null,  // "YYYY-MM-DD"
  status:      'active'|'cancelled',
  createdAt:   number,
  completions: { [dateKey]: boolean }  // dateKey = "YYYY-M-D"
}
```

### Features — Goals page

| Feature | Status |
|---|---|
| Empty state | ✅ Done |
| Add goal modal (2-step) | ✅ Done |
| Goal cards with type pill, notes, due date | ✅ Done |
| Daily checkbox with strikethrough | ✅ Done |
| 3-dot menu (edit, cancel, delete) | ✅ Done |
| Activity chart (canvas, 7/14/30 day) | ✅ Done |
| Edit modal pre-filled | ✅ Done |
| Dark mode | ✅ Done |
| Light mode CSS pass | ✅ Done |
| Habit frequency (daily/weekdays/custom) | 🔲 Not started |
| Morning/afternoon/evening grouping | 🔲 Not started |

### HTML structure

```
#view-goals
├── .page-header → #g-add-goal-btn
├── .goals-layout (55/45 grid)
│   ├── .goals-col-left → .g-card → #g-goal-list (JS-rendered)
│   └── .goals-col-right → .g-card.g-activity-card → #g-activity-chart (canvas)
└── #g-modal-overlay.g-modal--hidden → .g-modal-box → #g-modal-body (JS-rendered)
```

### Public API

- `Goals.init()` — called on boot, wires Add button, modal overlay, list events
- `Goals.refresh()` — called when nav switches to Goals view, renders cards + chart

### Goals CSS variables

```css
/* Light mode (:root) */
--g-page-bg: #F8F9FB
--g-card-bg: #ffffff
--g-card-bg-elevated: #F3F4F6
--g-card-border: #E5E7EB
--g-text-primary: #111827
--g-text-secondary: #6B7280
--g-text-muted: #9CA3AF

/* Dark mode ([data-theme="dark"]) */
--g-page-bg: #111214
--g-card-bg: #1A1C1F
--g-card-bg-elevated: #222428
--g-card-border: rgba(255,255,255,0.06)
--g-text-primary: #F1F1F1
--g-text-secondary: #9CA3AF
--g-text-muted: #4B5563
```

---

## Session data (app.js / stats.js)

- Stored in `localStorage` key `studysight_sessions`
- Always local, never sent anywhere
- Timer resets on app close (no remaining-time persistence)
- Stats view: 4 KPI cards + 2 canvas charts
- **Future:** add `distractions: [{time: timestamp}]` array to each session object

---

## Settings (app.js)

- `localStorage` key: `studysight_settings`
- Alarm sounds: chime, bell, soft, custom file (base64)
- Advanced: show focus score live, show camera feed, all threshold values
- General: study/break duration, watch window, dark mode toggle

---

## Focus engine (focus_server.py)

- Spawned as subprocess by Tauri when timer starts
- WebSocket server on `ws://127.0.0.1:8765`
- Commands: `{"cmd": "start_watching"}` / `{"cmd": "stop_watching"}`
- Broadcasts: `{"focus_score": N}` every 500ms
- Camera only opens when `start_watching` is received
- Detection: gaze stability, head pose, blink rate, phone detection (YOLO class 67), face presence
- Gaming detection (WASD ratio) → closes active Chrome tab via osascript

---

## Tauri config

- v2.10.1, Rust 1.94.0, Node v25.8.1
- Tray: shows time remaining in tooltip, menu = "Open StudySight" + "Quit"
- `update_tray_tooltip` Tauri command called from JS each tick
- Python engine spawned via `window.__TAURI__.shell.Command.create('python3', [...])`

**Commands:**
```bash
# Dev
cd focusflow-app && cargo tauri dev

# Build
cd focusflow-app && source "$HOME/.cargo/env" && cargo tauri build

# Python deps
pip3 install -r focus-engine/requirements.txt
```

---

## Nav items (sidebar order)

1. Timer (`data-view="timer"`) — clock icon
2. Stats (`data-view="stats"`) — bar chart icon
3. Goals (`data-view="goals"`) — bullseye icon
4. Settings (`data-view="settings"`) — gear icon (under "Preferences" label)

---

## app.js boot sequence

```js
Goals.init()
applySettingsToInputs()      // also calls applyTheme(settings.darkMode)
updateSessionCountDisplay()
setRingStatic(...)
Timer.init(callbacks, config)
Notification.requestPermission()
```

---

## Task list

### ✅ Completed
- [x] Timer state machine
- [x] Focus engine WebSocket integration
- [x] Ring animation (requestAnimationFrame, not CSS)
- [x] Stats page (4 KPIs + 2 canvas charts)
- [x] Goals page — full feature set (modal, cards, checkbox, activity chart)
- [x] Dark mode (entire app)
- [x] Goals page light mode CSS pass
- [x] Tray tooltip with time remaining
- [x] Alarm system (chime/bell/soft/custom)
- [x] Settings persistence

### 🔲 Up next (in rough priority order)
- [ ] Onboarding flow — single screen overlay, one button, no account required, fires on first launch when `studysight_settings` doesn't exist
- [ ] Habit frequency on Goals — add `frequency` field, day-of-week toggle in modal, only show checkbox on scheduled days
- [ ] Morning/afternoon/evening grouping — optional `timeOfDay` field, section headers in goal list
- [ ] Distraction tap logger — "Got distracted" button during FOCUS/FOCUS_WATCHING, logs timestamps to session
- [ ] Distraction hour-of-day chart — in Stats view, bucket distraction timestamps by hour, canvas bar chart
- [ ] Tray tooltip state name — append state label e.g. "StudySight · 18:42 · Locked In"
- [ ] "See yourself" camera feed toggle — setting exists in UI, not yet wired to focus_server.py
- [ ] App rename — placeholder name, user to decide
- [ ] Goals page — when frequency is added, streak logic should only count scheduled days
- [ ] Windows/Linux support — only Mac-specific code is osascript tab-close
- [ ] Marketing website with platform download buttons
- [ ] ML model trained on user data (replaces heuristic focus scoring)

---

## Product research — user pain points to guide decisions

These come from real Reddit threads, App Store reviews, and Chrome Web Store reviews of habit trackers, Pomodoro timers, and goal trackers. Use these when making product decisions:

| Pain point | How StudySight should handle it |
|---|---|
| Subscription fatigue — users hate monthly fees for basic features | Keep core features free, be generous with the free tier |
| Aggressive ads / upsell popups kill retention | No interruptive ads, ever |
| Onboarding takes too long | First session running in <60 seconds, no account required |
| Habit streaks break unfairly (missed scheduled day ≠ fail) | Only count streak on days the habit was scheduled |
| No sub-habit rep counting (e.g. brush teeth 3x = 1 habit) | Future: add rep-count option to habit frequency |
| Gamification feels childish for professional users | Keep LOCKED_IN mechanic serious and data-driven, not cutesy |
| Analytics show streaks only, not real patterns | Add distraction timing chart, completion rate trends |
| No time-of-day habit grouping | Morning/afternoon/evening grouping planned |
| Cross-platform sync expected | Future: iCloud or local network sync |
| No distraction logging during focus sessions | Planned: tap logger + hour-of-day chart |

---

## Known issues / gotchas

- **ECONNRESET**: If Claude writes too much in one response, the API connection resets. Fix: one file per response max, but move straight to the next file automatically — never wait for "go" between files within the same feature.
- **Timer does not persist remaining time** across app close — resets to full duration on relaunch. Intentional for now.
- `studysight_settings` not existing = first launch. Use this as the onboarding trigger.
- Python engine only spawns when timer starts — camera stays closed until `start_watching` is sent.
- osascript tab-close (gaming detection) is Mac-only — needs platform guard before Windows/Linux support.

---

## Original files (not actively developed)

- `/Users/zackbrown/main.py` — original monolithic focus detection script
- `/Users/zackbrown/focusflow/` — original Chrome MV3 extension
