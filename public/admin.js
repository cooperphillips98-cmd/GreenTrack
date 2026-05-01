let allEntries = [];
let activeWorkers = [];
let allLocations = [];
let allSprayJobs = [];
let allUpcoming = [];
let MAPBOX_TOKEN = null;
let propertyMap = null;
let drawnItems = null;
let chartHours = null;
let chartTypes = null;

const ADMIN_SEASONAL = [
  { months: [0,1],   label: 'Winter',       tips: ['Dormant oil on trees & shrubs', 'Pre-emergent planning & ordering', 'Client follow-up calls', 'Equipment maintenance'] },
  { months: [2,3,4], label: 'Spring',        tips: ['Pre-emergent herbicide (crabgrass)', 'Round 1 fertilizer application', 'Post-emergent broadleaf control', 'Fire ant bait'] },
  { months: [5,6,7], label: 'Summer',        tips: ['Grub control (June–July)', 'Fungicide if brown patch appears', 'Round 2–3 fertilizer', 'Weed spot treatments'] },
  { months: [8,9],   label: 'Fall',          tips: ['Pre-emergent for winter weeds', 'Round 3–4 fertilizer', 'Aeration & overseeding', 'Broadleaf weed cleanup'] },
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
  const url = window.location.origin;
  navigator.clipboard.writeText(url)
    .then(() => showAlert('Link copied!', 'success'))
    .catch(() => showAlert('Copy: ' + url, 'success'));
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
  await Promise.allSettled([loadStats(), loadActive(), loadOvertime(), loadCharts(), loadWorkers(), loadLocations(), loadClientsAdmin(), loadProductsAdmin()]);
  setInterval(updateTimers, 1000);
  setInterval(() => {
    if (!document.getElementById('tab-dashboard').classList.contains('section-hidden')) {
      loadStats(); loadActive(); loadOvertime(); loadCharts();
    }
  }, 30000);
}

// ── Main Tab Navigation ───────────────────────────

