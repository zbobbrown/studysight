/**
 * timer.js
 * Core timer state machine + focus engine WebSocket integration.
 * No framework dependencies. Communicates with app.js via callbacks.
 */

const Timer = (function () {
  'use strict';

  // ── States ──────────────────────────────────────────────────────────────
  const STATE = {
    IDLE:              'idle',
    FOCUS:             'focus',             // counting down, engine off
    FOCUS_WATCHING:    'focus_watching',    // ≤watchWindow secs left, engine sampling
    LOCKED_IN:         'locked_in',         // timer paused, user is in the zone
    LOCKED_IN_WARNING: 'locked_in_warning', // was locked in, focus dropped, grace period
    BREAK:             'break',             // break counting down
  };

  // ── Config (overridden by Settings) ─────────────────────────────────────
  let cfg = {
    studyMinutes:   25,
    breakMinutes:   5,
    watchWindow:    60,   // seconds before end to activate engine
    threshold:      90,   // focus score to be considered "locked in"
    lockInSecs:     30,   // seconds at threshold to lock in
    distractSecs:   45,   // seconds below threshold before break triggers
    wsPort:         8765,
    focusDetectionEnabled: false,  // off until ML model is ready
  };

  // ── Runtime state ────────────────────────────────────────────────────────
  let state          = STATE.IDLE;
  let remainingSecs  = cfg.studyMinutes * 60;
  let totalSecs      = cfg.studyMinutes * 60;  // for ring calculation
  let tickInterval          = null;
  let tickStartTime         = null;  // wall-clock ms when current tick run started
  let remainingAtTickStart  = null;  // remainingSecs at that moment
  let focusScore     = null;

  // Focus tracking
  let lockedInSince     = null;  // timestamp when we crossed threshold continuously
  let distractedSince   = null;  // timestamp when we dropped below threshold

  // WebSocket
  let ws            = null;
  let wsConnected   = false;
  let wsReconnectTO = null;

  // ── Callbacks (set by app.js) ────────────────────────────────────────────
  let onTick         = null;  // (state, remainingSecs, totalSecs) => void
  let onStateChange  = null;  // (newState, oldState) => void
  let onScoreUpdate  = null;  // (score) => void
  let onBreakStart   = null;  // () => void
  let onEngineStatus = null;  // ('disconnected'|'connected'|'watching') => void
  let onCameraFrame  = null;  // (base64JpegString) => void

  // ── Helpers ──────────────────────────────────────────────────────────────

  function setState(newState) {
    const old = state;
    state = newState;
    if (onStateChange && old !== newState) onStateChange(newState, old);
  }

  function formatTime(secs) {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  function fireOnBreak() {
    if (onBreakStart) onBreakStart();
  }

  // ── Focus engine logic ────────────────────────────────────────────────────

  function processFocusScore(score) {
    focusScore = score;
    if (onScoreUpdate) onScoreUpdate(score);

    if (state === STATE.FOCUS_WATCHING) {
      const now = Date.now();
      if (score >= cfg.threshold) {
        // Reset distraction clock
        distractedSince = null;
        if (!lockedInSince) {
          lockedInSince = now;
        } else if ((now - lockedInSince) / 1000 >= cfg.lockInSecs) {
          // Lock in — pause the timer
          pauseForLockIn();
        }
      } else {
        // Below threshold
        lockedInSince = null;
        // No penalty in FOCUS_WATCHING — just watching
      }

    } else if (state === STATE.LOCKED_IN) {
      const now = Date.now();
      if (score >= cfg.threshold) {
        distractedSince = null;
      } else {
        if (!distractedSince) {
          distractedSince = now;
          setState(STATE.LOCKED_IN_WARNING);
        }
      }

    } else if (state === STATE.LOCKED_IN_WARNING) {
      const now = Date.now();
      if (score >= cfg.threshold) {
        // Recovered
        distractedSince = null;
        setState(STATE.LOCKED_IN);
      } else if (distractedSince && (now - distractedSince) / 1000 >= cfg.distractSecs) {
        // Grace period expired → trigger break
        triggerBreak();
      }
    }
  }

  function pauseForLockIn() {
    // Stop the tick interval — timer is frozen
    clearInterval(tickInterval);
    tickInterval = null;
    distractedSince = null;
    setState(STATE.LOCKED_IN);
    setEngineWatching(true);
  }

  function triggerBreak() {
    clearInterval(tickInterval);
    tickInterval = null;
    lockedInSince   = null;
    distractedSince = null;
    focusScore      = null;

    totalSecs     = cfg.breakMinutes * 60;
    remainingSecs = totalSecs;
    setState(STATE.BREAK);
    setEngineWatching(false);
    startTick();
    fireOnBreak();
  }

  function setEngineWatching(watching) {
    if (!wsConnected || !ws) return;
    ws.send(JSON.stringify({ cmd: watching ? 'start_watching' : 'stop_watching' }));
    if (onEngineStatus) onEngineStatus(watching ? 'watching' : 'connected');
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  function startTick() {
    clearInterval(tickInterval);
    tickStartTime        = Date.now();
    remainingAtTickStart = remainingSecs;
    tickInterval = setInterval(tick, 500); // 500ms so display catches up fast after throttle
  }

  function tick() {
    if (state === STATE.IDLE || state === STATE.LOCKED_IN || state === STATE.LOCKED_IN_WARNING) return;

    // Compute remaining from real elapsed time — immune to background throttling
    const elapsed = (Date.now() - tickStartTime) / 1000;
    remainingSecs = Math.max(0, remainingAtTickStart - elapsed);

    // Activate focus engine when within watchWindow (only if detection enabled)
    if (
      cfg.focusDetectionEnabled &&
      state === STATE.FOCUS &&
      remainingSecs <= cfg.watchWindow &&
      remainingSecs > 0
    ) {
      setState(STATE.FOCUS_WATCHING);
      setEngineWatching(true);
    }

    if (onTick) onTick(state, remainingSecs, totalSecs);

    if (remainingSecs <= 0) {
      handleTimerEnd();
    }
  }

  function handleTimerEnd() {
    clearInterval(tickInterval);
    tickInterval = null;

    if (state === STATE.FOCUS || state === STATE.FOCUS_WATCHING) {
      // Focus ended without locking in → normal break
      lockedInSince   = null;
      distractedSince = null;
      triggerBreak();
    } else if (state === STATE.BREAK) {
      // Break over → reset to focus
      resetToFocus();
    }
  }

  function resetToFocus() {
    setEngineWatching(false);
    focusScore    = null;
    totalSecs     = cfg.studyMinutes * 60;
    remainingSecs = totalSecs;
    setState(STATE.IDLE);
    if (onTick) onTick(STATE.IDLE, remainingSecs, totalSecs);
  }

  // ── WebSocket connection ─────────────────────────────────────────────────

  function connectWS() {
    if (ws) {
      try { ws.close(); } catch (_) {}
    }
    clearTimeout(wsReconnectTO);

    const url = `ws://127.0.0.1:${cfg.wsPort}`;
    try {
      ws = new WebSocket(url);
    } catch (_) {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      wsConnected = true;
      if (onEngineStatus) onEngineStatus('connected');
      // If timer is currently watching, tell the engine immediately
      if (state === STATE.FOCUS_WATCHING || state === STATE.LOCKED_IN || state === STATE.LOCKED_IN_WARNING) {
        setEngineWatching(true);
      }
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (typeof data.focus_score === 'number') {
          processFocusScore(data.focus_score);
        }
        if (data.camera_frame && onCameraFrame) {
          onCameraFrame(data.camera_frame);
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      wsConnected = false;
      ws = null;
      if (onEngineStatus) onEngineStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      wsConnected = false;
    };
  }

  function scheduleReconnect() {
    clearTimeout(wsReconnectTO);
    wsReconnectTO = setTimeout(connectWS, 3000);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  function start() {
    if (state !== STATE.IDLE) return;
    totalSecs     = cfg.studyMinutes * 60;
    remainingSecs = totalSecs;
    lockedInSince   = null;
    distractedSince = null;
    setState(STATE.FOCUS);
    startTick();
    if (onTick) onTick(state, remainingSecs, totalSecs);
  }

  function pause() {
    if (state !== STATE.FOCUS && state !== STATE.FOCUS_WATCHING && state !== STATE.BREAK) return;
    clearInterval(tickInterval);
    tickInterval = null;
    // Stay in current state but stopped — app.js handles "paused" UI flag
    return 'paused';
  }

  function resume() {
    if (state === STATE.IDLE) return;
    startTick();
  }

  function reset() {
    clearInterval(tickInterval);
    tickInterval    = null;
    lockedInSince   = null;
    distractedSince = null;
    focusScore      = null;
    setEngineWatching(false);
    totalSecs     = cfg.studyMinutes * 60;
    remainingSecs = totalSecs;
    setState(STATE.IDLE);
    if (onTick) onTick(STATE.IDLE, remainingSecs, totalSecs);
  }

  function updateConfig(newCfg) {
    const portChanged = newCfg.wsPort && newCfg.wsPort !== cfg.wsPort;
    Object.assign(cfg, newCfg);
    if (portChanged) connectWS();
    // If idle, update display totals
    if (state === STATE.IDLE) {
      totalSecs     = cfg.studyMinutes * 60;
      remainingSecs = totalSecs;
      if (onTick) onTick(STATE.IDLE, remainingSecs, totalSecs);
    }
  }

  function sendCommand(cmd) {
    if (wsConnected && ws) ws.send(JSON.stringify(cmd));
  }

  function getState()        { return state; }
  function getRemaining()    { return remainingSecs; }
  function getTotal()        { return totalSecs; }
  function getFocusScore()   { return focusScore; }
  function isWsConnected()   { return wsConnected; }
  function getDebugInfo() {
    return {
      state,
      focusScore,
      lockedInSecs:   lockedInSince   ? ((Date.now() - lockedInSince)   / 1000).toFixed(1) : null,
      distractSecs:   distractedSince ? ((Date.now() - distractedSince) / 1000).toFixed(1) : null,
    };
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init(callbacks, initialCfg) {
    if (callbacks.onTick)         onTick         = callbacks.onTick;
    if (callbacks.onStateChange)  onStateChange  = callbacks.onStateChange;
    if (callbacks.onScoreUpdate)  onScoreUpdate  = callbacks.onScoreUpdate;
    if (callbacks.onBreakStart)   onBreakStart   = callbacks.onBreakStart;
    if (callbacks.onEngineStatus) onEngineStatus = callbacks.onEngineStatus;
    if (callbacks.onCameraFrame)  onCameraFrame  = callbacks.onCameraFrame;

    if (initialCfg) Object.assign(cfg, initialCfg);

    totalSecs     = cfg.studyMinutes * 60;
    remainingSecs = totalSecs;

    connectWS();
    if (onTick) onTick(STATE.IDLE, remainingSecs, totalSecs);
  }

  return {
    STATE,
    init,
    start,
    pause,
    resume,
    reset,
    updateConfig,
    sendCommand,
    getState,
    getRemaining,
    getTotal,
    getFocusScore,
    isWsConnected,
    getDebugInfo,
    formatTime,
  };
})();
