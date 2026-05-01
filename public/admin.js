let allEntries = [];
let activeWorkers = [];
let allLocations = [];
let currentSprayFilter = 'all';
let MAPBOX_TOKEN = null;
let propertyMap = null;
let drawnItems = null;
let chartHours = null;
let chartTypes = null;

const ADMIN_SEASONAL = [
  { months: [0,1],   label: 'Winter',          tips: ['Dormant oil on trees & shrubs', 'Pre-emergent planning & ordering', 'Client follow-up calls', 'Equipment maintenance'] },
  { months: [2,3,4], label: 'Spring',           tips: ['Pre-emergent herbicide (crabgrass)', 'Round 1 fertilizer application', 'Post-emergent broadleaf control', 'Fire ant bait'] },
  { months: [5,6,7], label: 'Summer',           tips: ['Grub control (June–July)', 'Fungicide if brown patch appears', 'Round 2–3 fertilizer', 'Weed spot treatments'] },
  { months: [8,9],   label: 'Fall',             tips: ['Pre-emergent for winter weeds', 'Round 3–4 fertilizer', 'Aeration & overseeding', 'Broadleaf weed cleanup'] },
  { months: [10,11], label: 'Late Fall/Winter', tips: ['Winterizer fertilizer', 'Final pre-emergent if needed', 'Equipment winterization', 'Schedule spring clients early'] },
];

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
  navigator.clipboard.writeText(window.location.origin)
    .then(() => showAlert('Link copied!', 'success'))
    .catch(() => showAlert('Copy: ' + window.location.origin, 'success'));
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
  try { const cfg = await get('/api/config'); MAPBOX_TOKEN = cfg.mapboxToken; } catch {}
  await Promise.all([
    loadStats(), loadActive(), loadOvertime(), loadCharts(),
    loadWorkers(), loadLocations(), loadClientsAdmin(), loadProductsAdmin(),
    loadReminders(),
  ]);
  setInterval(updateTimers, 1000);
  setInterval(() => {
    if (!document.getElementById('tab-dashboard').classList.contains('section-hidden')) {
      loadStats(); loadActive(); loadOvertime(); loadCharts();
    }
  }, 30000);
}

// ── Tab Navigation ────────────────────────────────

