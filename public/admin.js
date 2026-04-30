let allEntries = [];
let activeWorkers = [];

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('gt_admin') === 'true') showAdminApp();
  document.getElementById('admin-pw').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
  const now = new Date();
  document.getElementById('f-end').value = now.toISOString().split('T')[0];
  now.setDate(now.getDate() - 6);
  document.getElementById('f-start').value = now.toISOString().split('T')[0];
  document.getElementById('app-url').value = window.location.origin;
});

function copyAppUrl() {
  const url = window.location.origin;
  navigator.clipboard.writeText(url)
    .then(() => showAlert('Link copied to clipboard!', 'success'))
    .catch(() => showAlert('Copy this link: ' + url, 'success'));
}

async function adminLogin() {
  const password = document.getElementById('admin-pw').value;
  const r = await post('/api/admin/auth', { password });
  if (r.success) {
    localStorage.setItem('gt_admin', 'true');
    showAdminApp();
  } else {
    const el = document.getElementById('admin-login-err');
    el.textContent = r.message || 'Invalid password.';
    show('admin-login-err');
  }
}

function adminSignOut() {
  localStorage.removeItem('gt_admin');
  hide('admin-app'); show('admin-login');
  document.getElementById('admin-pw').value = '';
}

async function showAdminApp() {
  hide('admin-login'); show('admin-app');
  await Promise.all([loadStats(), loadActive(), loadWorkers(), loadLocations()]);
  setInterval(updateTimers, 1000);
  setInterval(() => { if (!document.getElementById('tab-dashboard').classList.contains('section-hidden')) { loadStats(); loadActive(); } }, 30000);
}

