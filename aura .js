/* ══════════════════════════════════════════
   AURA — Personal Network Agent
   Main Application JavaScript
   Backend: Coral Agent (local_source.yaml)
   AI: Claude (Anthropic)
══════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────
//  CORAL API CONFIG
//  Run:  coral serve local_source.yaml
//  Default port 3000 — change CORAL_BASE if you used --port
// ─────────────────────────────────────────
const CORAL_BASE  = 'http://localhost:3000';
const CORAL_TABLE = 'local_network';   // matches `name:` in local_source.yaml

async function coralQuery(sql) {
  const res = await fetch(`${CORAL_BASE}/query`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`Coral HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.rows ?? json.data ?? []);
}

function setBackendStatus(online) {
  const chip  = document.getElementById('coral-status-chip');
  const label = document.getElementById('coral-status-text');
  const dot   = chip.querySelector('.status-dot');
  if (online) {
    chip.style.background = 'var(--green-bg)';
    chip.style.color      = 'var(--green-fg)';
    dot.style.background  = 'var(--green-fg)';
    label.textContent     = 'Coral Online';
  } else {
    chip.style.background = 'var(--yellow-bg)';
    chip.style.color      = 'var(--yellow-fg)';
    dot.style.background  = 'var(--yellow-fg)';
    label.textContent     = 'Coral Offline';
  }
  let banner = document.getElementById('coral-status-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'coral-status-banner';
    document.body.appendChild(banner);
  }
  if (online) {
    banner.textContent = '⬡ CORAL BACKEND ONLINE';
    banner.style.cssText = 'position:fixed;bottom:16px;right:88px;z-index:900;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;border:1px solid var(--green-fg);background:var(--green-bg);color:var(--green-fg);pointer-events:none;transition:opacity .4s';
    setTimeout(() => { banner.style.opacity = '0'; }, 3500);
  } else {
    banner.textContent = '⚠ CORAL OFFLINE — using local cache';
    banner.style.cssText = 'position:fixed;bottom:16px;right:88px;z-index:900;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:500;border:1px solid var(--yellow-fg);background:var(--yellow-bg);color:var(--yellow-fg);pointer-events:none;opacity:1';
  }
}

// ─────────────────────────────────────────
//  STATE — backed by localStorage
// ─────────────────────────────────────────
let connections  = JSON.parse(localStorage.getItem('aura_connections')  || '[]');
let events       = JSON.parse(localStorage.getItem('aura_events')       || '[]');
let interactions = JSON.parse(localStorage.getItem('aura_interactions') || '[]');
let calYear, calMonth;

// Priority mapping (replaces score 0-100 with Low/Medium/High)
const PRIORITY_LEVELS = {
  low:    { label: 'Low',    color: '#34a853', bg: '#e6f4ea', score: 33 },
  medium: { label: 'Medium', color: '#f29900', bg: '#fef7e0', score: 66 },
  high:   { label: 'High',   color: '#d93025', bg: '#fce8e6', score: 100 },
};

function scoreToPriority(score) {
  if (score >= 67) return 'high';
  if (score >= 34) return 'medium';
  return 'low';
}

// Generalized categories/fields
const ALL_FIELDS = [
  'Technology', 'Business', 'Creative', 'Healthcare', 'Finance',
  'Education', 'Marketing', 'Legal', 'Science', 'Engineering',
  'Media', 'Government', 'Non-Profit', 'Other'
];

// ─────────────────────────────────────────
//  CORAL SYNC
// ─────────────────────────────────────────
async function syncFromCoral() {
  try {
    const [influencers, eventsData, ledger] = await Promise.all([
      coralQuery(`SELECT * FROM ${CORAL_TABLE}.social_influencers`),
      coralQuery(`SELECT * FROM ${CORAL_TABLE}.upcoming_events`),
      coralQuery(`SELECT * FROM ${CORAL_TABLE}.interaction_ledger`),
    ]);

    setBackendStatus(true);

    const existingIds = new Set(connections.map(c => c._coral_id).filter(Boolean));
    const newConns = influencers
      .filter(row => !existingIds.has(row.influencer_id))
      .map(row => ({
        id        : 'coral_' + row.influencer_id,
        _coral_id : row.influencer_id,
        name      : row.full_name        || '',
        role      : row.primary_industry || '',
        field     : mapIndustryToField(row.primary_industry),
        linkedin  : row.linkedin_url     || '',
        github    : '',
        twitter   : row.x_handle ? `https://x.com/${row.x_handle.replace('@','')}` : '',
        score     : clamp(Number(row.influence_score) || 0, 0, 100),
        priority  : scoreToPriority(clamp(Number(row.influence_score) || 0, 0, 100)),
        notes     : row.notes || '',
        addedAt   : new Date().toISOString(),
        _source   : 'coral',
        attending_event_id: row.attending_event_id || null,
      }));

    if (newConns.length) {
      connections = [...connections, ...newConns];
      save();
      addLog(`Coral: loaded ${newConns.length} influencer(s)`);
    }

    const existingEventIds = new Set(events.map(e => e._coral_id).filter(Boolean));
    const newEvts = eventsData
      .filter(row => !existingEventIds.has(row.event_id))
      .map(row => ({
        id        : 'coral_evt_' + row.event_id,
        _coral_id : row.event_id,
        title     : row.event_name  || 'Untitled Event',
        date      : parseCoralDate(row.event_date),
        time      : '',
        type      : row.industry    || 'Conference',
        desc      : `${row.location || ''} — ${row.attendee_count || 0} attendees`,
        _source   : 'coral',
      }));

    if (newEvts.length) {
      events = [...events, ...newEvts];
      save();
      addLog(`Coral: loaded ${newEvts.length} event(s)`);
    }

    interactions = ledger.map(row => ({
      id      : row.interaction_id,
      name    : row.person_name       || '',
      lastSeen: row.last_contact_date || null,
      status  : row.status            || '',
      notes   : row.notes             || '',
    }));
    localStorage.setItem('aura_interactions', JSON.stringify(interactions));
    if (interactions.length) addLog(`Coral: loaded ${interactions.length} CRM record(s)`);

    updateDashboard();
    renderConnections();
    renderCalendar();
    renderRankings();

  } catch (err) {
    console.warn('[Coral] Could not reach backend:', err.message);
    setBackendStatus(false);
    addLog('Coral offline — showing cached data');
  }
}

function mapIndustryToField(industry) {
  if (!industry) return 'Other';
  const i = industry.toLowerCase();
  if (i.includes('ai') || i.includes('ml') || i.includes('machine') || i.includes('tech') || i.includes('software') || i.includes('web') || i.includes('data')) return 'Technology';
  if (i.includes('business') || i.includes('manag') || i.includes('entrepreneur')) return 'Business';
  if (i.includes('design') || i.includes('ux') || i.includes('creative') || i.includes('art')) return 'Creative';
  if (i.includes('health') || i.includes('medical') || i.includes('pharma')) return 'Healthcare';
  if (i.includes('finance') || i.includes('invest') || i.includes('bank')) return 'Finance';
  if (i.includes('edu') || i.includes('teach') || i.includes('research')) return 'Education';
  if (i.includes('market') || i.includes('brand') || i.includes('pr')) return 'Marketing';
  if (i.includes('legal') || i.includes('law')) return 'Legal';
  if (i.includes('science') || i.includes('bio') || i.includes('chem')) return 'Science';
  if (i.includes('engineer')) return 'Engineering';
  if (i.includes('media') || i.includes('journal') || i.includes('content')) return 'Media';
  if (i.includes('govern') || i.includes('policy') || i.includes('public')) return 'Government';
  if (i.includes('non') || i.includes('ngo') || i.includes('charity')) return 'Non-Profit';
  return 'Other';
}

function parseCoralDate(raw) {
  if (!raw) return new Date().toISOString().split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  const d = new Date(raw);
  return isNaN(d) ? new Date().toISOString().split('T')[0] : d.toISOString().split('T')[0];
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ─────────────────────────────────────────
//  GLITTER CURSOR
// ─────────────────────────────────────────
(function initGlitter() {
  const canvas = document.getElementById('glitter-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H;
  const particles = [];
  let lastX = -200, lastY = -200;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS = [
    'rgba(232,93,117,',
    'rgba(255,138,101,',
    'rgba(255,183,77,',
    'rgba(100,181,246,',
    'rgba(186,104,200,',
  ];

  function spawnParticles(x, y, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 2.5 + 0.5;
      const size  = Math.random() * 3 + 1;
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed-1,
        size, alpha: 1, decay: Math.random()*0.025+0.015, color,
        glow: Math.random() > 0.6, shape: Math.random() > 0.5 ? 'circle' : 'star' });
    }
  }

  function drawStar(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a)*r, y + Math.sin(a)*r);
    }
    ctx.stroke();
  }

  window.addEventListener('mousemove', (e) => {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist > 4) {
      spawnParticles(e.clientX, e.clientY, Math.min(Math.floor(dist/3)+1, 6));
      lastX = e.clientX; lastY = e.clientY;
    }
    document.documentElement.style.setProperty('--cx', e.clientX + 'px');
    document.documentElement.style.setProperty('--cy', e.clientY + 'px');
  });

  function animate() {
    ctx.clearRect(0, 0, W, H);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.alpha -= p.decay;
      if (p.alpha <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = p.alpha;
      if (p.glow) { ctx.shadowBlur = 10; ctx.shadowColor = p.color + '0.8)'; }
      ctx.strokeStyle = p.color + p.alpha + ')';
      ctx.fillStyle   = p.color + p.alpha + ')';
      ctx.lineWidth = 1;
      if (p.shape === 'circle') {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
      } else { drawStar(ctx, p.x, p.y, p.size*1.5); }
      ctx.restore();
    }
    requestAnimationFrame(animate);
  }
  animate();
})();

// ─────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    const section = document.getElementById(btn.dataset.section);
    if (section) section.classList.add('active');
    if (btn.dataset.section === 'rankings')  renderRankings();
    if (btn.dataset.section === 'calendar')  renderCalendar();
    if (btn.dataset.section === 'dashboard') updateDashboard();
    if (btn.dataset.section === 'common-events') renderCommonEvents();
  });
});

document.getElementById('sync-btn').addEventListener('click', () => {
  addLog('Manual sync triggered…');
  syncFromCoral();
});

// ─────────────────────────────────────────
//  PROFILE MODAL
// ─────────────────────────────────────────
const profileModal = document.getElementById('profile-modal-overlay');

document.getElementById('avatar-btn').addEventListener('click', () => {
  profileModal.classList.add('open');
  renderProfileModal();
});
document.getElementById('profile-modal-close').addEventListener('click', () => profileModal.classList.remove('open'));
profileModal.addEventListener('click', e => { if (e.target === profileModal) profileModal.classList.remove('open'); });

document.getElementById('save-profile-btn').addEventListener('click', () => {
  const name  = document.getElementById('p-name').value.trim();
  const role  = document.getElementById('p-role').value.trim();
  const email = document.getElementById('p-email').value.trim();
  const bio   = document.getElementById('p-bio').value.trim();
  if (name) {
    const profile = { name, role, email, bio };
    localStorage.setItem('aura_profile', JSON.stringify(profile));
    // Update avatar
    const initEl = document.getElementById('avatar-initials');
    if (initEl) initEl.textContent = initials(name);
    addLog('Profile updated');
    profileModal.classList.remove('open');
  } else {
    highlight('p-name');
  }
});

function renderProfileModal() {
  const profile = JSON.parse(localStorage.getItem('aura_profile') || '{}');
  document.getElementById('p-name').value  = profile.name  || '';
  document.getElementById('p-role').value  = profile.role  || '';
  document.getElementById('p-email').value = profile.email || '';
  document.getElementById('p-bio').value   = profile.bio   || '';
  // Stats
  document.getElementById('p-stat-connections').textContent = connections.length;
  document.getElementById('p-stat-events').textContent      = events.length;
  document.getElementById('p-stat-fields').textContent      = [...new Set(connections.map(c => c.field))].length;
}

// Load saved profile name into avatar on boot
(function loadProfileAvatar() {
  const profile = JSON.parse(localStorage.getItem('aura_profile') || '{}');
  const initEl  = document.getElementById('avatar-initials');
  if (profile.name && initEl) initEl.textContent = initials(profile.name);
})();

// ─────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────
function animateCount(el, target, duration = 800) {
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const diff  = target - start;
  const steps = 30;
  let step    = 0;
  const interval = setInterval(() => {
    step++;
    el.textContent = Math.round(start + diff * (step / steps));
    if (step >= steps) { el.textContent = target; clearInterval(interval); }
  }, duration / steps);
}

function updateDashboard() {
  animateCount(document.getElementById('stat-connections'), connections.length);
  animateCount(document.getElementById('stat-events'), events.length);
  animateCount(document.getElementById('stat-fields'),
    [...new Set(connections.map(c => c.field))].length);

  const highPriority = connections.filter(c => (c.priority || scoreToPriority(c.score)) === 'high').length;
  animateCount(document.getElementById('stat-top'), highPriority);

  const list = document.getElementById('recent-list');
  if (!connections.length) {
    list.innerHTML = '<div class="empty-state"><span class="material-icons-round">person_add</span><p>No connections yet</p></div>';
  } else {
    const recent = [...connections].reverse().slice(0, 5);
    list.innerHTML = recent.map(c => {
      const p = c.priority || scoreToPriority(c.score);
      const pInfo = PRIORITY_LEVELS[p];
      return `
        <div class="recent-item">
          <div class="recent-avatar">${initials(c.name)}</div>
          <div class="recent-info">
            <div class="recent-name">${esc(c.name)}</div>
            <div class="recent-role">${esc(c.role)} · ${esc(c.field)}</div>
          </div>
          <span class="priority-badge" style="background:${pInfo.bg};color:${pInfo.color}">${pInfo.label}</span>
          ${c._source === 'coral' ? '<span style="font-size:9px;color:var(--coral-fg);opacity:.7;margin-left:4px;font-weight:600">CORAL</span>' : ''}
        </div>
      `;
    }).join('');
  }
  renderInteractionLedger();
}

function renderInteractionLedger() {
  const log = document.getElementById('activity-log');
  if (!interactions.length) return;
  Array.from(log.querySelectorAll('.log-entry.crm')).forEach(e => e.remove());
  const slice = interactions.slice(0, 10).reverse();
  slice.forEach(row => {
    const entry = document.createElement('div');
    entry.className = 'log-entry crm';
    const statusColor = row.status.toLowerCase().includes('touch')
      ? 'var(--primary)' : row.status.toLowerCase().includes('follow')
      ? 'var(--yellow-fg)' : 'var(--text-hint)';
    entry.innerHTML = `
      <span class="log-time" style="color:${statusColor}">${esc(row.status.toUpperCase().slice(0,8))}</span>
      <span class="log-msg">${esc(row.name)}${row.lastSeen ? ' · ' + row.lastSeen : ''}</span>
    `;
    log.appendChild(entry);
  });
}

function addLog(msg) {
  const log  = document.getElementById('activity-log');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${esc(msg)}</span>`;
  log.prepend(entry);
  while (log.children.length > 30) log.removeChild(log.lastChild);
}

// ─────────────────────────────────────────
//  CONNECTIONS
// ─────────────────────────────────────────
function renderConnections(list = connections) {
  const grid = document.getElementById('connections-grid');
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty-state-big">
        <span class="material-icons-round">group_add</span>
        <p>No connections yet</p>
        <span class="empty-sub">Click "Add connection" to get started</span>
      </div>`;
    return;
  }
  grid.innerHTML = list.map(c => {
    const p = c.priority || scoreToPriority(c.score);
    const pInfo = PRIORITY_LEVELS[p];
    const xUrl = c.twitter || '';
    return `
      <div class="connection-card" data-id="${c.id}">
        <button class="card-delete" onclick="deleteConnection('${c.id}')">✕</button>
        ${c._source === 'coral' ? '<span class="card-source-badge">CORAL</span>' : ''}
        <div class="card-top">
          <div class="card-avatar" style="background:${pInfo.bg};color:${pInfo.color}">${initials(c.name)}</div>
          <div class="card-info">
            <div class="card-name">${esc(c.name)}</div>
            <div class="card-role">${esc(c.role)}</div>
            <span class="card-field">${esc(c.field)}</span>
          </div>
        </div>
        <div class="card-priority-row">
          <span class="priority-label">PRIORITY</span>
          <span class="priority-badge" style="background:${pInfo.bg};color:${pInfo.color}">${pInfo.label}</span>
        </div>
        <div class="card-links">
          ${c.linkedin
            ? `<a class="profile-link" href="${esc(c.linkedin)}" target="_blank" rel="noopener" title="LinkedIn"><span style="font-weight:700;font-size:11px">in</span> LinkedIn</a>`
            : `<span class="profile-link disabled">No LinkedIn</span>`
          }
          ${xUrl
            ? `<a class="profile-link x-link" href="${esc(xUrl)}" target="_blank" rel="noopener" title="X / Twitter"><span style="font-weight:800;font-size:12px">𝕏</span></a>`
            : ''
          }
          ${c.github
            ? `<a class="profile-link" href="${esc(c.github)}" target="_blank" rel="noopener" title="GitHub"><span style="font-size:11px">⬡</span> GitHub</a>`
            : ''
          }
          <button class="profile-link common-ev-btn" onclick="showCommonEvents('${c.id}')" title="Common Events">
            <span class="material-icons-round" style="font-size:13px">event</span> Events
          </button>
        </div>
        ${c.notes ? `<div class="card-notes" title="${esc(c.notes)}">${esc(c.notes)}</div>` : ''}
      </div>
    `;
  }).join('');
}

document.getElementById('search-input').addEventListener('input', applyFilters);
document.getElementById('field-filter').addEventListener('change', applyFilters);

function applyFilters() {
  const q     = document.getElementById('search-input').value.toLowerCase();
  const field = document.getElementById('field-filter').value;
  const filtered = connections.filter(c => {
    const matchQ = !q || c.name.toLowerCase().includes(q) || (c.role||'').toLowerCase().includes(q);
    const matchF = !field || c.field === field;
    return matchQ && matchF;
  });
  renderConnections(filtered);
}

function deleteConnection(id) {
  connections = connections.filter(c => c.id !== id);
  save(); renderConnections(); renderRankings(); updateDashboard();
  addLog('Connection removed');
}
window.deleteConnection = deleteConnection;

// ─────────────────────────────────────────
//  ADD CONNECTION MODAL
// ─────────────────────────────────────────
const modalOverlay  = document.getElementById('modal-overlay');
const priorityRange = document.getElementById('f-priority');

document.getElementById('open-modal-btn').addEventListener('click', () => {
  document.getElementById('f-field-manual').style.display = 'none';
  modalOverlay.classList.add('open');
});
document.getElementById('modal-close').addEventListener('click',    () => modalOverlay.classList.remove('open'));
document.getElementById('modal-cancel-btn').addEventListener('click', () => modalOverlay.classList.remove('open'));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });

// Field dropdown — show manual entry if "Other" selected
document.getElementById('f-field').addEventListener('change', function() {
  const manualRow = document.getElementById('f-field-manual');
  manualRow.style.display = this.value === '__manual__' ? 'flex' : 'none';
});

// Priority display
const priorityLabels = ['Low', 'Medium', 'High'];
document.getElementById('f-priority').addEventListener('input', function() {
  const idx = parseInt(this.value);
  const pKey = ['low','medium','high'][idx];
  const pInfo = PRIORITY_LEVELS[pKey];
  document.getElementById('priority-display').textContent = pInfo.label;
  document.getElementById('priority-display').style.color = pInfo.color;
});

document.getElementById('submit-connection').addEventListener('click', () => {
  const name     = document.getElementById('f-name').value.trim();
  const role     = document.getElementById('f-role').value.trim();
  const fieldSel = document.getElementById('f-field').value;
  const fieldMan = document.getElementById('f-field-manual-input').value.trim();
  const field    = fieldSel === '__manual__' ? (fieldMan || 'Other') : fieldSel;
  const linkedin = document.getElementById('f-linkedin').value.trim();
  const github   = document.getElementById('f-github').value.trim();
  const twitter  = document.getElementById('f-twitter').value.trim();
  const notes    = document.getElementById('f-notes').value.trim();
  const priIdx   = parseInt(document.getElementById('f-priority').value);
  const priority = ['low','medium','high'][priIdx];
  const score    = PRIORITY_LEVELS[priority].score;

  if (!name) { highlight('f-name'); return; }

  const conn = {
    id: 'c_' + Date.now(), name, role, field, linkedin, github,
    twitter: twitter ? (twitter.startsWith('http') ? twitter : `https://x.com/${twitter.replace('@','')}`) : '',
    score, priority, notes, addedAt: new Date().toISOString(), _source: 'manual'
  };
  connections.push(conn);
  save(); renderConnections(); updateDashboard();
  addLog(`New connection: ${name}`);
  modalOverlay.classList.remove('open');
  clearForm(['f-name','f-role','f-linkedin','f-github','f-twitter','f-notes','f-field-manual-input']);
  document.getElementById('f-priority').value = 1;
  document.getElementById('priority-display').textContent = 'Medium';
  document.getElementById('priority-display').style.color = 'var(--yellow-fg)';
});

// ─────────────────────────────────────────
//  RANKINGS
// ─────────────────────────────────────────
let rankField = '';

document.querySelectorAll('.rank-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rank-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    rankField = btn.dataset.field;
    renderRankings();
  });
});

document.querySelectorAll('.priority-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.priority-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderRankings();
  });
});

function renderRankings() {
  const list = document.getElementById('rankings-list');
  let data = [...connections];
  if (rankField) data = data.filter(c => c.field === rankField);

  const activePri = document.querySelector('.priority-filter-btn.active');
  const priFilter = activePri ? activePri.dataset.priority : '';
  if (priFilter) data = data.filter(c => (c.priority || scoreToPriority(c.score)) === priFilter);

  // Sort by priority: high > medium > low, then by score
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  data.sort((a, b) => {
    const pa = a.priority || scoreToPriority(a.score);
    const pb = b.priority || scoreToPriority(b.score);
    if (priorityOrder[pa] !== priorityOrder[pb]) return priorityOrder[pa] - priorityOrder[pb];
    return b.score - a.score;
  });

  if (!data.length) {
    list.innerHTML = '<div class="empty-state"><span class="material-icons-round">leaderboard</span><p>No connections match this filter</p></div>';
    return;
  }

  list.innerHTML = data.map((c, i) => {
    const rank  = i + 1;
    const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
    const p = c.priority || scoreToPriority(c.score);
    const pInfo = PRIORITY_LEVELS[p];
    const xUrl = c.twitter || '';
    return `
      <div class="rank-row">
        <span class="rank-number ${rankClass}">${rank <= 3 ? ['①','②','③'][rank-1] : rank}</span>
        <div class="rank-profile">
          <div class="rank-avatar" style="background:${pInfo.bg};color:${pInfo.color}">${initials(c.name)}</div>
          <div>
            <div class="rank-name">${esc(c.name)}</div>
            <div class="rank-role">${esc(c.role)}</div>
          </div>
        </div>
        <span class="rank-field-tag">${esc(c.field)}</span>
        <div class="rank-priority-cell">
          <span class="priority-badge" style="background:${pInfo.bg};color:${pInfo.color}">${pInfo.label}</span>
        </div>
        <div class="rank-links">
          ${c.linkedin ? `<a class="rank-link" href="${esc(c.linkedin)}" target="_blank" rel="noopener" title="LinkedIn">LI</a>` : ''}
          ${xUrl       ? `<a class="rank-link x-rank-link" href="${esc(xUrl)}" target="_blank" rel="noopener" title="X">𝕏</a>` : ''}
          ${c.github   ? `<a class="rank-link" href="${esc(c.github)}"   target="_blank" rel="noopener" title="GitHub">GH</a>` : ''}
          ${c._source === 'coral' ? '<span style="font-size:9px;color:var(--coral-fg);opacity:.6;font-family:monospace;margin-left:4px">◈</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────
//  CALENDAR
// ─────────────────────────────────────────
(function initCal() {
  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();
})();

document.getElementById('prev-month').addEventListener('click', () => {
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar();
});
document.getElementById('next-month').addEventListener('click', () => {
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar();
});

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
                'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

function renderCalendar() {
  document.getElementById('cal-month-year').textContent = `${MONTHS[calMonth]} ${calYear}`;
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today       = new Date();

  // Map date -> array of events for tooltip
  const eventMap = {};
  events.forEach(e => {
    const d = new Date(e.date + 'T00:00:00');
    if (d.getFullYear() === calYear && d.getMonth() === calMonth) {
      const day = d.getDate();
      if (!eventMap[day]) eventMap[day] = [];
      eventMap[day].push(e.title);
    }
  });

  for (let i = 0; i < firstDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day empty';
    grid.appendChild(cell);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day';
    const isToday = d === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
    if (isToday) cell.classList.add('today');

    if (eventMap[d]) {
      cell.classList.add('has-event');
      // Show event name(s) below the day number
      const names = eventMap[d];
      cell.innerHTML = `<span class="cal-day-num">${d}</span><span class="cal-event-label">${esc(names[0])}${names.length > 1 ? ` +${names.length-1}` : ''}</span>`;
    } else {
      cell.textContent = d;
    }

    cell.addEventListener('click', () => scrollToEventsOnDate(calYear, calMonth, d));
    grid.appendChild(cell);
  }
  renderEvents();
}

function renderEvents() {
  const el     = document.getElementById('events-list');
  const sorted = [...events].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!sorted.length) {
    el.innerHTML = '<div class="empty-state"><span class="material-icons-round">event_busy</span><p>No events scheduled</p></div>';
    return;
  }
  el.innerHTML = sorted.map(ev => {
    const d   = new Date(ev.date + 'T00:00:00');
    const day = d.getDate();
    const mon = MONTHS[d.getMonth()].slice(0, 3);
    return `
      <div class="event-item" data-date="${ev.date}">
        <div class="event-date-block">
          <span class="event-day-num">${String(day).padStart(2,'0')}</span>
          <span class="event-mon">${mon}</span>
        </div>
        <div class="event-details">
          <div class="event-title">
            ${esc(ev.title)}
            ${ev._source === 'coral' ? ' <span style="font-size:9px;color:var(--coral-fg);opacity:.6;font-family:monospace">◈ CORAL</span>' : ''}
          </div>
          <div class="event-time">${ev.time || ev.desc || '—'} &nbsp;·&nbsp; ${d.getFullYear()}</div>
          <span class="event-type-badge">${esc(ev.type)}</span>
        </div>
        <button class="event-delete" onclick="deleteEvent('${ev.id}')">✕</button>
      </div>
    `;
  }).join('');
}

function scrollToEventsOnDate(y, m, d) {
  const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const item = document.querySelector(`.event-item[data-date="${dateStr}"]`);
  if (item) item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

window.deleteEvent = function(id) {
  events = events.filter(e => e.id !== id);
  save(); renderCalendar(); updateDashboard(); addLog('Event removed');
};

// ─────────────────────────────────────────
//  ADD EVENT MODAL
// ─────────────────────────────────────────
const eventModal = document.getElementById('event-modal-overlay');
document.getElementById('open-event-modal-btn').addEventListener('click', () => {
  eventModal.classList.add('open');
  document.getElementById('e-date').value = new Date().toISOString().split('T')[0];
});
document.getElementById('event-modal-close').addEventListener('click', () => eventModal.classList.remove('open'));
document.getElementById('event-cancel-btn').addEventListener('click',  () => eventModal.classList.remove('open'));
eventModal.addEventListener('click', e => { if (e.target === eventModal) eventModal.classList.remove('open'); });

// Event type "manual entry"
document.getElementById('e-type').addEventListener('change', function() {
  const manualRow = document.getElementById('e-type-manual');
  manualRow.style.display = this.value === '__manual__' ? 'flex' : 'none';
});

// Linked connections selector
document.getElementById('e-connections-search').addEventListener('input', function() {
  renderConnectionSelector(this.value);
});

function renderConnectionSelector(query = '') {
  const container = document.getElementById('e-connections-list');
  const q = query.toLowerCase();
  const filtered = connections.filter(c => !q || c.name.toLowerCase().includes(q));
  if (!filtered.length) { container.innerHTML = '<div style="font-size:12px;color:var(--text-hint);padding:8px">No connections found</div>'; return; }
  container.innerHTML = filtered.map(c => `
    <label class="conn-checkbox-item">
      <input type="checkbox" name="event-conn" value="${c.id}" />
      <span>${esc(c.name)} <small style="color:var(--text-hint)">${esc(c.field)}</small></span>
    </label>
  `).join('');
}

document.getElementById('submit-event').addEventListener('click', () => {
  const title   = document.getElementById('e-title').value.trim();
  const date    = document.getElementById('e-date').value;
  const time    = document.getElementById('e-time').value;
  const typeSel = document.getElementById('e-type').value;
  const typeMan = document.getElementById('e-type-manual-input').value.trim();
  const type    = typeSel === '__manual__' ? (typeMan || 'Other') : typeSel;
  const desc    = document.getElementById('e-desc').value.trim();
  // Collect linked connections
  const checked = [...document.querySelectorAll('input[name="event-conn"]:checked')].map(el => el.value);

  if (!title) { highlight('e-title'); return; }
  if (!date)  { highlight('e-date');  return; }

  const ev = { id: 'e_' + Date.now(), title, date, time, type, desc,
    linkedConnections: checked, _source: 'manual' };
  events.push(ev);
  save(); renderCalendar(); updateDashboard();
  addLog(`Event scheduled: ${title}`);
  eventModal.classList.remove('open');
  clearForm(['e-title','e-desc','e-connections-search']);
  document.getElementById('e-time').value = '';
  document.getElementById('e-connections-list').innerHTML = '';
});

// ─────────────────────────────────────────
//  COMMON EVENTS (between you and a connection)
// ─────────────────────────────────────────
const commonEventsModal = document.getElementById('common-events-modal-overlay');
document.getElementById('common-events-modal-close').addEventListener('click', () => commonEventsModal.classList.remove('open'));
commonEventsModal.addEventListener('click', e => { if (e.target === commonEventsModal) commonEventsModal.classList.remove('open'); });

function showCommonEvents(connId) {
  const conn = connections.find(c => c.id === connId);
  if (!conn) return;

  // Find events where this connection is linked
  const linkedEvts = events.filter(ev => (ev.linkedConnections || []).includes(connId));

  // Also match by coral attending_event_id
  let coralEvts = [];
  if (conn._coral_id && conn.attending_event_id) {
    coralEvts = events.filter(ev => ev._coral_id === conn.attending_event_id && !linkedEvts.find(e => e.id === ev.id));
  }

  const allCommon = [...linkedEvts, ...coralEvts];

  document.getElementById('common-events-title').textContent = `Events with ${conn.name}`;
  const listEl = document.getElementById('common-events-list');

  if (!allCommon.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="material-icons-round">event_busy</span>
        <p>No common events with ${esc(conn.name)} yet.</p>
        <span class="empty-sub">Link connections when adding an event to track this.</span>
      </div>`;
  } else {
    listEl.innerHTML = allCommon.map(ev => {
      const d   = new Date(ev.date + 'T00:00:00');
      const day = d.getDate();
      const mon = MONTHS[d.getMonth()].slice(0, 3);
      return `
        <div class="event-item">
          <div class="event-date-block">
            <span class="event-day-num">${String(day).padStart(2,'0')}</span>
            <span class="event-mon">${mon}</span>
          </div>
          <div class="event-details">
            <div class="event-title">${esc(ev.title)}</div>
            <div class="event-time">${ev.time || ev.desc || '—'} · ${d.getFullYear()}</div>
            <span class="event-type-badge">${esc(ev.type)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  commonEventsModal.classList.add('open');
}
window.showCommonEvents = showCommonEvents;

// Also render common events section (nav)
function renderCommonEvents() {
  const container = document.getElementById('common-events-grid');
  if (!container) return;
  if (!connections.length) {
    container.innerHTML = '<div class="empty-state-big"><span class="material-icons-round">group</span><p>No connections yet</p></div>';
    return;
  }

  // Group events by connection
  const rows = connections.map(c => {
    const linked = events.filter(ev => (ev.linkedConnections || []).includes(c.id));
    let coralEvts = [];
    if (c._coral_id && c.attending_event_id) {
      coralEvts = events.filter(ev => ev._coral_id === c.attending_event_id && !linked.find(e => e.id === ev.id));
    }
    const all = [...linked, ...coralEvts];
    return { conn: c, events: all };
  }).filter(r => r.events.length > 0);

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-state-big">
        <span class="material-icons-round">event_note</span>
        <p>No common events tracked yet</p>
        <span class="empty-sub">Link connections to events when scheduling them</span>
      </div>`;
    return;
  }

  container.innerHTML = rows.map(({ conn, events: evts }) => {
    const p = conn.priority || scoreToPriority(conn.score);
    const pInfo = PRIORITY_LEVELS[p];
    return `
      <div class="common-event-card">
        <div class="ce-header">
          <div class="card-avatar" style="background:${pInfo.bg};color:${pInfo.color};width:36px;height:36px;font-size:13px">${initials(conn.name)}</div>
          <div>
            <div style="font-size:14px;font-weight:500;color:var(--text-primary)">${esc(conn.name)}</div>
            <div style="font-size:12px;color:var(--text-secondary)">${esc(conn.field)}</div>
          </div>
          <span class="priority-badge" style="background:${pInfo.bg};color:${pInfo.color};margin-left:auto">${pInfo.label}</span>
        </div>
        <div class="ce-events">
          ${evts.map(ev => `
            <div class="ce-event-row">
              <span class="material-icons-round" style="font-size:14px;color:var(--primary)">event</span>
              <div>
                <div style="font-size:13px;font-weight:500">${esc(ev.title)}</div>
                <div style="font-size:11px;color:var(--text-hint)">${ev.date} · ${esc(ev.type)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// ─────────────────────────────────────────
//  CLAUDE AI PANEL
// ─────────────────────────────────────────
const aiPanel  = document.getElementById('ai-panel');
const aiToggle = document.getElementById('ai-toggle');
const aiClose  = document.getElementById('ai-panel-close');
const aiInput  = document.getElementById('ai-input');
const aiSend   = document.getElementById('ai-send');
const aiMsgs   = document.getElementById('ai-messages');

aiToggle.addEventListener('click', () => aiPanel.classList.toggle('open'));
aiClose.addEventListener('click',  () => aiPanel.classList.remove('open'));

document.querySelectorAll('.ai-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    aiInput.value = chip.textContent;
    sendToClaudeAI();
  });
});

aiSend.addEventListener('click', sendToClaudeAI);
aiInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendToClaudeAI(); } });

function appendAIMessage(role, text) {
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  div.textContent = text;
  aiMsgs.appendChild(div);
  aiMsgs.scrollTop = aiMsgs.scrollHeight;
  return div;
}

async function sendToClaudeAI() {
  const text = aiInput.value.trim();
  if (!text) return;
  aiInput.value = '';
  appendAIMessage('user', text);
  const ctx = buildNetworkContext();
  const thinkingEl = appendAIMessage('agent thinking', '…');

  try {
    // Uses /api/claude proxy (server.js) to avoid CORS issues.
    // server.js adds the Anthropic API key server-side.
    const res = await fetch('/api/claude', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        model      : 'claude-sonnet-4-20250514',
        max_tokens : 1000,
        system     : `You are a concise, helpful personal network assistant embedded in AURA — a personal network management app.
The user manages professional connections and events. Priorities are: Low (green), Medium (yellow), High (red).
Current network data:
${ctx}
Respond in 2-4 sentences. Be direct and actionable. No markdown.`,
        messages   : [{ role: 'user', content: text }],
      }),
    });

    const data  = await res.json();
    const reply = data.content?.find(b => b.type === 'text')?.text
      || data.error?.message
      || 'Sorry, I could not get a response.';
    thinkingEl.textContent = reply;
    thinkingEl.classList.remove('thinking');
    thinkingEl.classList.add('agent');
  } catch (err) {
    thinkingEl.textContent = `Error: ${err.message}`;
    thinkingEl.classList.remove('thinking');
  }
}

function buildNetworkContext() {
  const highPri  = connections.filter(c => (c.priority||scoreToPriority(c.score)) === 'high');
  const upcomingEvts = [...events]
    .filter(e => new Date(e.date) >= new Date())
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 3);

  return [
    `Total connections: ${connections.length}`,
    `Fields: ${[...new Set(connections.map(c => c.field))].join(', ') || 'none'}`,
    `High priority connections: ${highPri.map(c => c.name).join(', ') || 'none'}`,
    `Upcoming events: ${upcomingEvts.map(e => `${e.title} on ${e.date}`).join('; ') || 'none'}`,
    `CRM records: ${interactions.length}`,
  ].join('\n');
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function save() {
  localStorage.setItem('aura_connections',  JSON.stringify(connections));
  localStorage.setItem('aura_events',       JSON.stringify(events));
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function highlight(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = 'var(--red-fg)';
  el.style.boxShadow   = '0 0 10px rgba(217,48,37,0.3)';
  el.focus();
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 2000);
}

function clearForm(ids) {
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

// ─────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────
updateDashboard();
renderConnections();
renderCalendar();
populateFieldFilters();

function populateFieldFilters() {
  // Connection field filter dropdown
  const fieldFilter = document.getElementById('field-filter');
  fieldFilter.innerHTML = '<option value="">All fields</option>' +
    ALL_FIELDS.map(f => `<option value="${f}">${f}</option>`).join('');

  // Rankings chip bar
  const rankBar = document.getElementById('rank-field-chip-bar');
  if (rankBar) {
    rankBar.innerHTML = '<button class="chip rank-filter-btn active" data-field="">All</button>' +
      ALL_FIELDS.map(f => `<button class="chip rank-filter-btn" data-field="${f}">${f}</button>`).join('');
    document.querySelectorAll('.rank-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rank-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        rankField = btn.dataset.field;
        renderRankings();
      });
    });
  }
}

setTimeout(() => addLog('AURA initialized'), 300);
setTimeout(() => addLog(`${connections.length} connections in cache`), 600);
setTimeout(() => addLog(`${events.length} events in cache`), 900);

syncFromCoral();
