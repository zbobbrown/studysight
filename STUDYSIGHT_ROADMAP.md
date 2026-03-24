# StudySight — Feature Roadmap & Claude Code Prompts

> Paste each prompt directly into Claude Code. Each is self-contained and references the right files.
> After each feature is done, tick it off and update CLAUDE.md.

---

## 1. Custom session length (type exact minutes)
**Effort:** Quick win — ~45 mins
**Files:** `src/index.html`, `src/style.css`, `src/js/app.js`

```
Read src/index.html and src/js/app.js first. I want to replace the 
study duration slider in Settings with a control that lets users either 
use the slider OR type an exact number of minutes into a small input 
field next to it. The input should accept any integer between 1 and 240. 
Typing a number updates the slider position, and moving the slider 
updates the number. Save the value the same way the slider currently 
does — into studysight_settings. Match the existing settings input style.
```

---

## 2. Confetti micro-animation on goal check
**Effort:** Quick win — ~1 hour
**Files:** `src/js/goals.js`, `src/style.css`

```
Read src/js/goals.js first. When a user checks off a goal for the day 
(the daily checkbox), trigger a small confetti burst animation centered 
on the checkbox. Use a pure CSS + JS approach — spawn ~12 small colored 
divs (squares/circles, ~5px) from the checkbox position, animate them 
outward with random angles and fade out over 500ms, then remove them 
from the DOM. Colors should use the Goals accent palette: #22C55E, 
#3B82F6, #F59E0B. No external libraries. Don't touch the checkbox logic 
itself — just add the visual burst on top of the existing check handler.
```

---

## 3. Due date urgency colors (amber/red border)
**Effort:** Quick win — ~30 mins
**Files:** `src/js/goals.js`, `src/style.css`

```
Read src/js/goals.js first. When rendering goal cards, check the 
dueDate field against today's date. If due within 3 days: add a CSS 
class that gives the card a left border of 3px solid #F59E0B (amber). 
If due today or overdue: left border 3px solid #DC2626 (red). Add a 
tiny label below the due date text — "Due soon" in amber or "Overdue" 
in red — using a small pill badge. Goals with no due date or due date 
more than 3 days away are unchanged. Add the two CSS classes to 
style.css using the existing --g- variable pattern.
```

---

## 4. Goal card progress bar (X of 30 days)
**Effort:** Medium — ~2 hours
**Files:** `src/js/goals.js`, `src/style.css`

```
Read src/js/goals.js first. Under each goal card's title, add a thin 
progress bar (4px tall, full card width, border-radius 2px) showing 
completion progress since the goal was created. Calculate: total days 
since createdAt that match the goal's frequency schedule, vs how many 
of those days have a true value in completions. Show "X / Y days" as 
small muted text to the right of the bar. Bar fill color: #22C55E 
(--g-accent-green). Background: --g-card-bg-elevated. Don't show the 
bar on cancelled goals. Keep it visually tight — no extra vertical 
space beyond what the bar itself takes.
```

---

## 5. Weekly review modal
**Effort:** Bigger lift — ~1 day
**Files:** `src/js/stats.js`, `src/js/app.js`, `src/index.html`, `src/style.css`

```
Read src/js/stats.js and src/js/app.js first. Build a weekly review 
modal that appears automatically on the first app launch of the week 
(Monday, detected via localStorage key studysight_last_review_week). 
The modal overlays the full app. Contents:
- Heading: "Last week" with the date range
- Total focus time (sum of durationSecs from last week's sessions)
- Number of sessions completed
- Best focus day (day of week with most focus time)
- Longest Locked In duration across all sessions
- Goals completed last week (count of completions in studysight_goals)
- A "Start this week" dismiss button that saves the current week number

Style it as a premium centered card using the TrafficTrace design 
system — white card, 12px radius, generous padding, clean typography. 
Also add a "Weekly Review" button in the Stats page header so users 
can manually open it anytime. Store the modal HTML in index.html and 
render data into it via JS.
```

---

## 6. Menubar mini-mode popover
**Effort:** Bigger lift — ~1 day
**Files:** `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, new `src/popover.html`, `src/js/app.js`

```
Read src-tauri/src/lib.rs and src-tauri/tauri.conf.json first. I want 
a small popover window that opens when clicking the tray icon instead 
of (or in addition to) the current "Open StudySight" menu item. The 
popover should be:
- 280px wide, 160px tall
- No titlebar (decorations: false)
- Positioned near the tray icon (top-right of screen)
- Shows current timer state, time remaining, and Start/Pause button
- Clicking "Open" in the popover brings up the main window

