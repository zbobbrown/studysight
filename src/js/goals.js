/**
 * goals.js — data layer, card rendering, add-goal modal
 */

const Goals = (function () {
  'use strict';

  const GOALS_KEY = 'studysight_goals';

  // ── Data ──────────────────────────────────────────────────────────────

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function loadGoals() {
    try {
      const raw = localStorage.getItem(GOALS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function saveGoals(goals) {
    try { localStorage.setItem(GOALS_KEY, JSON.stringify(goals)); } catch (_) {}
  }

  // ── Render ─────────────────────────────────────────────────────────────

  function renderGoals() {
    const goals = loadGoals();
    const list  = document.getElementById('g-goal-list');
    if (!list) return;

    list.innerHTML = '';

    if (goals.length === 0) {
      list.innerHTML = `
        <div class="g-empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="6"/>
            <circle cx="12" cy="12" r="2"/>
          </svg>
          <p>No goals yet</p>
          <span>Click <strong>+ Add goal</strong> to get started</span>
        </div>`;
      return;
    }

    const today = todayKey();

    // Group goals by timeOfDay
    const grouped = {};
    TIME_GROUPS.forEach(k => { grouped[String(k)] = []; });
    goals.forEach(g => {
      const key = String(g.timeOfDay || null);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(g);
    });

    const nonEmptyGroups = TIME_GROUPS.filter(k => grouped[String(k)].length > 0);
    const hasMultipleGroups = nonEmptyGroups.length > 1;

    TIME_GROUPS.forEach(groupKey => {
      const groupGoals = grouped[String(groupKey)];
      if (groupGoals.length === 0) return;

      if (hasMultipleGroups) {
        const header = document.createElement('div');
        header.className = 'g-group-header';
        header.textContent = TIME_LABELS[groupKey];
        list.appendChild(header);
      }

      groupGoals.forEach(goal => {
        renderGoalCard(list, goal, today);
      });
    });
  }

  function getDueUrgency(dueDate) {
    if (!dueDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due  = new Date(dueDate + 'T00:00:00');
    const days = Math.floor((due - today) / 86400000);
    if (days <= 0) return 'overdue';
    if (days <= 3) return 'due-soon';
    return null;
  }

  function renderGoalCard(list, goal, today) {
      const checkedToday  = !!(goal.completions && goal.completions[today]);
      const isCancelled   = goal.status === 'cancelled';
      const scheduledToday = !isCancelled && isScheduledToday(goal);
      const urgency       = isCancelled ? null : getDueUrgency(goal.dueDate);

      const card = document.createElement('div');
      card.className = 'g-card g-goal-card' + (isCancelled ? ' g-goal-card--cancelled' : '');
      if (urgency) card.classList.add('g-goal-card--' + urgency);
      card.dataset.id = goal.id;

      const typeLabel   = goal.type || 'Goal';
      const dateStr     = goal.dueDate ? `Due ${goal.dueDate}` : '';
      const streak      = computeStreak(goal);
      const progress    = isCancelled ? null : computeProgress(goal);
      const urgencyBadge = urgency === 'overdue'
        ? '<span class="g-due-badge g-due-badge--overdue">Overdue</span>'
        : urgency === 'due-soon'
        ? '<span class="g-due-badge g-due-badge--soon">Due soon</span>'
        : '';

      card.innerHTML = `
        <div class="g-goal-check-col">
          ${scheduledToday
            ? `<button class="g-checkbox${checkedToday ? ' g-checkbox--checked' : ''}" data-action="check" aria-label="Mark done today">
                <svg class="g-check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
               </button>`
            : `<div class="g-checkbox g-checkbox--rest" title="Not scheduled today"></div>`
          }
        </div>
        <div class="g-goal-body">
          <div class="g-goal-header-row">
            <span class="g-goal-type-pill">${typeLabel}</span>
            ${streak > 1 ? `<span class="g-streak-badge">${streak}</span>` : ''}
            ${dateStr ? `<span class="g-goal-date">${dateStr}</span>` : ''}
            ${urgencyBadge}
            <button class="g-dots-btn" data-action="menu" aria-label="Options">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5"  cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
              </svg>
            </button>
          </div>
          <h3 class="g-goal-title${checkedToday ? ' g-goal-title--done' : ''}">${escHtml(goal.title)}</h3>
          ${progress && progress.total > 0 ? `
          <div class="g-progress-row">
            <div class="g-progress-bar-bg">
              <div class="g-progress-bar-fill" style="width:${Math.round(progress.done / progress.total * 100)}%"></div>
            </div>
            <span class="g-progress-label">${progress.done} / ${progress.total} days</span>
          </div>` : ''}
          ${goal.notes ? `<p class="g-goal-notes">${escHtml(goal.notes)}</p>` : ''}
          ${isCancelled ? '<span class="g-status-pill g-status-pill--cancelled">Cancelled</span>' : ''}
        </div>`;

      list.appendChild(card);
  }

  function isScheduledOnDay(goal, date) {
    const dow  = date.getDay();
    const freq = goal.frequency || 'daily';
    if (freq === 'weekdays') return dow >= 1 && dow <= 5;
    if (freq === 'custom')   return Array.isArray(goal.days) && goal.days.includes(dow);
    return true; // 'daily'
  }

  function isScheduledToday(goal) {
    return isScheduledOnDay(goal, new Date());
  }

  function computeProgress(goal) {
    const start = new Date(goal.createdAt);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let total = 0, done = 0;
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      if (!isScheduledOnDay(goal, d)) continue;
      total++;
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (goal.completions && goal.completions[key]) done++;
    }
    return { done, total };
  }

  function computeStreak(goal) {
    if (!goal.completions) return 0;
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      if (!isScheduledOnDay(goal, d)) continue; // non-scheduled day — skip, don't break
      const key  = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const done = !!(goal.completions[key]);
      if (i === 0 && !done) continue; // today not done yet — don't break streak
      if (!done) break;               // missed a scheduled day — streak over
      streak++;
    }
    return streak;
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Add Goal modal ─────────────────────────────────────────────────────

  const GOAL_TYPES = [
    { id: 'study',    label: 'Study',    icon: '📚' },
    { id: 'exercise', label: 'Exercise', icon: '🏃' },
    { id: 'reading',  label: 'Reading',  icon: '📖' },
    { id: 'habit',    label: 'Habit',    icon: '🔁' },
    { id: 'project',  label: 'Project',  icon: '🎯' },
    { id: 'other',    label: 'Other',    icon: '✦'  },
  ];

  let modalStep        = 1;   // 1 = pick type, 2 = fill details
  let pendingType      = null;
  let editingId        = null; // null = new goal, string = editing existing
  let pendingFrequency = 'daily';
  let pendingDays      = [0, 1, 2, 3, 4, 5, 6];
  let pendingTimeOfDay = null;

  const DAY_LABELS     = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const TIME_GROUPS    = ['morning', 'afternoon', 'evening', null]; // null = Anytime
  const TIME_LABELS    = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', null: 'Anytime' };

  function openModal(goalId) {
    editingId  = goalId || null;
    modalStep  = editingId ? 2 : 1;
    pendingType = null;

    const overlay = document.getElementById('g-modal-overlay');
    if (!overlay) return;

    if (editingId) {
      const goal = loadGoals().find(g => g.id === editingId);
      if (!goal) return;
      pendingType      = goal.type;
      pendingFrequency = goal.frequency || 'daily';
      pendingDays      = Array.isArray(goal.days) && goal.days.length ? [...goal.days] : [0,1,2,3,4,5,6];
      pendingTimeOfDay = goal.timeOfDay || null;
      renderModalStep2(goal);
    } else {
      pendingFrequency = 'daily';
      pendingDays      = [0, 1, 2, 3, 4, 5, 6];
      pendingTimeOfDay = null;
      renderModalStep1();
    }

    overlay.classList.remove('g-modal--hidden');
  }

  function closeModal() {
    const overlay = document.getElementById('g-modal-overlay');
    if (overlay) overlay.classList.add('g-modal--hidden');
    editingId = null;
    pendingType = null;
  }

  function renderModalStep1() {
    const body = document.getElementById('g-modal-body');
    if (!body) return;

    body.innerHTML = `
      <h2 class="g-modal-title">What kind of goal?</h2>
      <div class="g-type-grid">
        ${GOAL_TYPES.map(t => `
          <button class="g-type-btn" data-type="${t.id}">
            <span class="g-type-icon">${t.icon}</span>
            <span>${t.label}</span>
          </button>`).join('')}
      </div>
      <div class="g-modal-footer">
        <button class="btn btn-ghost btn-sm" data-action="close-modal">Cancel</button>
      </div>`;

    body.querySelectorAll('.g-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        pendingType = btn.dataset.type;
        modalStep = 2;
        renderModalStep2(null);
      });
    });
    body.querySelector('[data-action="close-modal"]').addEventListener('click', closeModal);
  }

  function renderModalStep2(existing) {
    const body = document.getElementById('g-modal-body');
    if (!body) return;

    const typeObj = GOAL_TYPES.find(t => t.id === pendingType) || GOAL_TYPES[5];
    const title   = existing ? escHtml(existing.title)   : '';
    const notes   = existing ? escHtml(existing.notes)   : '';
    const due     = existing ? (existing.dueDate || '')  : '';

    body.innerHTML = `
      <button class="g-modal-back" data-action="back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        ${typeObj.icon} ${typeObj.label}
      </button>
      <h2 class="g-modal-title">${existing ? 'Edit goal' : 'New goal'}</h2>
      <div class="g-modal-fields">
        <div class="g-field">
          <label class="g-field-label">Goal <span class="g-required">*</span></label>
          <input id="g-input-title" class="g-input" type="text" placeholder="What do you want to achieve?" maxlength="120" value="${title}" />
        </div>
        <div class="g-field">
          <label class="g-field-label">Notes <span class="g-optional">(optional)</span></label>
          <textarea id="g-input-notes" class="g-input g-textarea" placeholder="Any extra detail, reminders, or context…" maxlength="400" rows="3">${notes}</textarea>
        </div>
        <div class="g-field">
          <label class="g-field-label">Due date <span class="g-optional">(optional)</span></label>
          <input id="g-input-due" class="g-input" type="date" value="${due}" />
        </div>
        <div class="g-field">
          <label class="g-field-label">Time of day</label>
          <div class="g-freq-row">
            ${[null, 'morning', 'afternoon', 'evening'].map(t => `
              <button type="button" class="g-freq-btn${pendingTimeOfDay === t ? ' g-freq-btn--active' : ''}" data-tod="${t}">${TIME_LABELS[t]}</button>
            `).join('')}
          </div>
        </div>
        <div class="g-field">
          <label class="g-field-label">Repeat</label>
          <div class="g-freq-row" id="g-freq-row">
            <button type="button" class="g-freq-btn${pendingFrequency === 'daily'    ? ' g-freq-btn--active' : ''}" data-freq="daily">Daily</button>
            <button type="button" class="g-freq-btn${pendingFrequency === 'weekdays' ? ' g-freq-btn--active' : ''}" data-freq="weekdays">Weekdays</button>
            <button type="button" class="g-freq-btn${pendingFrequency === 'custom'   ? ' g-freq-btn--active' : ''}" data-freq="custom">Custom</button>
          </div>
          <div id="g-day-row" class="g-day-row${pendingFrequency !== 'custom' ? ' g-day-row--hidden' : ''}">
            ${DAY_LABELS.map((lbl, i) => `<button type="button" class="g-day-btn${pendingDays.includes(i) ? ' g-day-btn--active' : ''}" data-day="${i}">${lbl}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="g-modal-footer">
        <button class="btn btn-ghost btn-sm" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary btn-sm" id="g-btn-save">Save goal</button>
      </div>`;

    const titleInput = body.querySelector('#g-input-title');
    titleInput.focus();

    if (!existing) {
      body.querySelector('[data-action="back"]').addEventListener('click', () => {
        modalStep = 1;
        renderModalStep1();
      });
    } else {
      body.querySelector('[data-action="back"]').style.display = 'none';
    }

    body.querySelectorAll('[data-tod]').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.tod === 'null' ? null : btn.dataset.tod;
        pendingTimeOfDay = val;
        body.querySelectorAll('[data-tod]').forEach(b => b.classList.toggle('g-freq-btn--active', (b.dataset.tod === 'null' ? null : b.dataset.tod) === pendingTimeOfDay));
      });
    });

    body.querySelectorAll('.g-freq-btn').forEach(btn => {
      if (btn.dataset.tod !== undefined) return; // skip tod buttons
      btn.addEventListener('click', () => {
        pendingFrequency = btn.dataset.freq;
        body.querySelectorAll('[data-freq]').forEach(b => b.classList.toggle('g-freq-btn--active', b.dataset.freq === pendingFrequency));
        document.getElementById('g-day-row').classList.toggle('g-day-row--hidden', pendingFrequency !== 'custom');
      });
    });

    body.querySelectorAll('.g-day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = Number(btn.dataset.day);
        const idx = pendingDays.indexOf(day);
        if (idx === -1) pendingDays.push(day);
        else pendingDays.splice(idx, 1);
        btn.classList.toggle('g-day-btn--active', pendingDays.includes(day));
      });
    });

    body.querySelector('[data-action="close-modal"]').addEventListener('click', closeModal);
    body.querySelector('#g-btn-save').addEventListener('click', saveGoalFromModal);
  }

  function saveGoalFromModal() {
    const titleVal = document.getElementById('g-input-title').value.trim();
    if (!titleVal) {
      document.getElementById('g-input-title').focus();
      return;
    }
    const notesVal = document.getElementById('g-input-notes').value.trim();
    const dueVal   = document.getElementById('g-input-due').value;
    const freqVal  = pendingFrequency;
    const daysVal  = freqVal === 'custom' ? [...pendingDays].sort((a, b) => a - b) : [];
    const todVal   = pendingTimeOfDay;

    const goals = loadGoals();

    if (editingId) {
      const idx = goals.findIndex(g => g.id === editingId);
      if (idx !== -1) {
        goals[idx].title     = titleVal;
        goals[idx].notes     = notesVal;
        goals[idx].dueDate   = dueVal || null;
        goals[idx].type      = pendingType || goals[idx].type;
        goals[idx].frequency  = freqVal;
        goals[idx].days       = daysVal;
        goals[idx].timeOfDay  = todVal;
      }
    } else {
      goals.push({
        id:          String(Date.now()),
        type:        pendingType || 'other',
        title:       titleVal,
        notes:       notesVal,
        dueDate:     dueVal || null,
        status:      'active',
        createdAt:   Date.now(),
        completions: {},
        frequency:   freqVal,
        days:        daysVal,
        timeOfDay:   todVal,
      });
    }

    saveGoals(goals);
    closeModal();
    renderGoals();
  }

  // ── Confetti burst ─────────────────────────────────────────────────────

  function spawnConfetti(anchor) {
    const rect   = anchor.getBoundingClientRect();
    const cx     = rect.left + rect.width  / 2;
    const cy     = rect.top  + rect.height / 2;
    const colors = ['#22C55E', '#3B82F6', '#F59E0B'];
    const count  = 12;
    for (let i = 0; i < count; i++) {
      const el    = document.createElement('div');
      el.className = 'g-confetti-particle';
      el.style.left       = cx + 'px';
      el.style.top        = cy + 'px';
      el.style.background = colors[i % colors.length];
      const angle = (i / count) * 360 + Math.random() * 30;
      const dist  = 40 + Math.random() * 30;
      const rad   = angle * Math.PI / 180;
      el.style.setProperty('--tx', (Math.cos(rad) * dist) + 'px');
      el.style.setProperty('--ty', (Math.sin(rad) * dist) + 'px');
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  }

  // ── Daily checkbox ─────────────────────────────────────────────────────

  function toggleCheck(goalId) {
    const goals = loadGoals();
    const goal  = goals.find(g => g.id === goalId);
    if (!goal || goal.status === 'cancelled') return;

    const today = todayKey();
    if (!goal.completions) goal.completions = {};
    goal.completions[today] = !goal.completions[today];
    saveGoals(goals);
    renderGoals();
  }

  // ── 3-dot context menu ─────────────────────────────────────────────────

  let activeMenu = null;

  function openMenu(goalId, anchorEl) {
    closeMenu();

    const goals = loadGoals();
    const goal  = goals.find(g => g.id === goalId);
    if (!goal) return;

    const menu = document.createElement('div');
    menu.className = 'g-context-menu';
    menu.innerHTML = `
      <button class="g-menu-item" data-action="edit">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Edit
      </button>
      ${goal.status !== 'cancelled' ? `
      <button class="g-menu-item" data-action="cancel">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        Mark as cancelled
      </button>` : `
      <button class="g-menu-item" data-action="uncancel">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
        Restore goal
      </button>`}
      <button class="g-menu-item g-menu-item--danger" data-action="delete">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        Delete
      </button>`;

    // Position below the anchor button
    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = (rect.right - menu.offsetWidth) + 'px';
    activeMenu = menu;

    menu.querySelector('[data-action="edit"]').addEventListener('click', () => {
      closeMenu();
      pendingType = goal.type;
      openModal(goalId);
    });

    const cancelBtn = menu.querySelector('[data-action="cancel"]');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      closeMenu();
      setGoalStatus(goalId, 'cancelled');
    });

    const uncancelBtn = menu.querySelector('[data-action="uncancel"]');
    if (uncancelBtn) uncancelBtn.addEventListener('click', () => {
      closeMenu();
      setGoalStatus(goalId, 'active');
    });

    menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
      closeMenu();
      deleteGoal(goalId);
    });
  }

  function closeMenu() {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }
  }

  function setGoalStatus(goalId, status) {
    const goals = loadGoals();
    const goal  = goals.find(g => g.id === goalId);
    if (goal) { goal.status = status; saveGoals(goals); renderGoals(); }
  }

  function deleteGoal(goalId) {
    if (!confirm('Delete this goal? This cannot be undone.')) return;
    const goals = loadGoals().filter(g => g.id !== goalId);
    saveGoals(goals);
    renderGoals();
  }

  // ── Event delegation on goal list ──────────────────────────────────────

  function bindListEvents() {
    const list = document.getElementById('g-goal-list');
    if (!list) return;

    list.addEventListener('click', e => {
      const checkBtn = e.target.closest('[data-action="check"]');
      if (checkBtn) {
        const card = checkBtn.closest('[data-id]');
        if (card) {
          const isChecking = !checkBtn.classList.contains('g-checkbox--checked');
          if (isChecking) spawnConfetti(checkBtn);
          toggleCheck(card.dataset.id);
        }
        return;
      }

      const menuBtn = e.target.closest('[data-action="menu"]');
      if (menuBtn) {
        const card = menuBtn.closest('[data-id]');
        if (card) openMenu(card.dataset.id, menuBtn);
        return;
      }
    });

    // Close menu on outside click
    document.addEventListener('click', e => {
      if (activeMenu && !activeMenu.contains(e.target) && !e.target.closest('[data-action="menu"]')) {
        closeMenu();
      }
    });
  }

  // ── Public ─────────────────────────────────────────────────────────────

  function init() {
    // "Add goal" button
    const addBtn = document.getElementById('g-add-goal-btn');
    if (addBtn) addBtn.addEventListener('click', () => openModal(null));

    // Close modal on overlay click
    const overlay = document.getElementById('g-modal-overlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) closeModal();
      });
    }

    bindListEvents();
    initChartControls();
  }

  function refresh() {
    renderGoals();
    drawActivityChart();
  }

  // ── Activity chart ─────────────────────────────────────────────────────

  const PERIODS = { '7': 7, '14': 14, '30': 30 };
  let chartPeriod = 7;

  function dayKeys(n) {
    const keys = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      keys.push(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
    }
    return keys;
  }

  function dayLabel(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m, d);
    if (n <= 7)  return date.toLocaleDateString('en-US', { weekday: 'short' });
    if (n <= 14) return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    return date.getDate() % 3 === 0
      ? date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
      : '';
  }

  function drawActivityChart() {
    const canvas = document.getElementById('g-activity-chart');
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    const W    = canvas.width;
    const H    = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const keys   = dayKeys(chartPeriod);
    const goals  = loadGoals();
    const todayK = todayKey();

    // Count how many goals were checked per day
    const counts = keys.map(k =>
      goals.filter(g => g.completions && g.completions[k]).length
    );
    const maxCount = Math.max(...counts, 1);
    const totalGoals = goals.filter(g => g.status !== 'cancelled').length;

    const PAD    = { top: 16, right: 8, bottom: 36, left: 28 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top  - PAD.bottom;
    const n      = keys.length;
    const gap    = innerW / n;
    const barW   = Math.max(4, Math.floor(gap * (n <= 7 ? 0.44 : 0.55)));

    // Y-axis gridlines
    const steps = Math.min(maxCount, 4);
    for (let i = 0; i <= steps; i++) {
      const val = Math.round((i / steps) * maxCount);
      const y   = PAD.top + innerH - (val / maxCount) * innerH;
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth   = 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + innerW, y); ctx.stroke();
      ctx.fillStyle  = '#4B5563';
      ctx.font       = '9px -apple-system, sans-serif';
      ctx.textAlign  = 'right';
      ctx.fillText(val, PAD.left - 4, y + 3);
    }

    counts.forEach((count, i) => {
      const isToday = keys[i] === todayK;
      const barH    = count > 0 ? Math.max(4, (count / maxCount) * innerH) : 3;
      const x       = PAD.left + i * gap + Math.floor((gap - barW) / 2);
      const y       = PAD.top + innerH - barH;

      ctx.fillStyle = isToday ? '#3B82F6' : (count > 0 ? '#3A3D44' : '#1E2025');
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, count > 0 ? [3, 3, 2, 2] : 2);
      ctx.fill();

      const lbl = dayLabel(keys[i], chartPeriod);
      if (lbl) {
        ctx.fillStyle  = isToday ? '#93C5FD' : '#4B5563';
        ctx.font       = `${isToday ? 600 : 400} 9px -apple-system, sans-serif`;
        ctx.textAlign  = 'center';
        ctx.fillText(lbl, x + barW / 2, PAD.top + innerH + 14);
      }
    });

    // Today's completion summary text
    const todayCount = counts[counts.length - 1];
    const summary = document.getElementById('g-chart-summary');
    if (summary) {
      summary.textContent = totalGoals > 0
        ? `${todayCount} of ${totalGoals} goals completed today`
        : 'Add goals to start tracking';
    }
  }

  function initChartControls() {
    const select = document.getElementById('g-chart-period');
    if (select) {
      select.addEventListener('change', () => {
        chartPeriod = Number(select.value) || 7;
        drawActivityChart();
      });
    }
  }

  // ── Public ─────────────────────────────────────────────────────────────

  return { init, refresh, loadGoals, saveGoals, renderGoals, openModal };
})();