function showTab(btn, tab) {
  ['dashboard','entries','workers','locations','settings'].forEach(t => {
    document.getElementById('tab-' + t).classList.add('section-hidden');
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.remove('section-hidden');
  btn.classList.add('active');
  if (tab === 'entries') loadEntries();
}

async function loadStats() {
  const s = await get('/api/admin/stats');
  document.getElementById('st-workers').textContent = s.totalWorkers;
  document.getElementById('st-active').textContent  = s.clockedIn;
  document.getElementById('st-today').textContent   = s.todayHours + 'h';
  document.getElementById('st-week').textContent    = s.weekHours + 'h';
}

async function loadActive() {
  activeWorkers = await get('/api/admin/active');
  const el = document.getElementById('active-list');
  if (!activeWorkers.length) {
    el.innerHTML = '<div class="table-empty">No workers currently clocked in</div>'; return;
  }
  el.innerHTML = activeWorkers.map(w => `
    <div class="active-row">
      <div>
        <div class="active-name"><span class="status-dot on"></span>${esc(w.worker_name)}</div>
        <div class="active-detail">📍 ${esc(w.location_name)} · Since ${fmtTime(w.clock_in)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:.6rem">
        <div class="active-timer" id="atimer-${w.id}">${fmtElapsed(Date.now()-new Date(w.clock_in).getTime())}</div>
        <button class="btn btn-warning btn-sm" onclick="forceClockOut(${w.id},'${esc(w.worker_name)}')">Clock Out</button>
      </div>
    </div>`).join('');
}

function updateTimers() {
  activeWorkers.forEach(w => {
    const el = document.getElementById('atimer-' + w.id);
    if (el) el.textContent = fmtElapsed(Date.now() - new Date(w.clock_in).getTime());
  });
}

async function forceClockOut(id, name) {
  if (!confirm(`Clock out ${name}?`)) return;
  const r = await post(`/api/admin/entries/${id}/clock-out`, {});
  if (r.success) { showAlert(`${name} clocked out.`, 'success'); loadActive(); loadStats(); }
}

async function loadWorkers() {
  const workers = await get('/api/admin/workers');
  const fSel = document.getElementById('f-worker');
  fSel.innerHTML = '<option value="">All Workers</option>' +
    workers.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  const tbody = document.getElementById('workers-tbody');
  if (!workers.length) { tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No workers yet</td></tr>'; return; }
  tbody.innerHTML = workers.map(w => `
    <tr>
      <td><strong>${esc(w.name)}</strong></td>
      <td><span class="badge badge-gray">Hidden</span></td>
      <td>${fmtDate(w.created_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="openEditWorker(${w.id},'${esc(w.name)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="removeWorker(${w.id},'${esc(w.name)}')">Remove</button>
      </td>
    </tr>`).join('');
}

async function loadLocations() {
  const locs = await get('/api/locations');
  const fSel = document.getElementById('f-location');
  fSel.innerHTML = '<option value="">All Locations</option>' +
    locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  const tbody = document.getElementById('locations-tbody');
  if (!locs.length) { tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No locations yet</td></tr>'; return; }
  tbody.innerHTML = locs.map(l => `
    <tr>
      <td><strong>${esc(l.name)}</strong></td>
      <td>${l.address ? esc(l.address) : '<span class="text-muted">—</span>'}</td>
      <td>${fmtDate(l.created_at)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="removeLocation(${l.id},'${esc(l.name)}')">Remove</button></td>
    </tr>`).join('');
}

async function loadEntries() {
  const params = new URLSearchParams();
  const w = document.getElementById('f-worker').value;
  const l = document.getElementById('f-location').value;
  const s = document.getElementById('f-start').value;
  const e = document.getElementById('f-end').value;
  if (w) params.set('workerId', w);
  if (l) params.set('locationId', l);
  if (s) params.set('startDate', s);
  if (e) params.set('endDate', e);
  allEntries = await get('/api/admin/entries?' + params);
  const tbody = document.getElementById('entries-tbody');
  if (!allEntries.length) { tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No entries found</td></tr>'; return; }
  tbody.innerHTML = allEntries.map(entry => {
    const hasGPS = entry.clock_in_lat && entry.clock_in_lng;
    const gps = hasGPS
      ? `<a href="https://maps.google.com/?q=${entry.clock_in_lat},${entry.clock_in_lng}" target="_blank" class="badge badge-success">📍 Map</a>`
      : '<span class="text-muted">—</span>';
    const active = !entry.clock_out;
    return `<tr>
      <td>${fmtDate(entry.clock_in)}</td>
      <td><strong>${esc(entry.worker_name)}</strong></td>
      <td>${esc(entry.location_name)}</td>
      <td>${fmtTime(entry.clock_in)}</td>
      <td>${entry.clock_out ? fmtTime(entry.clock_out) : '<span class="badge badge-success">Active</span>'}</td>
      <td>${entry.duration_minutes ? '<strong>' + fmtDur(entry.duration_minutes) + '</strong>' : '<span class="text-muted">—</span>'}</td>
      <td>${gps}</td>
      <td>${entry.notes ? esc(entry.notes) : '<span class="text-muted">—</span>'}</td>
      <td>${active ? `<button class="btn btn-warning btn-sm" onclick="forceClockOut(${entry.id},'${esc(entry.worker_name)}')">Clock Out</button>` : ''}</td>
    </tr>`;
  }).join('');
}

function exportCSV() {
  if (!allEntries.length) { showAlert('No entries to export. Apply filters first.', 'warning'); return; }
  const hdr = ['Date','Worker','Location','Clock In','Clock Out','Duration (min)','Duration (hrs)','GPS Lat','GPS Lng','Notes'];
  const rows = allEntries.map(e => [
    fmtDate(e.clock_in), e.worker_name, e.location_name,
    fmtDateTime(e.clock_in), e.clock_out ? fmtDateTime(e.clock_out) : '',
    e.duration_minutes || '', e.duration_minutes ? (e.duration_minutes/60).toFixed(2) : '',
    e.clock_in_lat || '', e.clock_in_lng || '', e.notes || ''
  ]);
  const csv = [hdr,...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})),
    download: `greentrack-${new Date().toISOString().split('T')[0]}.csv`
  });
  a.click();
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

async function addWorker() {
  const name = document.getElementById('nw-name').value.trim();
  const pin  = document.getElementById('nw-pin').value.trim();
  if (!name || !pin) { showModalErr('add-worker-err','Name and PIN required.'); return; }
  const r = await post('/api/admin/workers', { name, pin });
  if (r.success) {
    closeModal('m-add-worker');
    document.getElementById('nw-name').value = '';
    document.getElementById('nw-pin').value = '';
    loadWorkers(); loadStats();
    showAlert(`Worker "${name}" added.`, 'success');
  } else {
    showModalErr('add-worker-err', r.message || 'Failed.');
  }
}

function openEditWorker(id, name) {
  document.getElementById('ew-id').value = id;
  document.getElementById('ew-name').value = name;
  document.getElementById('ew-pin').value = '';
  openModal('m-edit-worker');
}

async function saveWorker() {
  const id   = document.getElementById('ew-id').value;
  const name = document.getElementById('ew-name').value.trim();
  const pin  = document.getElementById('ew-pin').value.trim();
  await put(`/api/admin/workers/${id}`, { name, pin });
  closeModal('m-edit-worker');
  loadWorkers();
  showAlert('Worker updated.', 'success');
}

async function removeWorker(id, name) {
  if (!confirm(`Remove worker "${name}"? Their time history is kept.`)) return;
  await del(`/api/admin/workers/${id}`);
  loadWorkers(); loadStats();
  showAlert(`Worker "${name}" removed.`, 'success');
}

async function addLocation() {
  const name = document.getElementById('nl-name').value.trim();
  const addr = document.getElementById('nl-addr').value.trim();
  if (!name) return;
  await post('/api/admin/locations', { name, address: addr });
  closeModal('m-add-location');
  document.getElementById('nl-name').value = '';
  document.getElementById('nl-addr').value = '';
  loadLocations();
  showAlert(`Location "${name}" added.`, 'success');
}

async function removeLocation(id, name) {
  if (!confirm(`Remove location "${name}"?`)) return;
  await del(`/api/admin/locations/${id}`);
  loadLocations();
  showAlert(`Location "${name}" removed.`, 'success');
}

async function changePassword() {
  const np = document.getElementById('new-pw').value;
  const cp = document.getElementById('confirm-pw').value;
  if (!np) { showAlert('Enter a new password.', 'error'); return; }
  if (np !== cp) { showAlert('Passwords do not match.', 'error'); return; }
  const r = await put('/api/admin/settings/password', { password: np });
  if (r.success) {
    document.getElementById('new-pw').value = '';
    document.getElementById('confirm-pw').value = '';
    showAlert('Password updated.', 'success');
  }
}

function fmtElapsed(ms) {
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
function fmtDur(m) {
  if (!m) return '—';
  const h = Math.floor(m/60), min = m%60;
  return h === 0 ? `${min}m` : min === 0 ? `${h}h` : `${h}h ${min}m`;
}
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}) : ''; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString([],{month:'short',day:'numeric',year:'numeric'}) : ''; }
function fmtDateTime(iso) { const d = new Date(iso); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString(); }
function pad(n) { return String(n).padStart(2,'0'); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function show(id) { document.getElementById(id).classList.remove('section-hidden'); }
function hide(id) { document.getElementById(id).classList.add('section-hidden'); }
function showAlert(msg, type) {
  const el = document.getElementById('admin-alert');
  el.className = `alert alert-${type==='error'?'error':type==='warning'?'warning':'success'}`;
  el.textContent = msg; show('admin-alert');
  setTimeout(() => hide('admin-alert'), 5000);
}
function showModalErr(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg; show(id);
}

async function get(url) { const r = await fetch(url); return r.json(); }
async function post(url, body) {
  const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}
async function put(url, body) {
  const r = await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}
async function del(url) {
  const r = await fetch(url,{method:'DELETE'});
  return r.json();
}
