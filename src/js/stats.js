/**
 * stats.js
 * Reads session data from localStorage and renders stat cards + charts.
 * Pure canvas-based charts, no external dependencies.
 */

const Stats = (function () {
  'use strict';

  const SESSIONS_KEY = 'studysight_sessions';

  // ── Data helpers ──────────────────────────────────────────────────────

  function loadSessions() {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function dateKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function last7DayKeys() {
    const keys = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      keys.push(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return keys;
  }

  function dayLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m, d);
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  }

  function avgFocusScore(session) {
    if (!session.focusScores || session.focusScores.length === 0) return null;
    const sum = session.focusScores.reduce((a, b) => a + b, 0);
    return Math.round(sum / session.focusScores.length);
  }

  // ── Stat cards ────────────────────────────────────────────────────────

  function computeStats(sessions) {
    const today    = dateKey(Date.now());
    const last7    = new Set(last7DayKeys());
    const nowMs    = Date.now();
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    // Today focus time (seconds in focus sessions that started today)
    let todayFocusSecs = 0;
    sessions.forEach(s => {
      if (dateKey(s.startTs) === today) todayFocusSecs += s.durationSecs || 0;
    });

    // Avg focus score (last 7 days)
    const last7Sessions = sessions.filter(s => (nowMs - s.startTs) < oneWeekMs);
    const scores = last7Sessions.map(avgFocusScore).filter(x => x !== null);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    // Longest locked-in streak (single session with most lockedInMs)
    let longestLockedMs = 0;
    sessions.forEach(s => { if ((s.lockedInMs || 0) > longestLockedMs) longestLockedMs = s.lockedInMs; });

    // Sessions this week
    const weekSessions = sessions.filter(s => (nowMs - s.startTs) < oneWeekMs).length;

    return { todayFocusSecs, avgScore, longestLockedMs, weekSessions };
  }

  function formatDuration(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function formatLockedIn(ms) {
    const secs = Math.round(ms / 1000);
    if (secs < 60) return secs + 's';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  function renderCards(stats) {
    document.getElementById('stat-today-focus').textContent =
      stats.todayFocusSecs > 0 ? formatDuration(stats.todayFocusSecs) : '0m';
    document.getElementById('stat-avg-score').textContent =
      stats.avgScore !== null ? stats.avgScore : '—';
    document.getElementById('stat-streak').textContent =
      stats.longestLockedMs > 0 ? formatLockedIn(stats.longestLockedMs) : '0s';
    document.getElementById('stat-sessions-week').textContent =
      String(stats.weekSessions);
  }

  // ── Chart helpers ─────────────────────────────────────────────────────

  const COLORS = {
    accent:  '#3B82F6',
    green:   '#10B981',
    dim:     '#E5E7EB',
    text:    '#9CA3AF',
    surface: '#ffffff',
  };

  function clearCanvas(ctx, canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawBarChart(canvasId, labels, values, color, yMax) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const W      = canvas.width;
    const H      = canvas.height;
    const PAD    = { top: 16, right: 8, bottom: 28, left: 32 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top  - PAD.bottom;
    const n      = labels.length;
    const barW   = Math.floor(innerW / n * 0.55);
    const gap    = Math.floor(innerW / n);
    const max    = yMax || Math.max(...values, 1);

    clearCanvas(ctx, canvas);

    // Gridlines
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth   = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + innerH - (i / 4) * innerH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + innerW, y);
      ctx.stroke();

      // Y label
      ctx.fillStyle  = COLORS.text;
      ctx.font       = '10px -apple-system, sans-serif';
      ctx.textAlign  = 'right';
      ctx.fillText(Math.round((i / 4) * max), PAD.left - 4, y + 4);
    }

    // Bars
    values.forEach((val, i) => {
      const barH  = Math.max(2, (val / max) * innerH);
      const x     = PAD.left + i * gap + Math.floor((gap - barW) / 2);
      const y     = PAD.top + innerH - barH;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, 3);
      ctx.fill();

      // X label
      ctx.fillStyle = COLORS.text;
      ctx.font      = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x + barW / 2, PAD.top + innerH + 16);
    });
  }

  function drawLineChart(canvasId, labels, values, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx    = canvas.getContext('2d');
    const W      = canvas.width;
    const H      = canvas.height;
    const PAD    = { top: 16, right: 8, bottom: 28, left: 32 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top  - PAD.bottom;
    const n      = values.length;
    const max    = 100; // focus score always 0–100
    const validValues = values.filter(v => v !== null);

    clearCanvas(ctx, canvas);

    // Gridlines + Y labels
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth   = 0.5;
    [0, 25, 50, 75, 100].forEach(tick => {
      const y = PAD.top + innerH - (tick / max) * innerH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + innerW, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.font      = '10px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(tick, PAD.left - 4, y + 4);
    });

    // No data message
    if (validValues.length === 0) {
      ctx.fillStyle = COLORS.text;
      ctx.font      = '12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data yet', PAD.left + innerW / 2, PAD.top + innerH / 2);
      return;
    }

    // Line + fill
    const pts = values.map((v, i) => ({
      x: PAD.left + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2),
      y: v !== null ? PAD.top + innerH - (v / max) * innerH : null,
    }));

    // Fill under line
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + innerH);
    grad.addColorStop(0, color + '33');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    let started = false;
    pts.forEach((p, i) => {
      if (p.y === null) return;
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    });
    // Close down to baseline
    const lastPt = [...pts].reverse().find(p => p.y !== null);
    const firstPt = pts.find(p => p.y !== null);
    if (lastPt && firstPt) {
      ctx.lineTo(lastPt.x,  PAD.top + innerH);
      ctx.lineTo(firstPt.x, PAD.top + innerH);
      ctx.closePath();
      ctx.fill();
    }

    // Line
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    started = false;
    pts.forEach(p => {
      if (p.y === null) { started = false; return; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Dots
    pts.forEach(p => {
      if (p.y === null) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });

    // X labels
    values.forEach((_, i) => {
      const x = PAD.left + (n > 1 ? (i / (n - 1)) * innerW : innerW / 2);
      ctx.fillStyle = COLORS.text;
      ctx.font      = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], x, PAD.top + innerH + 16);
    });
  }

  // ── Render ────────────────────────────────────────────────────────────

  function refresh() {
    const sessions = loadSessions();
    const stats    = computeStats(sessions);
    renderCards(stats);

    const keys    = last7DayKeys();
    const labels  = keys.map(dayLabel);

    // Sessions per day
    const sessionsByDay = keys.map(k =>
      sessions.filter(s => dateKey(s.startTs) === k).length
    );
    drawBarChart('sessions-chart', labels, sessionsByDay, COLORS.accent,
      Math.max(...sessionsByDay, 4));

    // Avg focus score per day
    const scoresByDay = keys.map(k => {
      const daySessions = sessions.filter(s => dateKey(s.startTs) === k);
      const dayScores   = daySessions.map(avgFocusScore).filter(x => x !== null);
      return dayScores.length
        ? Math.round(dayScores.reduce((a, b) => a + b, 0) / dayScores.length)
        : null;
    });
    drawLineChart('score-chart', labels, scoresByDay, COLORS.green);
  }

  return { refresh };
})();