Create a minimal popover.html that reads timer state from localStorage 
and communicates with the main window via Tauri events. Wire the tray 
click in lib.rs to toggle this popover window instead of just showing 
the menu. Keep the right-click tray menu as-is.
```

---

## 7. Session notes after break starts
**Effort:** Medium — ~2 hours
**Files:** `src/js/app.js`, `src/js/timer.js`, `src/index.html`, `src/style.css`

```
Read src/js/app.js and src/index.html first. When the timer transitions 
to BREAK state, show a small unobtrusive panel that slides up from the 
bottom of the timer view (not a modal — inline, below the ring). It 
contains a single textarea: "What did you get done?" with a soft 
placeholder. A "Save" button writes the note text to the most recent 
session object in studysight_sessions under a new `note` field. A "Skip" 
link dismisses the panel. The panel should auto-dismiss when the break 
timer ends. Style it as a card using existing TrafficTrace tokens — 
subtle, doesn't compete with the break ring visually.
```

---

## 8. Ambient sounds during focus (rain, brown noise, cafe)
**Effort:** Bigger lift — ~1 day
**Files:** `src/js/app.js`, `src/index.html`, `src/style.css`, new `src/sounds/`

```
Read src/js/app.js and src/index.html first. Add an ambient sound 
feature that plays looping audio during FOCUS and FOCUS_WATCHING states 
and pauses during BREAK and LOCKED_IN. Add a small sound picker to the 
timer view (bottom of the page, subtle) with options: None, Rain, Brown 
Noise, Cafe. Use the Web Audio API to generate brown noise procedurally 
(no audio file needed). For Rain and Cafe, use royalty-free audio files 
bundled into src/sounds/. Volume should be low by default (~20%) with a 
small slider. Persist the selected sound and volume in 
studysight_settings under ambientSound and ambientVolume. Auto-pause 
sound when the app loses focus (visibilitychange event).
```

---

## 9. Smooth timer number tick animation
**Effort:** Medium — ~2 hours
**Files:** `src/js/app.js`, `src/style.css`

```
Read src/js/app.js first, specifically the section that updates the 
timer display number each second. Currently the number snaps instantly. 
I want the digit to do a subtle slide-down + fade transition when it 
changes — the outgoing number slides down and fades out while the 
incoming number slides in from above, over ~120ms. This should only 
apply to the seconds digits (and minutes when they roll over), not 
every requestAnimationFrame tick. Implement using CSS classes toggled 
by JS on the display element — don't change the underlying tick logic 
in timer.js.
```

---

## 10. Keyboard shortcuts (space, R, Escape)
**Effort:** Quick win — ~45 mins
**Files:** `src/js/app.js`

```
Read src/js/app.js first. Add a keydown event listener at the document 
level with these shortcuts:
- Space: start or pause the timer (same as clicking #btn-start or 
  #btn-pause depending on state) — only when no input/textarea is focused
- R: reset the timer (same as #btn-reset) — only when no modal is open 
  and no input is focused
- Escape: close any open modal (Goals add/edit modal, weekly review modal)
- M: toggle simple mode (same as the existing simple mode toggle)

Show a small keyboard shortcut hint in the Settings page under a 
"Keyboard shortcuts" section — a simple two-column list of key + action. 
No external library needed.
```

---

## 11. Settings page grouped into cards
**Effort:** Medium — ~2 hours
**Files:** `src/index.html`, `src/style.css`

```
Read src/index.html first, specifically the #view-settings section. 
Reorganize the settings into four distinct cards, each with a section 
heading:
- General — study/break duration, dark mode
- Timer & Focus Engine — watch window, threshold, lockInSecs, 
  distractSecs, wsPort
- Sound & Alarm — alarm sound picker, custom sound upload, ambient 
  sound (once built)
- Advanced — show focus score live, show camera feed

Each card should use the existing TrafficTrace card style (white bg, 
1px border, 12px radius). Add a subtle section label above each card 
in small caps muted text. Don't change any of the input IDs or the 
JS that reads them — purely a visual restructure of the HTML and CSS.
```

---

## 12. Focus score pill badge (color ramp)
**Effort:** Quick win — ~1 hour
**Files:** `src/js/app.js`, `src/style.css`

```
Read src/js/app.js first, specifically where the live focus score is 
displayed. Replace the raw number display with a pill badge that has 
a background color ramp based on score value:
- 0–39: #EF4444 (red) with white text
- 40–69: #F59E0B (amber) with white text  
- 70–89: #3B82F6 (blue) with white text
- 90–100: #10B981 (green) with white text

The pill should be ~60px wide, ~24px tall, border-radius 12px, 
font-weight 500. Transition the background-color smoothly over 300ms 
when the score changes bracket. Only show the pill when the focus 
engine is active (FOCUS_WATCHING or LOCKED_IN states) — hide it 
otherwise.
```

---

## 13. Locked In ring glow + display turns green
**Effort:** Quick win — ~1 hour
**Files:** `src/js/app.js`, `src/style.css`

```
Read src/js/app.js first, specifically the onStateChange callback and 
the ring animation code. When the state transitions to LOCKED_IN:
1. Add a CSS class to the ring SVG that gives it a green drop-shadow 
   glow: filter: drop-shadow(0 0 12px rgba(16, 185, 129, 0.6))
2. The timer display number color transitions to #10B981 (green) over 
   300ms
3. Add a subtle "LOCKED IN" label that fades in below the timer display

When leaving LOCKED_IN state (to LOCKED_IN_WARNING or BREAK), remove 
the glow and restore the default display color. For LOCKED_IN_WARNING, 
change the glow to amber (#F59E0B) instead. Use CSS transitions for 
all color changes — don't use JS to set colors directly.
```

---

## 14. Alarm transition — color shift on break start
**Effort:** Medium — ~1.5 hours
**Files:** `src/js/app.js`, `src/style.css`

```
Read src/js/app.js first, specifically the onStateChange callback for 
when state transitions to BREAK. When break starts, trigger a full-page 
color transition:
1. The page background briefly flashes to a soft green (#D1FAE5) then 
   transitions to the normal break state over 600ms
2. The ring track color shifts from the focus blue (#3B82F6) to break 
   green (#10B981) with a 400ms transition
3. A subtle "Break time" label fades in above the ring with opacity 
   transition over 300ms, then fades out after 2 seconds

All transitions should use CSS classes toggled by JS, not inline 
styles. Make sure dark mode works — in dark mode the flash color 
should be a darker green (#064E3B) instead of the light version.
```

---

## 15. Sidebar nav active state — left accent bar
**Effort:** Quick win — ~15 mins
**Files:** `src/style.css`

```
Read src/style.css first. Find the CSS rule that styles the active 
sidebar nav item (likely a class like .nav-item.active or 
[data-view].active or similar — check the file to confirm the exact 
selector). 

Make these changes to the active state:
1. Remove or reduce the solid background fill (#2D3035) — replace it 
   with rgba(59, 130, 246, 0.08) so it's a very subtle blue tint
2. Add border-left: 3px solid #3B82F6 to create the accent bar
3. Increase padding-left by 3px on the active item to compensate for 
   the border so the icon and text don't shift left visually
4. Add a transition: border-left 150ms ease, background 150ms ease 
   so the active state animates in when switching views

Inactive nav items must stay exactly as they are — only the active 
selector changes. Do not touch any HTML or JS files. After making the 
change, check if dark mode has a separate nav active override in the 
[data-theme="dark"] block — if it does, update that too so it stays 
consistent.
```

---

## Notes for Claude Code

### Session order — read this before starting
- **Start with 1–4 first.** They are all quick wins, completely independent of each other, and touch different files. You can knock all four out in a single session and the app will feel noticeably more polished immediately. Do them in order.
- **#5 Weekly review** — before building this, check that studysight_sessions in localStorage has at least a week of real data. If not, the feature will render empty and be impossible to test properly. Ask the user to confirm before starting.
- **#6 Menubar mini-mode** — this is the riskiest feature on the list. It requires a second Tauri window and tray click handling in Rust (lib.rs). Save this for a focused session with no other work happening. Don't attempt it at the end of a session.
- **#8 Ambient sounds** — brown noise can be generated procedurally via the Web Audio API (no file needed). Rain and Cafe require royalty-free audio loops. Before starting, ask the user if they have the audio files ready — suggest freesound.org if not. Don't start this feature without the audio files in place.
- **#15 Sidebar accent bar** — pure CSS, 15 minutes, do this any time as a warmup.

### Always
- Read CLAUDE.md at the start of every session
- Tick features off in both this file AND CLAUDE.md when done
- One file per response, keep going automatically until the feature is complete
- Update CLAUDE.md architecture sections whenever data models or file structure changes
