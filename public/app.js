let worker = null;
let currentEntry = null;
let timerInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('gt_worker');
  if (saved) { worker = JSON.parse(saved); showApp(); }
  document.getElementById('inp-pin').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('inp-pin').focus(); });
});

async function login() {
  const name = document.getElementById('inp-name').value.trim();
  const pin  = document.getElementById('inp-pin').value.trim();
  if (!name || !pin) { showLoginErr('Enter your name and PIN.'); return; }
  try {
    const r = await post('/api/auth/login', { name, pin });
    if (r.success) {
      worker = r.worker;
      localStorage.setItem('gt_worker', JSON.stringify(worker));
      showApp();
    } else {
      showLoginErr(r.message || 'Invalid name or PIN.');
    }
  } catch { showLoginErr('Connection error. Please try again.'); }
}

function signOut() {
  localStorage.removeItem('gt_worker');
  worker = null; currentEntry = null;
  clearInterval(timerInterval);
  show('login-section'); hide('app-section');
  document.getElementById('inp-name').value = '';
  document.getElementById('inp-pin').value = '';
}

async function showApp() {
  hide('login-section'); show('app-section');
  document.getElementById('hdr-name').textContent = worker.name;
  await loadLocations();
  await refreshStatus();
  await loadHistory();
  await loadWeekHours();
}

async function loadLocations() {
  const locs = await get('/api/locations');
  const sel = document.getElementById('loc-select');
  sel.innerHTML = '<option value="">— Choose a location —</option>';
  locs.forEach(l => sel.insertAdjacentHTML('beforeend',
    `<option value="${l.id}">${esc(l.name)}${l.address ? ' — ' + esc(l.address) : ''}</option>`));
}

async function refreshStatus() {
  const data = await get(`/api/entries/current/${worker.id}`);
  currentEntry = data.entry;
  renderStatus();
}

function renderStatus() {
  clearInterval(timerInterval);
  if (currentEntry) {
    hide('s-out'); show('s-in');
    hide('form-in'); show('form-out');
    document.getElementById('s-loc').textContent = '📍 ' + currentEntry.location_name;
    document.getElementById('s-since').textContent = 'Since ' + fmtTime(currentEntry.clock_in);
    const start = new Date(currentEntry.clock_in).getTime();
    const tick = () => { document.getElementById('s-timer').textContent = fmtElapsed(Date.now() - start); };
    tick(); timerInterval = setInterval(tick, 1000);
  } else {
    show('s-out'); hide('s-in');
    show('form-in'); hide('form-out');
  }
}

async function clockIn() {
  const locationId = document.getElementById('loc-select').value;
  if (!locationId) { showAlert('Please select a location.', 'error'); return; }
  let lat = null, lng = null;
  try { const p = await getGPS(); lat = p.coords.latitude; lng = p.coords.longitude; } catch {}
  const r = await post('/api/entries/clock-in', { workerId: worker.id, locationId, latitude: lat, longitude: lng });
  if (r.success) {
    await refreshStatus(); await loadHistory();
    showAlert('Clocked in!', 'success');
  } else {
    showAlert(r.message || 'Failed to clock in.', 'error');
  }
}

async function clockOut() {
  let lat = null, lng = null;
  try { const p = await getGPS(); lat = p.coords.latitude; lng = p.coords.longitude; } catch {}
  const notes = document.getElementById('out-notes').value.trim();
  const r = await post('/api/entries/clock-out', { workerId: worker.id, latitude: lat, longitude: lng, notes });
  if (r.success) {
    document.getElementById('out-notes').value = '';
    await refreshStatus(); await loadHistory(); await loadWeekHours();
    showAlert(`Clocked out! Worked ${fmtDur(r.entry.duration_minutes)}.`, 'success');
  } else {
    showAlert(r.message || 'Failed.', 'error');
  }
}

async function loadHistory(all = false) {
  const entries = await get(`/api/entries/worker/${worker.id}${all ? '' : '?endDate=' + today()}`);
  const el = document.getElementById('entries-list');
  if (!entries.length) { el.innerHTML = '<div class="table-empty">No entries yet</div>'; return; }
  const shown = all ? entries : entries.slice(0, 10);
  el.innerHTML = shown.map(e => `
    <div class="entry-row">
      <div class="entry-main">
        <div class="entry-loc">${esc(e.location_name)}</div>
        <div class="entry-dur">${e.duration_minutes ? fmtDur(e.duration_minutes) : (e.clock_out ? '0m' : '<span class="badge badge-success">Active</span>')}</div>
      </div>
      <div class="entry-meta">
        <span>${fmtDate(e.clock_in)}</span>
        <span>${fmtTime(e.clock_in)} → ${e.clock_out ? fmtTime(e.clock_out) : 'now'}</span>
        ${e.notes ? `<span>📝 ${esc(e.notes)}</span>` : ''}
      </div>
    </div>`).join('');
}

async function loadWeekHours() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay());
  const start = d.toISOString().split('T')[0];
  const entries = await get(`/api/entries/worker/${worker.id}?startDate=${start}`);
  const mins = entries.reduce((s, e) => s + (e.duration_minutes || 0), 0);
  document.getElementById('week-hours').textContent = fmtDur(mins) || '0m';
}

// Helpers
function getGPS() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) { rej(); return; }
    navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 });
  });
}
function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s/3600)}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;
}
function fmtDur(m) {
  if (!m) return null;
  const h = Math.floor(m/60), min = m%60;
  return h === 0 ? `${min}m` : min === 0 ? `${h}h` : `${h}h ${min}m`;
}
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}) : ''; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}) : ''; }
function today() { return new Date().toISOString().split('T')[0]; }
function pad(n) { return String(n).padStart(2,'0'); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function show(id) { document.getElementById(id).classList.remove('section-hidden'); }
function hide(id) { document.getElementById(id).classList.add('section-hidden'); }
function showLoginErr(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; show('login-error');
  setTimeout(() => hide('login-error'), 5000);
}
function showAlert(msg, type) {
  const el = document.getElementById('app-alert');
  el.className = `alert alert-${type === 'error' ? 'error' : 'success'}`;
  el.textContent = msg; show('app-alert');
  setTimeout(() => hide('app-alert'), 5000);
}
async function get(url) { const r = await fetch(url); return r.json(); }
async function post(url, body) {
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  return r.json();
}
