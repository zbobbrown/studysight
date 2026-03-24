/**
 * app.js
 * Entry point. Handles view routing, settings persistence,
 * session recording, alarm playback, and UI ↔ Timer bridge.
 */

(function () {
  'use strict';

  // ── Settings storage key ──────────────────────────────────────────────
  const SETTINGS_KEY       = 'studysight_settings';
  const SESSIONS_KEY       = 'studysight_sessions';
  const GOALS_KEY          = 'studysight_goals';
  const WEEKLY_REVIEW_KEY  = 'studysight_last_review_week';

  // ── Default settings ──────────────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    studyMinutes:  25,
    breakMinutes:  5,
    watchWindow:   60,
    threshold:     90,
    lockInSecs:    30,
    distractSecs:  45,
    wsPort:        8765,
    alarmSound:    'chime',
    alarmVolume:   70,
    alarmFile:     null,   // base64 data URL of custom file
    notifEnabled:  true,
    focusWindow:   true,
    focusDetectionEnabled: false,
    showScore:     false,
    showCamera:    false,
    darkMode:      false,
    simpleMode:    false,
    ambientSound:  null,   // null | 'brown-noise' | 'rain' | 'cafe'
    ambientVolume: 30,
  };

  // ── State ─────────────────────────────────────────────────────────────
  let settings     = loadSettings();
  let isPaused        = false;
  let ringPauseStart  = null;  // performance.now() when pause was clicked
  let currentView  = 'timer';
  let currentTab   = 'general';

  // Session being recorded (populated when a focus session starts)
  let activeSession = null;

  // Alarm audio
  let alarmCtx          = null;
  let alarmInterval     = null;
  let customAudio       = null;
  let alarmPausedBreak  = false;  // true when alarm is holding the break timer

  // Ambient audio
  let ambientAudio = null;

  // ── DOM refs ──────────────────────────────────────────────────────────
  const el = {
    // Nav
    navBtns:      document.querySelectorAll('.nav-item'),
    views:        document.querySelectorAll('.view'),
    tabPanels:    document.querySelectorAll('.tab-panel'),
    // Timer
    modePill:     document.getElementById('mode-pill'),
    timerDisplay: document.getElementById('timer-display'),
    ringFill:     document.getElementById('ring-fill'),
    lockedBadge:  document.getElementById('locked-in-badge'),
    scorePill:     document.getElementById('score-pill'),
    scorePillText: document.getElementById('score-pill-text'),
    btnStart:     document.getElementById('btn-start'),
    btnPause:     document.getElementById('btn-pause'),
    btnReset:     document.getElementById('btn-reset'),
    alarmBanner:  document.getElementById('alarm-banner'),
    btnStopAlarm: document.getElementById('btn-stop-alarm'),
    sessionCount: document.getElementById('session-count'),
    engineStatus: document.getElementById('engine-status'),
    engineLabel:  document.querySelector('#engine-status .engine-label'),
    // Settings — general
    setStudyMin:  document.getElementById('set-study-min'),
    setBreakMin:  document.getElementById('set-break-min'),
    setWatchWin:  document.getElementById('set-watch-window'),
    // Settings — alarm
    setAlarmSound: document.getElementById('set-alarm-sound'),
    setAlarmFile:  document.getElementById('set-alarm-file'),
    setAlarmVol:   document.getElementById('set-alarm-volume'),
    volumeDisplay: document.getElementById('volume-display'),
    setAmbientSound:   document.getElementById('set-ambient-sound'),
    setAmbientVol:     document.getElementById('set-ambient-volume'),
    ambientVolDisplay: document.getElementById('ambient-volume-display'),
    setNotif:      document.getElementById('set-notif'),
    setFocusWin:   document.getElementById('set-focus-window'),
    btnTestAlarm:  document.getElementById('btn-test-alarm'),
    // Settings — advanced
    setDarkMode:     document.getElementById('set-dark-mode'),
    setShowScore:    document.getElementById('set-show-score'),
    focusScoreDisp:  document.getElementById('focus-score-display'),
    liveScore:       document.getElementById('live-score'),
    setShowCamera:   document.getElementById('set-show-camera'),
    cameraFeed:      document.getElementById('camera-feed'),
    setFocusDetection: document.getElementById('set-focus-detection'),
    setThreshold:    document.getElementById('set-threshold'),
    setLockInSecs:   document.getElementById('set-lockin-secs'),
    setDistractSecs: document.getElementById('set-distract-secs'),
    setWsPort:       document.getElementById('set-ws-port'),
    dbgStatus:       document.getElementById('dbg-status'),
    dbgScore:        document.getElementById('dbg-score'),
    dbgState:        document.getElementById('dbg-state'),
    dbgLockin:       document.getElementById('dbg-lockin'),
    dbgDistract:     document.getElementById('dbg-distract'),
    btnClearData:    document.getElementById('btn-clear-data'),
    btnSimpleMode:   document.getElementById('btn-simple-mode'),
    // Onboarding
    onboardingOverlay: document.getElementById('onboarding-overlay'),
    btnGetStarted:     document.getElementById('btn-get-started'),
    // Stats
    statToday:     document.getElementById('stat-today-focus'),
    statAvgScore:  document.getElementById('stat-avg-score'),
    statStreak:    document.getElementById('stat-streak'),
    statWeek:      document.getElementById('stat-sessions-week'),
    tabBtns:   document.querySelectorAll('.tab-btn'),
    // Session notes
    snOverlay:   document.getElementById('sn-overlay'),
    snDuration:  document.getElementById('sn-duration'),
    snStars:     document.getElementById('sn-stars'),
    snTextarea:  document.getElementById('sn-textarea'),
    snSave:      document.getElementById('sn-save'),
    snSkip:      document.getElementById('sn-skip'),
    // Weekly review
    wrOverlay:       document.getElementById('wr-overlay'),
    btnWeeklyReview: document.getElementById('btn-weekly-review'),
    wrDateRange:     document.getElementById('wr-date-range'),
    wrTotalFocus:    document.getElementById('wr-total-focus'),
    wrSessions:      document.getElementById('wr-sessions'),
    wrAvgSession:    document.getElementById('wr-avg-session'),
    wrGoals:         document.getElementById('wr-goals'),
    wrBestDay:       document.getElementById('wr-best-day'),
    wrChart:         document.getElementById('wr-chart'),
    btnWrStartWeek:  document.getElementById('wr-start-week'),
    btnWrClose:      document.getElementById('wr-close'),
  };

  // ── Settings persistence ──────────────────────────────────────────────

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (_) {}
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
  }

  function applySettingsToInputs() {
    el.setStudyMin.value  = settings.studyMinutes;
    el.setBreakMin.value  = settings.breakMinutes;
    el.setWatchWin.value  = settings.watchWindow;
    el.setAlarmSound.value = settings.alarmSound;
    el.setAlarmVol.value  = settings.alarmVolume;
    el.volumeDisplay.textContent = settings.alarmVolume + '%';
    el.setAmbientSound.value = settings.ambientSound || '';
    el.setAmbientVol.value   = settings.ambientVolume;
    el.ambientVolDisplay.textContent = settings.ambientVolume + '%';
    el.setNotif.checked    = settings.notifEnabled;
    el.setFocusWin.checked = settings.focusWindow;
    el.setShowScore.checked = settings.showScore;
    el.setShowCamera.checked = settings.showCamera;
    el.setFocusDetection.checked = settings.focusDetectionEnabled;
    el.setThreshold.value    = settings.threshold;
    el.setLockInSecs.value   = settings.lockInSecs;
    el.setDistractSecs.value = settings.distractSecs;
    el.setWsPort.value       = settings.wsPort;
    el.setDarkMode.checked = settings.darkMode;
    applyTheme(settings.darkMode);
    el.btnSimpleMode.checked = settings.simpleMode;
    applySimpleMode(settings.simpleMode);
    toggleScoreDisplay(settings.showScore);
    updateCameraState();
    toggleAlarmFileInput(settings.alarmSound === 'custom');
  }

  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  function applySimpleMode(on) {
    document.documentElement.classList.toggle('simple-mode', on);
  }

  function toggleScoreDisplay(show) {
    el.focusScoreDisp.classList.toggle('hidden', !show);
  }

  function toggleCameraFeed(show) {
    el.cameraFeed.classList.toggle('hidden', !show);
    if (show) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => { el.cameraFeed.srcObject = stream; })
        .catch(() => { el.cameraFeed.classList.add('hidden'); });
    } else {
      if (el.cameraFeed.srcObject) {
        el.cameraFeed.srcObject.getTracks().forEach(t => t.stop());
        el.cameraFeed.srcObject = null;
      }
    }
  }

  function updateCameraState() {
    const S = Timer.STATE;
    const inSession = [S.FOCUS, S.FOCUS_WATCHING, S.LOCKED_IN, S.LOCKED_IN_WARNING].includes(Timer.getState());
    toggleCameraFeed(settings.showCamera && inSession);
  }

  function toggleAlarmFileInput(show) {
    el.setAlarmFile.classList.toggle('hidden', !show);
  }

  function startAmbientSound() {
    stopAmbientSound();
    if (!settings.ambientSound) return;
    ambientAudio = new Audio(`sounds/${settings.ambientSound}.mp3`);
    ambientAudio.loop   = true;
    ambientAudio.volume = settings.ambientVolume / 100;
    ambientAudio.play().catch(() => {});
  }

  function stopAmbientSound() {
    if (ambientAudio) {
      ambientAudio.pause();
      ambientAudio.src = '';
      ambientAudio = null;
    }
  }

  // ── Session data ──────────────────────────────────────────────────────

  function loadSessions() {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function saveSessions(sessions) {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch (_) {}
  }

  function recordSessionStart() {
    activeSession = {
      startTs:    Date.now(),
      endTs:      null,
      durationSecs: 0,
      focusScores:  [],   // sampled scores during focus_watching / locked_in
      lockedInMs:   0,    // total ms spent locked in
      lockedInStart: null,
      distractions: [],   // [{time: timestamp}] logged by user tap
      notes:  null,       // string from session notes panel
      rating: null,       // number 1–5 from session notes panel
    };
  }

  function recordLockedInStart() {
    if (activeSession) activeSession.lockedInStart = Date.now();
  }

  function recordLockedInEnd() {
    if (activeSession && activeSession.lockedInStart) {
      activeSession.lockedInMs += Date.now() - activeSession.lockedInStart;
      activeSession.lockedInStart = null;
    }
  }

  function recordSessionEnd() {
    if (!activeSession) return;
    recordLockedInEnd();
    activeSession.endTs        = Date.now();
    activeSession.durationSecs = Math.round((activeSession.endTs - activeSession.startTs) / 1000);

    const sessions = loadSessions();
    sessions.push(activeSession);
    saveSessions(sessions);
    activeSession = null;

    Stats.refresh();
    updateSessionCountDisplay();
  }

  function todaySessionCount() {
    const today = new Date().toDateString();
    return loadSessions().filter(s => new Date(s.startTs).toDateString() === today).length;
  }

  function updateSessionCountDisplay() {
    el.sessionCount.textContent = String(todaySessionCount());
  }

  // ── Alarm ─────────────────────────────────────────────────────────────

  function stopAlarm() {
    if (alarmInterval) { clearInterval(alarmInterval); alarmInterval = null; }
    if (customAudio)   { customAudio.pause(); customAudio.currentTime = 0; }
    if (alarmCtx)      { try { alarmCtx.close(); } catch (_) {} alarmCtx = null; }
    if (alarmPausedBreak) {
      alarmPausedBreak = false;
      if (ringPauseStart !== null) {
        ringLastTickTime += performance.now() - ringPauseStart;
        ringPauseStart = null;
      }
      Timer.resume();
      startRingRAF();
    }
  }

  function playAlarm() {
    stopAlarm();
    const vol = settings.alarmVolume / 100;

    if (settings.alarmSound === 'custom' && settings.alarmFile) {
      customAudio = new Audio(settings.alarmFile);
      customAudio.volume = vol;
      customAudio.play().catch(() => {});
      return;
    }

    // Built-in synth alarms
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    alarmCtx = new Ctx();

    const playBeep = (freq, start, dur) => {
      const osc  = alarmCtx.createOscillator();
      const gain = alarmCtx.createGain();
      osc.connect(gain);
      gain.connect(alarmCtx.destination);
      osc.frequency.value = freq;
      gain.gain.value     = 0.3 * vol;
      osc.start(start);
      osc.stop(start + dur);
    };

    const patterns = {
      chime: (t) => {
        playBeep(880, t,       0.12);
        playBeep(880, t + 0.15, 0.12);
        playBeep(880, t + 0.3,  0.12);
        playBeep(660, t + 0.55, 0.25);
      },
      bell: (t) => {
        playBeep(1047, t,       0.1);
        playBeep(1319, t + 0.12, 0.1);
        playBeep(1568, t + 0.24, 0.3);
      },
      soft: (t) => {
        playBeep(528, t,       0.4);
        playBeep(660, t + 0.5, 0.4);
      },
    };

    const pattern = patterns[settings.alarmSound] || patterns.chime;
    const run = () => {
      pattern(alarmCtx.currentTime);
      alarmInterval = setInterval(() => pattern(alarmCtx.currentTime), 2500);
    };
    (alarmCtx.state === 'suspended' ? alarmCtx.resume() : Promise.resolve()).then(run);
  }

  function sendSystemNotification(title, body) {
    if (!settings.notifEnabled) return;
    if (!isTauri) return;
    window.__TAURI__.core.invoke('show_notification', { title, body })
      .catch(e => console.error('show_notification failed:', e));
  }

  function bringToFront() {
    if (!settings.focusWindow) return;
    if (!isTauri) return;
    window.__TAURI__.core.invoke('focus_window')
      .catch(e => console.error('focus_window failed:', e));
  }

  // ── Ring animation (requestAnimationFrame — smooth continuous motion) ──

  const CIRCUMFERENCE = 628; // 2π × 100

  let ringRAF          = null;
  let ringLastTickRemaining = null;
  let ringLastTickTime      = null;
  let ringTotal             = 0;
  let ringRunning           = false;

  function startRingRAF() {
    ringRunning = true;
    if (ringRAF) return; // already running
    function frame() {
      if (!ringRunning) { ringRAF = null; return; }
      if (ringLastTickTime !== null && ringLastTickRemaining !== null) {
        const elapsed = (performance.now() - ringLastTickTime) / 1000;
        const interpolated = Math.max(0, ringLastTickRemaining - elapsed);
        const offset = CIRCUMFERENCE * (1 - interpolated / ringTotal);
        el.ringFill.style.strokeDashoffset = offset;
      }
      ringRAF = requestAnimationFrame(frame);
    }
    ringRAF = requestAnimationFrame(frame);
  }

  function stopRingRAF() {
    ringRunning = false;
    ringRAF = null;
  }

  function setRingTick(remaining, total) {
    ringLastTickRemaining = remaining;
    ringLastTickTime      = performance.now();
    ringTotal             = total;
  }

  function setRingStatic(remaining, total) {
    stopRingRAF();
    const offset = total > 0 ? CIRCUMFERENCE * (1 - remaining / total) : 0;
    el.ringFill.style.strokeDashoffset = offset;
  }

  // ── Focus score pill ──────────────────────────────────────────────────

  const SCORE_PILL_CLASSES = ['score-pill--gray', 'score-pill--amber', 'score-pill--green', 'score-pill--blue'];

  function updateScorePill(score) {
    const S = Timer.STATE;
    const state = Timer.getState();
    const activeStates = [S.FOCUS, S.FOCUS_WATCHING, S.LOCKED_IN, S.LOCKED_IN_WARNING];
    if (!activeStates.includes(state)) {
      el.scorePill.classList.add('score-pill--hidden');
      return;
    }
    el.scorePill.classList.remove('score-pill--hidden', ...SCORE_PILL_CLASSES);
    if      (score < 50) el.scorePill.classList.add('score-pill--gray');
    else if (score < 76) el.scorePill.classList.add('score-pill--amber');
    else if (score < 90) el.scorePill.classList.add('score-pill--green');
    else                 el.scorePill.classList.add('score-pill--blue');
    el.scorePillText.textContent = `Focus ${score}%`;
  }

  // ── Timer callbacks ───────────────────────────────────────────────────

  function onTick(state, remaining, total) {
    el.timerDisplay.textContent = Timer.formatTime(remaining);
    setRingTick(remaining, total);
    updateDebugPanel();
    const modeLabel = (state === Timer.STATE.BREAK) ? 'Break' : 'Focus';
    syncTray(remaining, modeLabel);
  }

  function onStateChange(newState, oldState) {
    const S = Timer.STATE;

    // Mode pill + ring color
    const isBreak = newState === S.BREAK;
    el.modePill.textContent = isBreak ? 'Break' : 'Focus';
    el.modePill.className   = 'pill ' + (isBreak ? 'break' : 'focus');
    el.ringFill.classList.toggle('break-mode', isBreak);

    // Locked-in badge
    const isLockedIn = newState === S.LOCKED_IN || newState === S.LOCKED_IN_WARNING;
    el.lockedBadge.classList.toggle('hidden', !isLockedIn);

    // Button states
    const running = newState !== S.IDLE && !isPaused;
    el.btnStart.textContent = isPaused ? 'Resume' : 'Start';
    el.btnStart.disabled    = running;  // grayed while actively running
    el.btnPause.disabled    = !running;

    // Ring animation: run when timer is counting, freeze when paused/idle/locked-in
    if (running && newState !== S.LOCKED_IN && newState !== S.LOCKED_IN_WARNING) {
      startRingRAF();
    } else {
      stopRingRAF();
      if (newState === S.IDLE) {
        setRingStatic(Timer.getRemaining(), Timer.getTotal());
      }
    }

    // Session recording
    if (newState === S.FOCUS && oldState === S.IDLE) {
      recordSessionStart();
    }
    if (newState === S.LOCKED_IN) {
      recordLockedInStart();
    }
    if (oldState === S.LOCKED_IN || oldState === S.LOCKED_IN_WARNING) {
      if (newState !== S.LOCKED_IN && newState !== S.LOCKED_IN_WARNING) {
        recordLockedInEnd();
      }
    }
    if (newState === S.IDLE && oldState === S.BREAK) {
      recordSessionEnd();
      el.alarmBanner.classList.add('hidden');
      stopAlarm();
      setRingStatic(settings.studyMinutes * 60, settings.studyMinutes * 60);
    }

    // Camera: on during focus states only
    updateCameraState();

    // Hide score pill on IDLE or BREAK; it reappears when the engine sends a score
    if (newState === S.IDLE || newState === S.BREAK) {
      el.scorePill.classList.add('score-pill--hidden');
    }

    updateDebugPanel();
  }

  function onScoreUpdate(score) {
    if (settings.showScore) {
      el.liveScore.textContent = String(score);
    }
    // Record score for stats
    if (activeSession) {
      activeSession.focusScores.push(score);
    }
    updateScorePill(score);
    updateDebugPanel();
  }

  function onBreakStart() {
    stopAmbientSound();
    el.alarmBanner.classList.remove('hidden');
    playAlarm();
    sendSystemNotification('StudySight', 'Time for a break!');
    bringToFront();
    // Hold break timer until alarm is dismissed
    alarmPausedBreak = true;
    ringPauseStart = performance.now();
    stopRingRAF();
    Timer.pause();
    // Show session notes panel after a brief delay
    setTimeout(openSessionNotes, 350);
  }

  function onEngineStatus(status) {
    el.engineStatus.className = 'engine-status ' + status;
    const labels = {
      disconnected: 'Focus engine offline',
      connected:    'Focus engine ready',
      watching:     'Watching your focus…',
    };
    el.engineLabel.textContent = labels[status] || status;
    el.dbgStatus.textContent   = status;
  }

  // ── UI event handlers ─────────────────────────────────────────────────

  el.btnStart.addEventListener('click', () => {
    if (isPaused) {
      // Resume
      isPaused = false;
      el.btnStart.textContent = 'Start';
      el.btnStart.disabled    = true;
      el.btnPause.disabled    = false;
      if (ambientAudio) ambientAudio.play().catch(() => {});
      Timer.resume();
      if (ringPauseStart !== null) {
        ringLastTickTime += performance.now() - ringPauseStart;
        ringPauseStart = null;
      }
      startRingRAF();
    } else {
      // Fresh start
      startAmbientSound();
      Timer.start();
    }
  });

  el.btnPause.addEventListener('click', () => {
    isPaused = true;
    ringPauseStart = performance.now();
    el.btnStart.textContent = 'Resume';
    el.btnStart.disabled    = false;
    el.btnPause.disabled    = true;
    if (ambientAudio) ambientAudio.pause();
    stopRingRAF();
    Timer.pause();
  });

  el.btnStopAlarm.addEventListener('click', () => {
    stopAlarm();
    el.alarmBanner.classList.add('hidden');
  });

  el.btnReset.addEventListener('click', () => {
    isPaused = false;
    el.btnStart.textContent = 'Start';
    el.btnStart.disabled    = false;
    el.btnPause.disabled    = true;
    el.alarmBanner.classList.add('hidden');
    closeSessionNotes();
    stopAlarm();
    stopAmbientSound();
    Timer.reset();
    updateSessionCountDisplay();
    syncTray(settings.studyMinutes * 60, 'Idle');
  });

  // Stop alarm on any user interaction with the timer area
  document.getElementById('view-timer').addEventListener('click', () => stopAlarm(), { passive: true });

  // ── Settings handlers ─────────────────────────────────────────────────

  function onSettingChange() {
    settings.studyMinutes = clamp(Number(el.setStudyMin.value), 1, 120, 25);
    settings.breakMinutes = clamp(Number(el.setBreakMin.value), 1, 120, 5);
    settings.watchWindow  = clamp(Number(el.setWatchWin.value), 30, 300, 60);
    settings.alarmSound   = el.setAlarmSound.value;
    settings.alarmVolume  = clamp(Number(el.setAlarmVol.value), 0, 100, 70);
    settings.ambientSound  = el.setAmbientSound.value || null;
    settings.ambientVolume = clamp(Number(el.setAmbientVol.value), 0, 100, 30);
    settings.notifEnabled = el.setNotif.checked;
    settings.focusWindow  = el.setFocusWin.checked;
    settings.focusDetectionEnabled = el.setFocusDetection.checked;
    settings.showScore    = el.setShowScore.checked;
    settings.showCamera   = el.setShowCamera.checked;
    settings.darkMode     = el.setDarkMode.checked;
    applyTheme(settings.darkMode);
    settings.threshold    = clamp(Number(el.setThreshold.value), 50, 100, 90);
    settings.lockInSecs   = clamp(Number(el.setLockInSecs.value), 10, 60, 30);
    settings.distractSecs = clamp(Number(el.setDistractSecs.value), 10, 120, 45);
    settings.wsPort       = clamp(Number(el.setWsPort.value), 1024, 65535, 8765);

    el.volumeDisplay.textContent = settings.alarmVolume + '%';
    el.ambientVolDisplay.textContent = settings.ambientVolume + '%';
    if (ambientAudio) ambientAudio.volume = settings.ambientVolume / 100;
    toggleScoreDisplay(settings.showScore);
    updateCameraState();
    toggleAlarmFileInput(settings.alarmSound === 'custom');

    saveSettings();
    Timer.updateConfig({
      studyMinutes: settings.studyMinutes,
      breakMinutes: settings.breakMinutes,
      watchWindow:  settings.watchWindow,
      threshold:    settings.threshold,
      lockInSecs:   settings.lockInSecs,
      distractSecs: settings.distractSecs,
      wsPort:       settings.wsPort,
      focusDetectionEnabled: settings.focusDetectionEnabled,
    });
  }

  el.setStudyMin.addEventListener('change',  onSettingChange);
  el.setBreakMin.addEventListener('change',  onSettingChange);
  el.setWatchWin.addEventListener('change',  onSettingChange);
  el.setAlarmSound.addEventListener('change', onSettingChange);
  el.setAlarmVol.addEventListener('input',        onSettingChange);
  el.setAmbientSound.addEventListener('change', onSettingChange);
  el.setAmbientSound.addEventListener('change', () => {
    // Switch sound live if a focus session is active
    const S = Timer.STATE;
    const focusStates = [S.FOCUS, S.FOCUS_WATCHING, S.LOCKED_IN, S.LOCKED_IN_WARNING];
    if (!focusStates.includes(Timer.getState())) return;
    if (!isPaused) {
      startAmbientSound();
    } else {
      // Swap audio so the right sound plays when timer resumes
      stopAmbientSound();
      if (settings.ambientSound) {
        ambientAudio = new Audio(`sounds/${settings.ambientSound}.mp3`);
        ambientAudio.loop   = true;
        ambientAudio.volume = settings.ambientVolume / 100;
      }
    }
  });
  el.setAmbientVol.addEventListener('input', onSettingChange);
  el.setNotif.addEventListener('change',     onSettingChange);
  el.setFocusWin.addEventListener('change',  onSettingChange);
  el.setShowScore.addEventListener('change', onSettingChange);
  el.setShowCamera.addEventListener('change', onSettingChange);
  el.setDarkMode.addEventListener('change',   onSettingChange);
  el.btnSimpleMode.addEventListener('change', () => {
    settings.simpleMode = el.btnSimpleMode.checked;
    applySimpleMode(settings.simpleMode);
    saveSettings();
  });
  el.setThreshold.addEventListener('change', onSettingChange);
  el.setLockInSecs.addEventListener('change', onSettingChange);
  el.setDistractSecs.addEventListener('change', onSettingChange);
  el.setWsPort.addEventListener('change',    onSettingChange);

  el.setAlarmFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      settings.alarmFile = ev.target.result;
      saveSettings();
    };
    reader.readAsDataURL(file);
  });

  el.btnTestAlarm.addEventListener('click', () => {
    playAlarm();
    setTimeout(stopAlarm, 5000);
  });

  el.btnClearData.addEventListener('click', () => {
    if (confirm('Clear all session data? This cannot be undone.')) {
      localStorage.removeItem(SESSIONS_KEY);
      Stats.refresh();
      updateSessionCountDisplay();
    }
  });

  // ── View routing ───────────────────────────────────────────────────────

  el.navBtns.forEach(btn => {
    if (!btn.dataset.view) return;
    btn.addEventListener('click', () => {
      const target = btn.dataset.view;
      el.navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === target));
      el.views.forEach(v => {
        const isTarget = v.id === 'view-' + target;
        v.classList.toggle('active', isTarget);
        v.style.display = isTarget ? 'flex' : 'none';
      });
      currentView = target;
      if (target === 'stats')  Stats.refresh();
      if (target === 'goals') Goals.refresh();
    });
  });

  // ── Tab routing (settings) ─────────────────────────────────────────────

  el.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      el.tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === target));
      el.tabPanels.forEach(p => {
        p.classList.toggle('active',  p.id === 'tab-' + target);
        p.classList.toggle('hidden', p.id !== 'tab-' + target);
      });
      currentTab = target;
    });
  });

  // ── Debug panel ────────────────────────────────────────────────────────

  function updateDebugPanel() {
    const dbg = Timer.getDebugInfo();
    el.dbgState.textContent    = dbg.state;
    el.dbgScore.textContent    = dbg.focusScore !== null ? String(dbg.focusScore) : '—';
    el.dbgLockin.textContent   = dbg.lockedInSecs  !== null ? dbg.lockedInSecs + 's' : '—';
    el.dbgDistract.textContent = dbg.distractSecs  !== null ? dbg.distractSecs + 's' : '—';
  }

  // Refresh debug panel every 500ms when advanced tab is open
  setInterval(() => {
    if (currentView === 'settings' && currentTab === 'advanced') updateDebugPanel();
  }, 500);

  // ── Tauri integration ──────────────────────────────────────────────────

  const isTauri = typeof window.__TAURI__ !== 'undefined';

  // Update the menubar tray tooltip with current timer state
  function syncTray(remaining, mode) {
    if (!isTauri) return;
    const label = `StudySight • ${Timer.formatTime(remaining)} • ${mode}`;
    window.__TAURI__.core.invoke('update_tray_tooltip', { label }).catch(() => {});
  }


  // ── Session Notes ─────────────────────────────────────────────────────

  let snRating = 0;

  function updateStarDisplay(hoverRating) {
    const display = hoverRating || snRating;
    el.snStars.querySelectorAll('.sn-star').forEach((s, i) => {
      s.classList.toggle('sn-star--active', i < display);
    });
  }

  function openSessionNotes() {
    snRating = 0;
    el.snTextarea.value = '';
    updateStarDisplay(0);
    if (activeSession) {
      const mins = Math.max(1, Math.round((Date.now() - activeSession.startTs) / 60000));
      el.snDuration.textContent = mins + ' min session';
    } else {
      el.snDuration.textContent = '';
    }
    el.snOverlay.classList.remove('sn-overlay--hidden');
  }

  function closeSessionNotes() {
    el.snOverlay.classList.add('sn-overlay--hidden');
  }

  function initSessionNotes() {
    el.snStars.addEventListener('click', (e) => {
      const star = e.target.closest('.sn-star');
      if (!star) return;
      snRating = Number(star.dataset.value);
      updateStarDisplay(0);
    });
    el.snStars.addEventListener('mouseover', (e) => {
      const star = e.target.closest('.sn-star');
      if (star) updateStarDisplay(Number(star.dataset.value));
    });
    el.snStars.addEventListener('mouseleave', () => updateStarDisplay(0));

    el.snSave.addEventListener('click', () => {
      if (activeSession) {
        activeSession.notes  = el.snTextarea.value.trim() || null;
        activeSession.rating = snRating || null;
      }
      if (snRating > 0) {
        Timer.sendCommand({ cmd: 'end_session', rating: snRating });
      }
      closeSessionNotes();
    });
    el.snSkip.addEventListener('click', closeSessionNotes);
  }

  // ── Weekly Review ─────────────────────────────────────────────────────

  function getWeekKey(date) {
    // ISO 8601 week number: YYYY-WNN
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  function getLastWeekDays() {
    // Returns 7 Date objects for Mon–Sun of the previous week
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon...
    const daysBack = (day === 0 ? 6 : day - 1) + 7; // back to last Monday
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() - daysBack + i);
      d.setHours(0, 0, 0, 0);
      days.push(d);
    }
    return days;
  }

  function computeWeeklyReview() {
    const sessions = loadSessions();
    const days = getLastWeekDays();
    const startMs = days[0].getTime();
    const endMs   = days[6].getTime() + 86400000 - 1;

    const weekSessions = sessions.filter(s => s.startTs >= startMs && s.startTs <= endMs);
    const totalSecs = weekSessions.reduce((sum, s) => sum + (s.durationSecs || 0), 0);
    const avgSecs   = weekSessions.length ? Math.round(totalSecs / weekSessions.length) : 0;

    // Focus time per day (Mon–Sun), in seconds
    const focusByDay = days.map(d => {
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      return weekSessions
        .filter(s => { const sd = new Date(s.startTs); return `${sd.getFullYear()}-${sd.getMonth()}-${sd.getDate()}` === key; })
        .reduce((sum, s) => sum + (s.durationSecs || 0), 0);
    });

    const maxFocus  = Math.max(...focusByDay, 1);
    const bestDayIdx = focusByDay.indexOf(Math.max(...focusByDay));
    const bestDayName = focusByDay[bestDayIdx] > 0
      ? days[bestDayIdx].toLocaleDateString('en-US', { weekday: 'long' })
      : null;

    // Goals completed last week
    let goalsCompleted = 0;
    try {
      const goals = JSON.parse(localStorage.getItem(GOALS_KEY) || '[]');
      goals.forEach(goal => {
        days.forEach(d => {
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          if (goal.completions && goal.completions[key]) goalsCompleted++;
        });
      });
    } catch (_) {}

    const fmt = { month: 'short', day: 'numeric' };
    const rangeLabel = `${days[0].toLocaleDateString('en-US', fmt)} – ${days[6].toLocaleDateString('en-US', fmt)}`;

    return { rangeLabel, totalSecs, sessions: weekSessions.length, avgSecs, bestDayName, goalsCompleted, focusByDay, days };
  }

  function formatWRDuration(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function drawWRChart(data) {
    const canvas = el.wrChart;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top: 12, right: 8, bottom: 24, left: 8 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = 7;
    const barW = Math.floor(innerW / n * 0.55);
    const gap  = Math.floor(innerW / n);
    const maxVal = Math.max(...data.focusByDay, 1);
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    ctx.clearRect(0, 0, W, H);

    data.focusByDay.forEach((val, i) => {
      const barH = Math.max(2, (val / maxVal) * innerH);
      const x = PAD.left + i * gap + Math.floor((gap - barW) / 2);
      const y = PAD.top + innerH - barH;

      ctx.fillStyle = val > 0 ? '#3B82F6' : (isDark ? '#2A2D34' : '#E5E7EB');
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 3);
      ctx.fill();

      ctx.fillStyle = '#9CA3AF';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(data.days[i].toLocaleDateString('en-US', { weekday: 'short' }), x + barW / 2, PAD.top + innerH + 16);
    });
  }

  function renderWeeklyReview(data) {
    el.wrDateRange.textContent  = data.rangeLabel;
    el.wrTotalFocus.textContent = data.totalSecs > 0 ? formatWRDuration(data.totalSecs) : '0m';
    el.wrSessions.textContent   = String(data.sessions);
    el.wrAvgSession.textContent = data.avgSecs > 0 ? formatWRDuration(data.avgSecs) : '—';
    el.wrGoals.textContent      = String(data.goalsCompleted);
    el.wrBestDay.textContent    = data.bestDayName || '—';
    drawWRChart(data);
  }

  function openWeeklyReview() {
    renderWeeklyReview(computeWeeklyReview());
    el.wrOverlay.classList.remove('wr-overlay--hidden');
  }

  function dismissWeeklyReview() {
    localStorage.setItem(WEEKLY_REVIEW_KEY, getWeekKey(new Date()));
    el.wrOverlay.classList.add('wr-overlay--hidden');
  }

  function initWeeklyReview() {
    el.btnWeeklyReview.addEventListener('click', openWeeklyReview);
    el.btnWrStartWeek.addEventListener('click', dismissWeeklyReview);
    el.btnWrClose.addEventListener('click', () => el.wrOverlay.classList.add('wr-overlay--hidden'));

    // Auto-show on Monday (first launch of the week)
    const now = new Date();
    if (now.getDay() === 1) {
      const thisWeekKey = getWeekKey(now);
      if (localStorage.getItem(WEEKLY_REVIEW_KEY) !== thisWeekKey) {
        setTimeout(openWeeklyReview, 700);
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  function clamp(n, min, max, def) {
    if (!Number.isFinite(n) || n < min) return def;
    if (n > max) return max;
    return Math.floor(n);
  }

  // ── Onboarding ─────────────────────────────────────────────────────────

  function initOnboarding() {
    const isFirstLaunch = localStorage.getItem(SETTINGS_KEY) === null;
    if (!isFirstLaunch) return;
    el.onboardingOverlay.classList.remove('onboarding--hidden');
    el.btnGetStarted.addEventListener('click', () => {
      saveSettings();
      el.onboardingOverlay.classList.add('onboarding--hidden');
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────

  Goals.init();
  initOnboarding();
  initSessionNotes();
  initWeeklyReview();
  applySettingsToInputs();
  updateSessionCountDisplay();
  setRingStatic(settings.studyMinutes * 60, settings.studyMinutes * 60);

  Timer.init(
    {
      onTick,
      onStateChange,
      onScoreUpdate,
      onBreakStart,
      onEngineStatus,
    },
    {
      studyMinutes: settings.studyMinutes,
      breakMinutes: settings.breakMinutes,
      watchWindow:  settings.watchWindow,
      threshold:    settings.threshold,
      lockInSecs:   settings.lockInSecs,
      distractSecs: settings.distractSecs,
      wsPort:       settings.wsPort,
      focusDetectionEnabled: settings.focusDetectionEnabled,
    }
  );

  // Register StudySight with macOS Notification Center on launch so permission
  // is granted before the first alarm fires.
  if (isTauri && settings.notifEnabled) {
    window.__TAURI__.core.invoke('show_notification', {
      title: 'StudySight',
      body: 'Notifications are enabled.',
    }).catch(() => {});
  }

})();