function showTab(btn, tab) {
  ['dashboard','entries','spraying','workers','locations','settings'].forEach(t => {
    const el = document.getElementById('tab-' + t); if (el) el.classList.add('section-hidden');
  });
  document.querySelectorAll('.admin-nav > .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.remove('section-hidden');
  btn.classList.add('active');
  if (tab === 'entries')  loadEntries();
  if (tab === 'spraying') { renderAdminSeasonal(); loadAdminUpcoming(); loadClientsAdmin(); loadProductsAdmin(); }
}

// ── Spray Sub-Nav ─────────────────────────────────

function showSpraySection(btn, section) {
  ['spray-overview','spray-add-job','spray-jobs','spray-clients','spray-products','spray-followups'].forEach(s => {
    const el = document.getElementById(s); if (el) el.classList.add('section-hidden');
  });
  document.querySelectorAll('#tab-spraying .admin-nav .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(section).classList.remove('section-hidden');
  btn.classList.add('active');
  if (section === 'spray-overview')  { renderAdminSeasonal(); loadAdminUpcoming(); }
  if (section === 'spray-add-job')   { const d = document.getElementById('aj-date'); if (d && !d.value) d.value = today(); }
  if (section === 'spray-jobs')      loadSprayJobs();
  if (section === 'spray-clients')   loadClientsAdmin();
  if (section === 'spray-products')  loadProductsAdmin();
  if (section === 'spray-followups') loadFollowUps();
}

async function addSprayJob() {
  const workerId      = document.getElementById('aj-worker').value;
  const clientName    = document.getElementById('aj-client-name').value.trim();
  const clientPhone   = document.getElementById('aj-client-phone').value.trim();
  const clientAddress = document.getElementById('aj-address').value.trim();
  const category      = document.getElementById('aj-service').value;
  const product       = document.getElementById('aj-product').value.trim();
  const dateVal       = document.getElementById('aj-date').value;
  const startTime     = document.getElementById('aj-start-time').value;
  const nextServiceDate = document.getElementById('aj-next-date').value || null;
  const notes         = document.getElementById('aj-notes').value.trim();

  if (!workerId) { showAlert('Please select an employee.', 'error'); return; }
  if (!category) { showAlert('Please select a service type.', 'error'); return; }
  if (!product)  { showAlert('Please enter a product name.', 'error'); return; }

  const appliedAt = dateVal
    ? (startTime ? new Date(`${dateVal}T${startTime}`).toISOString() : new Date(dateVal + 'T12:00:00').toISOString())
    : new Date().toISOString();

  const r = await post('/api/spray/records', {
    workerId, clientName, clientPhone, clientAddress, product, category, appliedAt, notes, nextServiceDate
  });

  if (r.success) {
    ['aj-client-name','aj-client-phone','aj-address','aj-product','aj-start-time','aj-end-time','aj-next-date','aj-notes'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('aj-service').value = '';
    document.getElementById('aj-worker').value = '';
    showAlert('Spray job saved!', 'success');
  } else {
    showAlert(r.message || 'Failed to save.', 'error');
  }
}

async function loadFollowUps() {
  const data = await get('/api/admin/spray?upcoming=true');
  const el = document.getElementById('followups-list');
  if (!data.length) { el.innerHTML = '<div class="table-empty">No upcoming follow-ups in the next 30 days</div>'; return; }
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Due Date</th><th>Status</th><th>Client</th><th>Address</th><th>Service</th><th>Product</th><th>Worker</th></tr></thead>
    <tbody>${data.map(r => {
      const due = new Date(r.next_service_date + 'T12:00:00'); due.setHours(0,0,0,0);
      const diff = Math.round((due - todayDate) / 86400000);
      const status = diff < 0 ? 'Overdue' : diff === 0 ? 'Due Today' : diff <= 7 ? 'Due Soon' : 'Upcoming';
      const cls = diff < 0 ? 'badge-overtime' : diff <= 7 ? 'badge-warning-hrs' : 'badge-success';
      return `<tr>
        <td>${fmtDateShort(r.next_service_date)}</td>
        <td><span class="badge ${cls}">${status}</span></td>
        <td><strong>${esc(r.client_name||'—')}</strong>${r.client_phone?`<br><span class="text-muted" style="font-size:.75rem">${esc(r.client_phone)}</span>`:''}</td>
        <td>${esc(r.client_address||r.location_name||'—')}</td>
        <td>${r.category?`<span class="badge badge-gray">${esc(r.category)}</span>`:'—'}</td>
        <td>${esc(r.product||'—')}</td>
        <td>${esc(r.worker_name)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
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
    if (e.duration_minutes) {
      dayHours[new Date(e.clock_in).getDay()] += e.duration_minutes / 60;
    }
    const jt = e.job_type || 'Other';
    typeMap[jt] = (typeMap[jt] || 0) + 1;
  });

  const COLORS = ['#52b788','#2d6a4f','#74c69d','#d97706','#3b82f6','#8b5cf6','#dc2626','#ec4899'];

  // Hours bar chart
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

  // Job type doughnut chart
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

// ── Time Entries ──────────────────────────────────

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
      <td>${entry.duration_minutes ? '<strong>' + fmtDur(entry.duration_minutes) + '</strong>' : '—'}</td>
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
  downloadCSV([hdr,...rows], `time-entries-${today()}.csv`);
}

// ── Spraying: Overview ────────────────────────────

function renderAdminSeasonal() {
  const month = new Date().getMonth();
  const season = ADMIN_SEASONAL.find(s => s.months.includes(month));
  const el = document.getElementById('admin-seasonal-prompt');
  if (!season || !el) return;
  el.innerHTML = `<h3>🗓 ${season.label} — Recommended Services This Month</h3>
    <ul>${season.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

async function loadAdminUpcoming() {
  allUpcoming = await get('/api/admin/spray?upcoming=true');
  const el = document.getElementById('admin-upcoming-list');
  if (!allUpcoming.length) { el.innerHTML = '<div class="table-empty">No upcoming follow-ups in the next 30 days</div>'; return; }
  const today = new Date(); today.setHours(0,0,0,0);
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Due Date</th><th>Status</th><th>Client</th><th>Address</th><th>Service</th><th>Product</th><th>Worker</th></tr></thead>
    <tbody>${allUpcoming.map(r => {
      const due = new Date(r.next_service_date + 'T12:00:00');
      due.setHours(0,0,0,0);
      const diff = Math.round((due - today) / 86400000);
      const status = diff < 0 ? 'Overdue' : diff === 0 ? 'Due Today' : diff <= 7 ? 'Due Soon' : 'Upcoming';
      const badgeCls = diff < 0 ? 'badge-overtime' : diff <= 7 ? 'badge-warning-hrs' : 'badge-success';
      return `<tr>
        <td>${fmtDateShort(r.next_service_date)}</td>
        <td><span class="badge ${badgeCls}">${status}</span></td>
        <td><strong>${esc(r.client_name || '—')}</strong>${r.client_phone ? `<br><span class="text-muted" style="font-size:.75rem">${esc(r.client_phone)}</span>` : ''}</td>
        <td>${esc(r.client_address || r.location_name || '—')}</td>
        <td>${r.category ? `<span class="badge badge-gray">${esc(r.category)}</span>` : '—'}</td>
        <td>${esc(r.product || '—')}</td>
        <td>${esc(r.worker_name)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function exportUpcomingCSV() {
  if (!allUpcoming.length) { showAlert('No upcoming jobs to export.', 'warning'); return; }
  const hdr = ['Due Date','Client','Phone','Address','Service','Product','Worker'];
  const rows = allUpcoming.map(r => [fmtDateShort(r.next_service_date), r.client_name||'', r.client_phone||'', r.client_address||r.location_name||'', r.category||'', r.product||'', r.worker_name]);
  downloadCSV([hdr,...rows], `upcoming-${today()}.csv`);
}

// ── Spraying: Jobs ────────────────────────────────

async function loadSprayJobs() {
  const params = new URLSearchParams();
  const w = document.getElementById('spj-worker')?.value;
  const c = document.getElementById('spj-client')?.value;
  const s = document.getElementById('spj-start')?.value;
  const e = document.getElementById('spj-end')?.value;
  if (w) params.set('workerId', w);
  if (c) params.set('clientId', c);
  if (s) params.set('startDate', s);
  if (e) params.set('endDate', e);
  allSprayJobs = await get('/api/admin/spray?' + params);
  const tbody = document.getElementById('spray-jobs-tbody');
  if (!allSprayJobs.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="table-empty">No jobs found. Set filters and click Filter.</td></tr>'; return;
  }
  tbody.innerHTML = allSprayJobs.map(r => `<tr>
    <td>${fmtDate(r.applied_at)}</td>
    <td>${esc(r.worker_name)}</td>
    <td><strong>${esc(r.client_name||'—')}</strong>${r.client_phone ? `<br><span class="text-muted" style="font-size:.75rem">${esc(r.client_phone)}</span>` : ''}</td>
    <td>${esc(r.location_name||r.client_address||'—')}</td>
    <td>${r.category ? `<span class="badge badge-gray">${esc(r.category)}</span>` : '—'}</td>
    <td>${esc(r.product)}</td>
    <td>${r.duration_minutes ? fmtDur(r.duration_minutes) : '—'}</td>
    <td>${r.notes ? esc(r.notes) : '<span class="text-muted">—</span>'}</td>
    <td>${r.next_service_date ? fmtDateShort(r.next_service_date) : '<span class="text-muted">—</span>'}</td>
  </tr>`).join('');
}

function exportSprayCSV() {
  if (!allSprayJobs.length) { showAlert('Load jobs first.', 'warning'); return; }
  const hdr = ['Date','Worker','Client','Phone','Location','Service','Product','Duration (min)','Notes','Next Visit'];
  const rows = allSprayJobs.map(r => [
    fmtDate(r.applied_at), r.worker_name, r.client_name||'', r.client_phone||'',
    r.location_name||r.client_address||'', r.category||'', r.product,
    r.duration_minutes||'', r.notes||'', r.next_service_date||''
  ]);
  downloadCSV([hdr,...rows], `spray-jobs-${today()}.csv`);
}

// ── Spraying: Clients ─────────────────────────────

let clientsList = [];

async function loadClientsAdmin() {
  clientsList = await get('/api/admin/clients');
  // Populate spray job client filter
  const spjC = document.getElementById('spj-client');
  if (spjC) {
    const opts = clientsList.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    spjC.innerHTML = '<option value="">All Clients</option>' + opts;
  }
  const tbody = document.getElementById('clients-tbody');
  if (!tbody) return;
  if (!clientsList.length) { tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No clients yet</td></tr>'; return; }
  tbody.innerHTML = clientsList.map(c => `<tr>
    <td><strong>${esc(c.name)}</strong>${c.notes ? `<br><span class="text-muted" style="font-size:.75rem">${esc(c.notes)}</span>` : ''}</td>
    <td>${c.phone ? esc(c.phone) : '<span class="text-muted">—</span>'}</td>
    <td>${c.address ? esc(c.address) : '<span class="text-muted">—</span>'}</td>
    <td>${c.last_service_date ? fmtDate(c.last_service_date) : '<span class="text-muted">—</span>'}</td>
    <td>${c.next_service_date ? `<span class="badge badge-success">${fmtDateShort(c.next_service_date)}</span>` : '<span class="text-muted">—</span>'}</td>
    <td>
      <button class="btn btn-outline btn-sm" onclick="openEditClient(${c.id})">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="removeClient(${c.id},'${esc(c.name)}')">Delete</button>
    </td>
  </tr>`).join('');
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

// ── Spraying: Products ────────────────────────────

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

// ── Workers ───────────────────────────────────────

async function loadWorkers() {
  const workers = await get('/api/admin/workers');
  const opts = workers.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  document.getElementById('f-worker').innerHTML = '<option value="">All Workers</option>' + opts;
  const spjW = document.getElementById('spj-worker');
  if (spjW) spjW.innerHTML = '<option value="">All Workers</option>' + opts;
  const ajW = document.getElementById('aj-worker');
  if (ajW) ajW.innerHTML = '<option value="">— Select —</option>' + opts;
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
  const action = newValue ? 'Grant' : 'Revoke';
  if (!confirm(`${action} spray access for "${name}"?`)) return;
  await put(`/api/admin/workers/${id}/spray-access`, { spray_access: newValue });
  loadWorkers();
  showAlert(`Spray access ${newValue ? 'granted to' : 'revoked from'} "${name}".`, 'success');
}

// ── Locations ─────────────────────────────────────

async function loadLocations() {
  const locs = await get('/api/locations');
  allLocations = locs;
  const opts = locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  document.getElementById('f-location').innerHTML = '<option value="">All Locations</option>' + opts;
  const tbody = document.getElementById('locations-tbody');
  if (!locs.length) { tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No locations yet</td></tr>'; return; }
  tbody.innerHTML = locs.map(l => {
    const hasPolygon  = l.polygon && l.polygon.length >= 3;
    const hasGeofence = l.geofence_lat && l.geofence_lng;
    const geofenceBadge = hasPolygon
      ? `<span class="badge badge-success">✓ Property lines set</span>`
      : hasGeofence
        ? `<span class="badge badge-success">✓ ${l.geofence_radius || 150}m radius</span>`
        : `<span class="text-muted">Not set</span>`;
    return `<tr>
      <td><strong>${esc(l.name)}</strong></td>
      <td>${l.address ? esc(l.address) : '<span class="text-muted">—</span>'}</td>
      <td>${geofenceBadge}</td>
      <td>${fmtDate(l.created_at)}</td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="openMapModal(${l.id})">🗺 Draw Property</button>
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