function showTab(btn, tab) {
  ['dashboard','clients','jobs','spray','workers','settings'].forEach(t => {
    document.getElementById('tab-' + t).classList.add('section-hidden');
  });
  document.querySelectorAll('.admin-nav > .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.remove('section-hidden');
  btn.classList.add('active');
  if (tab === 'clients') loadClientsAdmin();
  if (tab === 'spray')   { renderAdminSeasonal(); loadReminders(); loadSpraySchedule(currentSprayFilter); }
  if (tab === 'settings') { loadLocations(); loadProductsAdmin(); }
}

// ── Dashboard ─────────────────────────────────────

async function loadStats() {
  try {
    const s = await get('/api/admin/stats');
    document.getElementById('st-workers').textContent = s.totalWorkers ?? '—';
    document.getElementById('st-active').textContent  = s.clockedIn ?? '—';
    document.getElementById('st-today').textContent   = s.todayHours != null ? s.todayHours + 'h' : '—';
    document.getElementById('st-week').textContent    = s.weekHours  != null ? s.weekHours  + 'h' : '—';
  } catch { ['st-workers','st-active','st-today','st-week'].forEach(id => document.getElementById(id).textContent = '—'); }
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

async function loadOvertime() {
  const workers = await get('/api/admin/overtime');
  const el = document.getElementById('overtime-list');
  if (!workers.length) { el.innerHTML = '<div class="table-empty">No workers found</div>'; return; }
  el.innerHTML = workers.map(w => {
    const hrs = (w.week_minutes / 60).toFixed(1);
    const pct = Math.min(100, Math.round(w.week_minutes / 2400 * 100));
    const badge = w.week_minutes >= 2400
      ? `<span class="badge badge-overtime">OVERTIME ${hrs}h</span>`
      : w.week_minutes >= 2100
        ? `<span class="badge badge-warning-hrs">${hrs}h — near 40h</span>`
        : `<span class="badge badge-gray">${hrs}h</span>`;
    const color = w.week_minutes >= 2400 ? 'var(--red)' : w.week_minutes >= 2100 ? 'var(--amber)' : 'var(--green)';
    return `<div class="active-row">
      <div>
        <div class="active-name">${esc(w.worker_name)}</div>
        <div style="background:var(--gray-200);border-radius:99px;height:5px;width:120px;margin-top:.4rem">
          <div style="background:${color};height:5px;border-radius:99px;width:${pct}%"></div>
        </div>
      </div>
      ${badge}
    </div>`;
  }).join('');
}

async function loadCharts() {
  if (typeof Chart === 'undefined') return;
  const d = new Date();
  const startOfWeek = new Date(d);
  startOfWeek.setDate(d.getDate() - d.getDay());
  const startStr = startOfWeek.toISOString().split('T')[0];
  const endStr = d.toISOString().split('T')[0];

  let entries = [];
  try { entries = await get(`/api/admin/entries?startDate=${startStr}&endDate=${endStr}`); } catch {}

  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayHours = Array(7).fill(0);
  const typeMap = {};
  entries.forEach(e => {
    if (e.duration_minutes) dayHours[new Date(e.clock_in).getDay()] += e.duration_minutes / 60;
    const jt = e.job_type || 'Other';
    typeMap[jt] = (typeMap[jt] || 0) + 1;
  });

  const COLORS = ['#52b788','#2d6a4f','#74c69d','#d97706','#3b82f6','#8b5cf6','#dc2626','#ec4899'];

  const ctxH = document.getElementById('chart-hours');
  if (ctxH) {
    if (chartHours) chartHours.destroy();
    chartHours = new Chart(ctxH, {
      type: 'bar',
      data: {
        labels: DAYS,
        datasets: [{ label: 'Hours', data: dayHours.map(h => +h.toFixed(1)), backgroundColor: '#52b788', borderRadius: 6, borderSkipped: false }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => v + 'h' }, grid: { color: '#f3f4f6' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  const ctxT = document.getElementById('chart-types');
  const emptyEl = document.getElementById('chart-types-empty');
  if (ctxT) {
    if (chartTypes) chartTypes.destroy();
    const types = Object.keys(typeMap);
    if (!types.length) {
      ctxT.style.display = 'none';
      if (emptyEl) emptyEl.classList.remove('section-hidden');
    } else {
      ctxT.style.display = '';
      if (emptyEl) emptyEl.classList.add('section-hidden');
      chartTypes = new Chart(ctxT, {
        type: 'doughnut',
        data: {
          labels: types,
          datasets: [{ data: types.map(t => typeMap[t]), backgroundColor: COLORS.slice(0, types.length), borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8 } } }
        }
      });
    }
  }
}

async function forceClockOut(id, name) {
  if (!confirm(`Clock out ${name}?`)) return;
  const r = await post(`/api/admin/entries/${id}/clock-out`, {});
  if (r.success) { showAlert(`${name} clocked out.`, 'success'); loadActive(); loadStats(); }
}

// ── Jobs Tab ──────────────────────────────────────

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
    const active = !entry.clock_out;
    return `<tr>
      <td>${fmtDate(entry.clock_in)}</td>
      <td><strong>${esc(entry.worker_name)}</strong></td>
      <td>${esc(entry.location_name)}</td>
      <td>${entry.job_type ? `<span class="badge badge-gray">${esc(entry.job_type)}</span>` : '<span class="text-muted">—</span>'}</td>
      <td>${fmtTime(entry.clock_in)}</td>
      <td>${entry.clock_out ? fmtTime(entry.clock_out) : '<span class="badge badge-success">Active</span>'}</td>
      <td>${entry.duration_minutes ? '<strong>' + fmtDur(entry.duration_minutes) + '</strong>' : '—'}</td>
      <td>${entry.notes ? esc(entry.notes) : '<span class="text-muted">—</span>'}</td>
      <td>${active ? `<button class="btn btn-warning btn-sm" onclick="forceClockOut(${entry.id},'${esc(entry.worker_name)}')">Clock Out</button>` : (entry.has_photo ? `<button class="btn btn-outline btn-sm" onclick="viewEntryPhoto(${entry.id})">📷</button>` : '')}</td>
    </tr>`;
  }).join('');
}

function exportCSV() {
  if (!allEntries.length) { showAlert('No entries to export. Apply filters first.', 'warning'); return; }
  const hdr = ['Date','Worker','Location','Job Type','Clock In','Clock Out','Duration (min)','Duration (hrs)','Notes'];
  const rows = allEntries.map(e => [
    fmtDate(e.clock_in), e.worker_name, e.location_name, e.job_type || '',
    fmtDateTime(e.clock_in), e.clock_out ? fmtDateTime(e.clock_out) : '',
    e.duration_minutes || '', e.duration_minutes ? (e.duration_minutes/60).toFixed(2) : '',
    e.notes || ''
  ]);
  downloadCSV([hdr,...rows], `time-entries-${today()}.csv`);
}

async function viewEntryPhoto(id) {
  const data = await get(`/api/entries/${id}/photo`);
  if (!data.photo) { showAlert('No photo for this entry.', 'error'); return; }
  document.getElementById('photo-modal-img').src = data.photo;
  show('photo-modal');
}
function closePModal() { hide('photo-modal'); document.getElementById('photo-modal-img').src = ''; }

// ── Clients Tab ───────────────────────────────────

let clientsList = [];

async function loadClientsAdmin() {
  clientsList = await get('/api/admin/clients');

  // Populate New Spray Job client dropdown
  const nsClient = document.getElementById('ns-client');
  if (nsClient) {
    const opts = clientsList.map(c => `<option value="${c.id}" data-address="${esc(c.address||'')}">${esc(c.name)}</option>`).join('');
    nsClient.innerHTML = '<option value="">— Select client —</option>' + opts;
  }

  renderClientsTable(clientsList);
}

function renderClientsTable(list) {
  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No clients found</td></tr>'; return; }
  tbody.innerHTML = list.map(c => `<tr>
    <td><strong>${esc(c.name)}</strong>${c.notes ? `<br><span class="text-muted" style="font-size:.75rem">${esc(c.notes)}</span>` : ''}</td>
    <td>${c.phone ? esc(c.phone) : '<span class="text-muted">—</span>'}</td>
    <td>${c.address ? esc(c.address) : '<span class="text-muted">—</span>'}</td>
    <td>${c.last_service_date ? fmtDate(c.last_service_date) : '<span class="text-muted">—</span>'}</td>
    <td>${c.next_service_date ? `<span class="badge badge-success">${fmtDateShort(c.next_service_date)}</span>` : '<span class="text-muted">—</span>'}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-outline btn-sm" onclick="showClientHistory(${c.id},'${esc(c.name)}')">History</button>
      <button class="btn btn-outline btn-sm" onclick="openEditClient(${c.id})">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="removeClient(${c.id},'${esc(c.name)}')">Delete</button>
    </td>
  </tr>`).join('');
}

function filterClientList(query) {
  const q = query.toLowerCase();
  const filtered = q ? clientsList.filter(c =>
    c.name.toLowerCase().includes(q) ||
    (c.phone || '').includes(q) ||
    (c.address || '').toLowerCase().includes(q)
  ) : clientsList;
  renderClientsTable(filtered);
}

async function showClientHistory(id, name) {
  const records = await get(`/api/clients/${id}/history`);
  document.getElementById('hist-panel-title').textContent = name + ' — Service History';
  const el = document.getElementById('hist-panel-body');
  if (!records.length) { el.innerHTML = '<div class="table-empty">No service history yet</div>'; }
  else {
    el.innerHTML = records.map(r => `
      <div class="client-hist-row">
        <div class="hist-dot">${(r.category || r.product || '?').slice(0,2).toUpperCase()}</div>
        <div>
          <div class="hist-product">${esc(r.product || r.category || 'Service')}</div>
          <div class="hist-date">${fmtDate(r.applied_at || r.created_at)}${r.worker_name ? ' · ' + esc(r.worker_name) : ''}</div>
          ${r.notes ? `<div class="hist-notes">${esc(r.notes)}</div>` : ''}
        </div>
      </div>`).join('');
  }
  show('client-hist-panel');
  document.getElementById('client-hist-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function addClient() {
  const name    = document.getElementById('nc-name').value.trim();
  const phone   = document.getElementById('nc-phone').value.trim();
  const address = document.getElementById('nc-address').value.trim();
  const notes   = document.getElementById('nc-notes').value.trim();
  if (!name) { showAlert('Name is required.', 'error'); return; }
  const r = await post('/api/clients', { name, phone, address, notes });
  if (r.success) {
    closeModal('m-add-client');
    ['nc-name','nc-phone','nc-address','nc-notes'].forEach(id => document.getElementById(id).value = '');
    loadClientsAdmin();
    showAlert(`Client "${name}" added.`, 'success');
  }
}

function openEditClient(id) {
  const c = clientsList.find(x => x.id === id);
  if (!c) return;
  document.getElementById('ec-id').value = id;
  document.getElementById('ec-name').value = c.name || '';
  document.getElementById('ec-phone').value = c.phone || '';
  document.getElementById('ec-address').value = c.address || '';
  document.getElementById('ec-notes').value = c.notes || '';
  openModal('m-edit-client');
}

async function saveClient() {
  const id      = document.getElementById('ec-id').value;
  const name    = document.getElementById('ec-name').value.trim();
  const phone   = document.getElementById('ec-phone').value.trim();
  const address = document.getElementById('ec-address').value.trim();
  const notes   = document.getElementById('ec-notes').value.trim();
  await put(`/api/clients/${id}`, { name, phone, address, notes });
  closeModal('m-edit-client');
  loadClientsAdmin();
  showAlert('Client updated.', 'success');
}

async function removeClient(id, name) {
  if (!confirm(`Delete client "${name}"? Their job history is kept.`)) return;
  await del(`/api/clients/${id}`);
  loadClientsAdmin();
  showAlert(`Client "${name}" deleted.`, 'success');
}

// ── Spray Schedule Tab ────────────────────────────

async function loadReminders() {
  try {
    const r = await get('/api/admin/spray/reminders');
    const od = document.getElementById('rem-overdue');
    const td = document.getElementById('rem-today');
    const wk = document.getElementById('rem-week');
    if (od) od.textContent = r.overdue ?? 0;
    if (td) td.textContent = r.today   ?? 0;
    if (wk) wk.textContent = r.week    ?? 0;
  } catch {}
}

function filterSpray(type, btn) {
  currentSprayFilter = type;
  document.querySelectorAll('#spray-filter-tabs .filter-tab').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const tabMap = { all: 0, scheduled: 1, overdue: 2, completed: 3 };
    const tabs = document.querySelectorAll('#spray-filter-tabs .filter-tab');
    const idx = tabMap[type];
    if (idx !== undefined && tabs[idx]) tabs[idx].classList.add('active');
    else if (tabs[0]) tabs[0].classList.add('active');
  }
  loadSpraySchedule(type);
}

async function loadSpraySchedule(status) {
  const el = document.getElementById('spray-schedule-list');
  if (!el) return;
  el.innerHTML = '<div class="table-empty">Loading…</div>';
  try {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.set('status', status);
    const records = await get('/api/admin/spray/schedule?' + params);
    if (!records.length) {
      el.innerHTML = '<div class="table-empty">No jobs found</div>'; return;
    }
    el.innerHTML = records.map(r => {
      const disp = sprayDisplayStatus(r);
      const due = r.scheduled_date ? fmtDateShort(r.scheduled_date) : '—';
      return `<div class="spray-job-row">
        <div class="spray-job-main">
          <div class="spray-job-client">${esc(r.client_name || '—')}</div>
          <div class="spray-job-meta">
            ${r.category ? `<span class="badge badge-gray">${esc(r.category)}</span>` : ''}
            ${r.product ? `<span style="font-size:.78rem;color:var(--gray-500)">${esc(r.product)}</span>` : ''}
          </div>
          ${r.client_address ? `<div class="spray-job-addr">📍 ${esc(r.client_address)}</div>` : ''}
          ${r.notes ? `<div class="spray-job-addr">📝 ${esc(r.notes)}</div>` : ''}
        </div>
        <div class="spray-job-right">
          <span class="badge ${disp.cls}">${disp.label}</span>
          <div class="spray-job-date">${due}</div>
          ${r.worker_name ? `<div style="font-size:.75rem;color:var(--gray-500)">${esc(r.worker_name)}</div>` : ''}
          ${r.status !== 'completed' ? `<button class="btn btn-primary btn-sm" style="margin-top:.35rem" onclick="markSprayComplete(${r.id})">✓ Done</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="table-empty">Error loading schedule</div>';
  }
}

function sprayDisplayStatus(r) {
  if (r.status === 'completed') return { label: 'Completed', cls: 'badge-completed' };
  if (r.scheduled_date && new Date(r.scheduled_date + 'T12:00:00') < new Date())
    return { label: 'Overdue', cls: 'badge-overdue' };
  return { label: 'Scheduled', cls: 'badge-scheduled' };
}

async function markSprayComplete(id) {
  await put(`/api/admin/spray/${id}/status`, { status: 'completed' });
  loadSpraySchedule(currentSprayFilter);
  loadReminders();
  showAlert('Marked as complete.', 'success');
}

async function createSprayJob() {
  const clientId   = document.getElementById('ns-client').value;
  const clientOpt  = document.getElementById('ns-client').selectedOptions[0];
  const clientName = clientOpt?.text || '';
  const address    = document.getElementById('ns-address').value.trim();
  const category   = document.getElementById('ns-category').value;
  const product    = document.getElementById('ns-product').value.trim();
  const date       = document.getElementById('ns-date').value;
  const workerId   = document.getElementById('ns-worker').value;
  const notes      = document.getElementById('ns-notes').value.trim();

  if (!clientId && !clientName) { showAlert('Select a client.', 'error'); return; }

  const client = clientsList.find(c => c.id == clientId);
  const r = await post('/api/admin/spray/schedule', {
    clientId:      clientId || null,
    clientName:    client?.name || clientName,
    clientPhone:   client?.phone || null,
    clientAddress: address || client?.address || null,
    category, product, scheduledDate: date || null,
    workerId: workerId || null, notes,
  });
  if (r.success) {
    closeModal('m-new-spray');
    ['ns-address','ns-product','ns-notes','ns-date'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('ns-client').value = '';
    document.getElementById('ns-category').value = '';
    document.getElementById('ns-worker').value = '';
    loadSpraySchedule(currentSprayFilter);
    loadReminders();
    showAlert('Spray job scheduled.', 'success');
  }
}

function autoFillSprayAddress() {
  const sel = document.getElementById('ns-client');
  const opt = sel?.selectedOptions[0];
  const addr = opt?.getAttribute('data-address') || '';
  document.getElementById('ns-address').value = addr;
}

function renderAdminSeasonal() {
  const month = new Date().getMonth();
  const season = ADMIN_SEASONAL.find(s => s.months.includes(month));
  const el = document.getElementById('admin-seasonal-prompt');
  if (!season || !el) return;
  el.innerHTML = `<h4>🗓 ${season.label} — This Month's Priorities</h4>
    <p>${season.tips.join(' &nbsp;·&nbsp; ')}</p>`;
}

// ── Products (Settings Tab) ───────────────────────

let productsList = [];

async function loadProductsAdmin() {
  productsList = await get('/api/spray/products');
  const tbody = document.getElementById('products-tbody');
  if (!tbody) return;
  if (!productsList.length) { tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No products yet</td></tr>'; return; }
  tbody.innerHTML = productsList.map(p => `<tr>
    <td><strong>${esc(p.name)}</strong></td>
    <td>${p.type ? `<span class="badge badge-gray">${esc(p.type)}</span>` : '—'}</td>
    <td>${p.reapply_min_days ? `${p.reapply_min_days}–${p.reapply_max_days||p.reapply_min_days} days` : '<span class="text-muted">—</span>'}</td>
    <td>${p.notes ? esc(p.notes) : '<span class="text-muted">—</span>'}</td>
    <td>
      <button class="btn btn-outline btn-sm" onclick="openEditProduct(${p.id})">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="removeProduct(${p.id},'${esc(p.name)}')">Delete</button>
    </td>
  </tr>`).join('');
}

async function addProduct() {
  const name  = document.getElementById('np-name').value.trim();
  const type  = document.getElementById('np-type').value;
  const rmin  = parseInt(document.getElementById('np-rmin').value) || null;
  const rmax  = parseInt(document.getElementById('np-rmax').value) || null;
  const notes = document.getElementById('np-notes').value.trim();
  if (!name) { showAlert('Product name is required.', 'error'); return; }
  const r = await post('/api/spray/products', { name, type, notes, reapplyMin: rmin, reapplyMax: rmax });
  if (r.success) {
    closeModal('m-add-product');
    ['np-name','np-type','np-rmin','np-rmax','np-notes'].forEach(id => document.getElementById(id).value = '');
    loadProductsAdmin();
    showAlert(`Product "${name}" added.`, 'success');
  }
}

function openEditProduct(id) {
  const p = productsList.find(x => x.id === id);
  if (!p) return;
  document.getElementById('ep-id').value = id;
  document.getElementById('ep-name').value = p.name || '';
  document.getElementById('ep-type').value = p.type || '';
  document.getElementById('ep-rmin').value = p.reapply_min_days || '';
  document.getElementById('ep-rmax').value = p.reapply_max_days || '';
  document.getElementById('ep-notes').value = p.notes || '';
  openModal('m-edit-product');
}

async function saveProduct() {
  const id    = document.getElementById('ep-id').value;
  const name  = document.getElementById('ep-name').value.trim();
  const type  = document.getElementById('ep-type').value;
  const rmin  = parseInt(document.getElementById('ep-rmin').value) || null;
  const rmax  = parseInt(document.getElementById('ep-rmax').value) || null;
  const notes = document.getElementById('ep-notes').value.trim();
  await put(`/api/spray/products/${id}`, { name, type, notes, reapplyMin: rmin, reapplyMax: rmax });
  closeModal('m-edit-product');
  loadProductsAdmin();
  showAlert('Product updated.', 'success');
}

async function removeProduct(id, name) {
  if (!confirm(`Delete product "${name}"?`)) return;
  await del(`/api/spray/products/${id}`);
  loadProductsAdmin();
  showAlert(`Product "${name}" deleted.`, 'success');
}

// ── Workers Tab ───────────────────────────────────

async function loadWorkers() {
  const workers = await get('/api/admin/workers');
  const opts = workers.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  document.getElementById('f-worker').innerHTML = '<option value="">All Workers</option>' + opts;

  // Populate New Spray Job worker dropdown
  const nsWorker = document.getElementById('ns-worker');
  if (nsWorker) nsWorker.innerHTML = '<option value="">— Worker —</option>' + opts;

  const tbody = document.getElementById('workers-tbody');
  if (!workers.length) { tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No workers yet</td></tr>'; return; }
  tbody.innerHTML = workers.map(w => `
    <tr>
      <td><strong>${esc(w.name)}</strong></td>
      <td><span class="badge badge-gray">Hidden</span></td>
      <td>
        ${w.spray_access
          ? `<span class="badge badge-success">✓ Enabled</span>
             <button class="btn btn-outline btn-sm" style="margin-left:.4rem" onclick="toggleSprayAccess(${w.id},'${esc(w.name)}',true)">Revoke</button>`
          : `<span class="badge badge-gray">Off</span>
             <button class="btn btn-primary btn-sm" style="margin-left:.4rem" onclick="toggleSprayAccess(${w.id},'${esc(w.name)}',false)">Grant</button>`
        }
      </td>
      <td>${fmtDate(w.created_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="openEditWorker(${w.id},'${esc(w.name)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="removeWorker(${w.id},'${esc(w.name)}')">Remove</button>
      </td>
    </tr>`).join('');
}

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

async function toggleSprayAccess(id, name, currentValue) {
  const newValue = !currentValue;
  if (!confirm(`${newValue ? 'Grant' : 'Revoke'} spray access for "${name}"?`)) return;
  await put(`/api/admin/workers/${id}/spray-access`, { spray_access: newValue });
  loadWorkers();
  showAlert(`Spray access ${newValue ? 'granted to' : 'revoked from'} "${name}".`, 'success');
}

// ── Locations (Settings Tab) ──────────────────────

async function loadLocations() {
  const locs = await get('/api/locations');
  allLocations = locs;
  const opts = locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  document.getElementById('f-location').innerHTML = '<option value="">All Locations</option>' + opts;
  const tbody = document.getElementById('locations-tbody');
  if (!tbody) return;
  if (!locs.length) { tbody.innerHTML = '<tr><td colspan="3" class="table-empty">No locations yet</td></tr>'; return; }
  tbody.innerHTML = locs.map(l => {
    const hasPolygon  = l.polygon && l.polygon.length >= 3;
    const hasGeofence = l.geofence_lat && l.geofence_lng;
    const geofenceBadge = hasPolygon
      ? `<span class="badge badge-success">✓ Property lines</span>`
      : hasGeofence
        ? `<span class="badge badge-success">✓ ${l.geofence_radius || 150}m radius</span>`
        : `<span class="text-muted">Not set</span>`;
    return `<tr>
      <td><strong>${esc(l.name)}</strong>${l.address ? `<br><span class="text-muted" style="font-size:.75rem">${esc(l.address)}</span>` : ''}</td>
      <td>${geofenceBadge}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="openMapModal(${l.id})">🗺 Draw</button>
        <button class="btn btn-outline btn-sm" onclick="openGeofenceModal(${l.id},'${esc(l.name)}',${l.geofence_lat||'null'},${l.geofence_lng||'null'},${l.geofence_radius||150})">📍 Radius</button>
        <button class="btn btn-danger btn-sm" onclick="removeLocation(${l.id},'${esc(l.name)}')">Remove</button>
      </td>
    </tr>`;
  }).join('');
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

// ── Map / Geofence ────────────────────────────────

function openMapModal(id) {
  const loc = allLocations.find(l => l.id === id);
  if (!loc) return;
  document.getElementById('map-loc-id').value = id;
  document.getElementById('map-loc-name').textContent = loc.name;
  document.getElementById('map-search').value = '';
  document.getElementById('m-property-map').classList.add('open');
  setTimeout(() => {
    if (propertyMap) { propertyMap.remove(); propertyMap = null; }
    const center = loc.geofence_lat && loc.geofence_lng ? [loc.geofence_lat, loc.geofence_lng] : [39.5, -98.35];
    propertyMap = L.map('property-map').setView(center, loc.geofence_lat ? 19 : 4);
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`, {
      attribution: '© <a href="https://mapbox.com">Mapbox</a>', maxZoom: 22, tileSize: 256,
    }).addTo(propertyMap);
    drawnItems = new L.FeatureGroup().addTo(propertyMap);
    if (loc.polygon && loc.polygon.length >= 3) {
      const poly = L.polygon(loc.polygon, { color: '#1f8f3a', fillOpacity: 0.25 });
      drawnItems.addLayer(poly);
      propertyMap.fitBounds(poly.getBounds(), { padding: [30, 30] });
    }
    new L.Control.Draw({
      draw: {
        polygon: { shapeOptions: { color: '#1f8f3a', fillOpacity: 0.25 }, allowIntersection: false },
        polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false,
      },
      edit: { featureGroup: drawnItems },
    }).addTo(propertyMap);
    propertyMap.on(L.Draw.Event.CREATED, e => { drawnItems.clearLayers(); drawnItems.addLayer(e.layer); });
  }, 150);
}

async function searchMapAddress() {
  const q = document.getElementById('map-search').value.trim();
  if (!q || !MAPBOX_TOKEN || !propertyMap) return;
  try {
    const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=1`);
    const d = await r.json();
    if (d.features && d.features.length) {
      const [lng, lat] = d.features[0].center;
      propertyMap.setView([lat, lng], 19);
    } else { showAlert('Address not found.', 'error'); }
  } catch { showAlert('Search failed.', 'error'); }
}

function closeMapModal() {
  document.getElementById('m-property-map').classList.remove('open');
  if (propertyMap) { propertyMap.remove(); propertyMap = null; }
  drawnItems = null;
}

function clearMapPolygon() { if (drawnItems) drawnItems.clearLayers(); }

async function savePolygon() {
  const id = document.getElementById('map-loc-id').value;
  let polygon = null;
  drawnItems.eachLayer(layer => {
    if (layer instanceof L.Polygon) polygon = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
  });
  await put(`/api/admin/locations/${id}/polygon`, { polygon });
  closeMapModal(); loadLocations();
  showAlert(polygon ? 'Property boundary saved.' : 'Property boundary cleared.', 'success');
}

function openGeofenceModal(id, name, lat, lng, radius) {
  document.getElementById('gf-loc-id').value = id;
  document.getElementById('gf-loc-name').textContent = name;
  document.getElementById('gf-lat').value = lat || '';
  document.getElementById('gf-lng').value = lng || '';
  document.getElementById('gf-radius').value = radius || 150;
  document.getElementById('gf-location-status').textContent = '';
  document.getElementById('gf-clear-btn').style.display = (lat && lng) ? '' : 'none';
  openModal('m-set-geofence');
}

function useMyLocationForGeofence() {
  const status = document.getElementById('gf-location-status');
  status.textContent = 'Getting location…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById('gf-lat').value = pos.coords.latitude.toFixed(6);
      document.getElementById('gf-lng').value = pos.coords.longitude.toFixed(6);
      status.textContent = `Accuracy: ±${Math.round(pos.coords.accuracy)}m`;
    },
    () => { status.textContent = 'Location unavailable.'; },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

async function saveGeofence() {
  const id = document.getElementById('gf-loc-id').value;
  const lat = parseFloat(document.getElementById('gf-lat').value);
  const lng = parseFloat(document.getElementById('gf-lng').value);
  const radius = parseInt(document.getElementById('gf-radius').value) || 150;
  if (!lat || !lng) { showAlert('Enter coordinates or use "Use My Location".', 'error'); return; }
  await put(`/api/admin/locations/${id}`, { geofence_lat: lat, geofence_lng: lng, geofence_radius: radius });
  closeModal('m-set-geofence'); loadLocations();
  showAlert('Geofence saved.', 'success');
}

async function clearGeofence() {
  const id = document.getElementById('gf-loc-id').value;
  const name = document.getElementById('gf-loc-name').textContent;
  if (!confirm(`Remove geofence from "${name}"?`)) return;
  await put(`/api/admin/locations/${id}`, { geofence_lat: null, geofence_lng: null, geofence_radius: null });
  closeModal('m-set-geofence'); loadLocations();
  showAlert('Geofence removed.', 'success');
}

// ── Settings ──────────────────────────────────────

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

// ── Modals ────────────────────────────────────────

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ── Utilities ─────────────────────────────────────

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
function fmtDateShort(iso) { return iso ? new Date(iso + 'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric'}) : ''; }
function fmtDateTime(iso) { const d = new Date(iso); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString(); }
function today() { return new Date().toISOString().split('T')[0]; }
function pad(n) { return String(n).padStart(2,'0'); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function show(id) { const el=document.getElementById(id); if(el) el.classList.remove('section-hidden'); }
function hide(id) { const el=document.getElementById(id); if(el) el.classList.add('section-hidden'); }
function showAlert(msg, type) {
  const el = document.getElementById('admin-alert');
  el.className = `alert alert-${type==='error'?'error':type==='warning'?'warning':'success'}`;
  el.textContent = msg; show('admin-alert');
  setTimeout(() => hide('admin-alert'), 5000);
}
function showModalErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; show(id); }
}
function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})),
    download: filename
  });
  a.click();
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
