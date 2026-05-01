let worker = null;
let currentEntry = null;
let timerInterval = null;
let deferredPrompt = null;
let photoData = null;
let weekEntries = [];
let sprayProducts = [];

// Service type → reapply suggestion (days)
const REAPPLY_DAYS = {
  'Weed Control':    21,
  'Fertilizer':      35,
  'Pest Control':    60,
  'Pre-emergent':    90,
  'Fungicide':       21,
  'Custom':          28,
};

const SEASONAL = [
  { months: [0],  label: 'January',   tips: ['Dormant oil on trees & shrubs', 'Plan spring pre-emergent', 'Equipment maintenance'] },
  { months: [1],  label: 'February',  tips: ['Pre-emergent if soil approaching 50°F', 'Prepare spring products'] },
  { months: [2],  label: 'March',     tips: ['PRE-EMERGENT — crabgrass prevention', 'Round 1 fertilizer if soil >55°F', 'Broadleaf spot treatment'] },
  { months: [3],  label: 'April',     tips: ['Round 1 fertilizer (slow-release N)', 'Post-emergent broadleaf control', 'Fire ant bait'] },
  { months: [4],  label: 'May',       tips: ['Post-emergent weed control', 'Light Round 2 fertilizer', 'Begin grub monitoring'] },
  { months: [5],  label: 'June',      tips: ['Grub control application', 'Fungicide if brown patch appears', 'Spot weed treatment'] },
  { months: [6],  label: 'July',      tips: ['Grub control if missed June', 'Monitor for chinch bugs', 'Minimal fertilizer — heat stress risk'] },
  { months: [7],  label: 'August',    tips: ['Round 2–3 fertilizer', 'Fungicide for brown patch', 'Broadleaf spot treatment'] },
  { months: [8],  label: 'September', tips: ['PRE-EMERGENT — winter weeds', 'Round 3 fertilizer', 'Aeration & overseeding'] },
  { months: [9],  label: 'October',   tips: ['Broadleaf weed control', 'Round 4 fertilizer', 'Second pre-emergent'] },
  { months: [10], label: 'November',  tips: ['WINTERIZER fertilizer', 'Final pre-emergent if needed', 'Equipment winterization'] },
  { months: [11], label: 'December',  tips: ['Dormant oil spray', 'Review spray records', 'Order spring products'] },
];

// PWA
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  if (!isInStandaloneMode()) show('install-banner');
});
window.addEventListener('appinstalled', () => hide('install-banner'));

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  hide('install-banner');
}

function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('gt_worker');
  if (saved) { worker = JSON.parse(saved); showApp(); }
  document.getElementById('inp-pin').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('inp-pin').focus(); });
  if (isIOS() && !isInStandaloneMode()) show('ios-banner');
  // default spray datetime to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const spDate = document.getElementById('sp-date');
  if (spDate) spDate.value = now.toISOString().slice(0, 16);
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
  localStorage.removeItem('gt_pending_job');
  worker = null; currentEntry = null;
  clearInterval(timerInterval);
  show('login-section'); hide('app-section');
  document.getElementById('inp-name').value = '';
  document.getElementById('inp-pin').value = '';
}

async function showApp() {
  hide('login-section'); show('app-section');
  document.getElementById('hdr-name').textContent = worker.name;
  // Show/hide spray tab based on permission
  const sprayNav = document.getElementById('nav-spray');
  if (sprayNav) sprayNav.classList.toggle('section-hidden', !worker.sprayAccess);
  await Promise.all([loadLocations(), loadClients(), loadProductsForJobForm()]);
  await refreshStatus();
  showWorkerTab('clock');
  setupPushNotifications();
}

function showWorkerTab(tab) {
  // If worker doesn't have spray access, redirect spray tab to clock
  if (tab === 'spray' && !worker.sprayAccess) tab = 'clock';
  ['clock', 'hours', 'jobs', 'spray'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('section-hidden', t !== tab);
    document.getElementById('nav-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'hours')  loadWeekHours();
  if (tab === 'jobs')   { loadJobs(); loadUpcoming(); }
  if (tab === 'spray')  { loadSprayHistory(); renderSeasonalPrompt(); }
}

// ── Loaders ──────────────────────────────────────────

async function loadLocations() {
  const locs = await get('/api/locations');
  const sel = document.getElementById('loc-select');
  sel.innerHTML = '<option value="">— Choose a location —</option>';
  locs.forEach(l => sel.insertAdjacentHTML('beforeend',
    `<option value="${l.id}">${esc(l.name)}${l.address ? ' — ' + esc(l.address) : ''}</option>`));
  const sp = document.getElementById('sp-loc');
  if (sp) {
    sp.innerHTML = '<option value="">— Select location —</option>';
    locs.forEach(l => sp.insertAdjacentHTML('beforeend',
      `<option value="${l.id}">${esc(l.name)}${l.address ? ' — ' + esc(l.address) : ''}</option>`));
  }
}

async function loadClients() {
  const clients = await get('/api/clients');
  const sel = document.getElementById('job-client');
  if (!sel) return;
  const saved = sel.value;
  sel.innerHTML = '<option value="">— Select client or skip —</option>';
  clients.forEach(c => sel.insertAdjacentHTML('beforeend',
    `<option value="${c.id}" data-name="${esc(c.name)}" data-phone="${esc(c.phone||'')}" data-address="${esc(c.address||'')}">${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</option>`));
  sel.insertAdjacentHTML('beforeend', '<option value="__new__">+ New client…</option>');
  if (saved) sel.value = saved;
}

async function loadProductsForJobForm() {
  sprayProducts = await get('/api/spray/products');
  const sel = document.getElementById('job-product');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select product (optional) —</option>';
  sprayProducts.forEach(p => sel.insertAdjacentHTML('beforeend',
    `<option value="${p.id}" data-reapply-min="${p.reapply_min_days||''}" data-reapply-max="${p.reapply_max_days||''}">${esc(p.name)}</option>`));
}

function handleClientSelect() {
  const sel = document.getElementById('job-client');
  if (sel.value === '__new__') {
    show('new-client-wrap');
  } else {
    hide('new-client-wrap');
    document.getElementById('job-client-name').value = '';
    document.getElementById('job-client-phone').value = '';
  }
}

function suggestProduct() {
  const serviceType = document.getElementById('job-service').value;
  if (!serviceType || !sprayProducts.length) return;
  const sel = document.getElementById('job-product');
  // Find a product matching the service type
  const match = sprayProducts.find(p => p.type && p.type.toLowerCase().includes(serviceType.toLowerCase().split(' ')[0]));
  if (match) sel.value = String(match.id);
  // Update next-date suggestion
  updateNextDateSuggestion();
}

function updateNextDateSuggestion() {
  const serviceType = document.getElementById('job-service').value;
  const prodSel = document.getElementById('job-product');
  const prodOpt = prodSel.options[prodSel.selectedIndex];
  const hint = document.getElementById('next-date-hint');
  const nextInput = document.getElementById('job-next-date');
  if (!nextInput) return;

  let days = null;
  if (prodOpt && prodOpt.dataset.reapplyMin) {
    const min = parseInt(prodOpt.dataset.reapplyMin);
    const max = parseInt(prodOpt.dataset.reapplyMax || prodOpt.dataset.reapplyMin);
    days = Math.round((min + max) / 2);
    if (hint) hint.textContent = `Suggested: ${min}–${max} days based on product`;
  } else if (serviceType && REAPPLY_DAYS[serviceType]) {
    days = REAPPLY_DAYS[serviceType];
    if (hint) hint.textContent = `Suggested: ~${days} days for ${serviceType}`;
  } else {
    if (hint) hint.textContent = '';
  }

  if (days && !nextInput.value) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    nextInput.value = d.toISOString().split('T')[0];
  }
}

// ── Clock In / Out ──────────────────────────────────

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
    const pendingJob = getPendingJob();
    document.getElementById('s-client').textContent = pendingJob?.clientName || 'Working';
    document.getElementById('s-service').textContent = pendingJob?.serviceType || '';
    document.getElementById('s-loc').textContent = '📍 ' + currentEntry.location_name;
    document.getElementById('s-since').textContent = 'Since ' + fmtTime(currentEntry.clock_in);
    const start = new Date(currentEntry.clock_in).getTime();
    const tick = () => { document.getElementById('s-timer').textContent = fmtElapsed(Date.now() - start); };
    tick(); timerInterval = setInterval(tick, 1000);
    // Pre-fill next date suggestion
    updateNextDateSuggestion();
  } else {
    show('s-out'); hide('s-in');
    show('form-in'); hide('form-out');
    document.getElementById('job-next-date').value = '';
    document.getElementById('next-date-hint').textContent = '';
  }
}

async function clockIn() {
  const locationId = document.getElementById('loc-select').value;
  if (!locationId) { showAlert('Please select a job site.', 'error'); return; }

  // Collect optional job details
  const clientSel = document.getElementById('job-client');
  const clientId = (clientSel.value && clientSel.value !== '__new__') ? clientSel.value : null;
  const isNew = clientSel.value === '__new__';
  const clientName = isNew
    ? document.getElementById('job-client-name').value.trim()
    : (clientSel.selectedOptions[0]?.dataset.name || '');
  const clientPhone = isNew
    ? document.getElementById('job-client-phone').value.trim()
    : (clientSel.selectedOptions[0]?.dataset.phone || '');
  const clientAddress = clientSel.selectedOptions[0]?.dataset.address || '';
  const serviceType = document.getElementById('job-service').value;
  const prodSel = document.getElementById('job-product');
  const productName = prodSel.selectedOptions[0]?.text || '';
  const productId = prodSel.value || null;

  let lat = null, lng = null;
  try { const p = await getGPS(); lat = p.coords.latitude; lng = p.coords.longitude; } catch {}

  const r = await post('/api/entries/clock-in', { workerId: worker.id, locationId, latitude: lat, longitude: lng });
  if (!r.success) { showAlert(r.message || 'Failed to clock in.', 'error'); return; }

  // If new client name given, save the client
  let savedClientId = clientId;
  if (isNew && clientName) {
    try {
      const cr = await post('/api/clients', { name: clientName, phone: clientPhone });
      if (cr.success) { savedClientId = cr.client.id; await loadClients(); }
    } catch {}
  }

  // Persist pending job details for clock-out
  if (clientName || serviceType || productName) {
    localStorage.setItem('gt_pending_job', JSON.stringify({
      clientId: savedClientId,
      clientName,
      clientPhone,
      clientAddress,
      serviceType,
      productId,
      productName,
      locationId,
    }));
  }

  await refreshStatus();
  showAlert(clientName ? `Job started for ${clientName}!` : 'Job started!', 'success');
}

function getPendingJob() {
  try { return JSON.parse(localStorage.getItem('gt_pending_job') || 'null'); } catch { return null; }
}

async function clockOut() {
  let lat = null, lng = null;
  try { const p = await getGPS(); lat = p.coords.latitude; lng = p.coords.longitude; } catch {}
  const notes = document.getElementById('out-notes').value.trim();
  const nextServiceDate = document.getElementById('job-next-date').value || null;
  const pendingJob = getPendingJob();

  const job = (pendingJob && (pendingJob.productName || pendingJob.serviceType)) ? {
    clientId: pendingJob.clientId,
    clientName: pendingJob.clientName,
    clientPhone: pendingJob.clientPhone,
    clientAddress: pendingJob.clientAddress,
    serviceType: pendingJob.serviceType,
    product: pendingJob.productName || pendingJob.serviceType || 'Service',
    nextServiceDate,
  } : null;

  const r = await post('/api/entries/clock-out', { workerId: worker.id, latitude: lat, longitude: lng, notes, photo: photoData, job });
  if (r.success) {
    document.getElementById('out-notes').value = '';
    document.getElementById('job-next-date').value = '';
    document.getElementById('next-date-hint').textContent = '';
    localStorage.removeItem('gt_pending_job');
    clearPhoto();
    await refreshStatus(); await loadWeekHours();
    showAlert(`Job complete! Worked ${fmtDur(r.entry.duration_minutes)}.`, 'success');
  } else {
    showAlert(r.message || 'Failed.', 'error');
  }
}

// ── Jobs History Tab ──────────────────────────────

async function loadJobs(all = false) {
  const records = await get(`/api/spray/records?workerId=${worker.id}`);
  const el = document.getElementById('jobs-list');
  if (!records.length) {
    el.innerHTML = '<div class="table-empty">No jobs yet — start a job from the Clock tab</div>';
    return;
  }
  const shown = all ? records : records.slice(0, 20);
  const today = new Date(); today.setHours(0,0,0,0);
  el.innerHTML = shown.map(r => {
    const clientDisplay = r.client_name || r.location_name || 'General Work';
    const initials = clientDisplay.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const dur = r.duration_minutes ? fmtDur(r.duration_minutes) : null;
    const address = r.client_address || (r.location_name && r.client_name ? r.location_name : '');

    let statusBadge = '';
    if (r.next_service_date) {
      const due = new Date(r.next_service_date + 'T12:00:00');
      due.setHours(0,0,0,0);
      const diff = Math.round((due - today) / 86400000);
      statusBadge = diff < 0
        ? `<span class="badge badge-overtime">Overdue</span>`
        : diff <= 7
          ? `<span class="badge badge-warning-hrs">Due Soon</span>`
          : `<span class="badge badge-success">Upcoming</span>`;
    }

    return `<div class="job-card">
      <div class="job-avatar">${esc(initials)}</div>
      <div class="job-card-body">
        <div class="job-card-top">
          <div>
            <div class="job-card-name">${esc(clientDisplay)}</div>
            ${address ? `<div class="job-card-addr">${esc(address)}</div>` : ''}
            ${r.category ? `<div class="job-card-service" style="color:${serviceColor(r.category)}">${esc(r.category)}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${statusBadge}
            ${dur ? `<div class="job-card-dur">⏱ ${dur}</div>` : ''}
            <div class="job-card-date">${fmtDate(r.applied_at)}</div>
          </div>
        </div>
        ${r.notes ? `<div class="job-card-notes">📝 ${esc(r.notes)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function serviceColor(cat) {
  if (!cat) return 'var(--gray-500)';
  if (cat === 'Fertilizer') return '#16a34a';
  if (cat === 'Weed Control' || cat === 'Pre-emergent') return '#d97706';
  if (cat === 'Pest Control' || cat === 'Fungicide') return '#dc2626';
  return 'var(--green)';
}

async function loadUpcoming() {
  const records = await get(`/api/spray/upcoming?workerId=${worker.id}&days=30`);
  const section = document.getElementById('upcoming-section');
  const el = document.getElementById('upcoming-list');
  if (!records.length) { hide('upcoming-section'); return; }
  show('upcoming-section');
  const today = new Date(); today.setHours(0,0,0,0);
  el.innerHTML = records.map(r => {
    const due = new Date(r.next_service_date + 'T12:00:00');
    due.setHours(0,0,0,0);
    const diffDays = Math.round((due - today) / 86400000);
    const urgency = diffDays < 0 ? 'badge-overtime' : diffDays <= 7 ? 'badge-warning-hrs' : 'badge-success';
    const label   = diffDays < 0 ? `Overdue ${Math.abs(diffDays)}d` : diffDays === 0 ? 'Due Today' : `Due in ${diffDays}d`;
    return `<div class="upcoming-row">
      <div>
        <div class="upcoming-client">${esc(r.client_name || r.location_name || '—')}</div>
        <div class="upcoming-detail">${r.category || ''} · ${r.product ? esc(r.product) : ''}</div>
      </div>
      <span class="badge ${urgency}">${label}</span>
    </div>`;
  }).join('');
}

// ── Hours Tab ─────────────────────────────────────

async function loadWeekHours() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay());
  const start = d.toISOString().split('T')[0];
  weekEntries = await get(`/api/entries/worker/${worker.id}?startDate=${start}`);
  const mins = weekEntries.reduce((s, e) => s + (e.duration_minutes || 0), 0);
  document.getElementById('week-hours').textContent = fmtDur(mins) || '0h';

  const byDay = {};
  weekEntries.forEach(e => {
    const day = fmtDate(e.clock_in);
    byDay[day] = (byDay[day] || 0) + (e.duration_minutes || 0);
  });
  const bd = document.getElementById('week-breakdown');
  const days = Object.keys(byDay);
  if (!days.length) { bd.innerHTML = '<div class="table-empty">No entries this week</div>'; return; }
  bd.innerHTML = days.map(day => `
    <div class="entry-row">
      <div class="entry-main">
        <div class="entry-loc">${esc(day)}</div>
        <div class="entry-dur">${fmtDur(byDay[day]) || '0m'}</div>
      </div>
    </div>`).join('');
}

function exportHoursCSV() {
  if (!weekEntries.length) { showAlert('Load the Hours tab first.', 'error'); return; }
  const hdr = ['Date', 'Location', 'Clock In', 'Clock Out', 'Duration (min)', 'Duration (hrs)', 'Notes'];
  const rows = weekEntries.map(e => [
    fmtDate(e.clock_in), e.location_name,
    fmtDateTime(e.clock_in), e.clock_out ? fmtDateTime(e.clock_out) : '',
    e.duration_minutes || '', e.duration_minutes ? (e.duration_minutes / 60).toFixed(2) : '',
    e.notes || ''
  ]);
  const csv = [hdr, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: `hours-${worker.name.replace(/\s+/g, '-')}-${today()}.csv`
  });
  a.click();
}

// ── Spray Log Tab ─────────────────────────────────

const SPRAY_PRODUCTS_BY_CAT = {
  'Pre-emergent': ['Prodiamine 65 WDG', 'Barricade 4FL', 'Dimension 0.15G', 'Pendimethalin', 'Other'],
  'Weed Control': ['Celsius WG', 'Trimec / 3-Way', 'Certainty', 'Drive XLR8', 'Roundup (spot treat)', 'Other'],
  'Fertilizer': ['16-4-8 Slow Release', '24-0-11 Summer Blend', '12-12-12 Balanced', '0-0-7 Potassium', 'Milorganite', 'Winterizer', 'Other'],
  'Fungicide': ['Heritage G', 'Headway G', 'Pillar G', 'Clearys 3336 F', 'Triton Flo', 'Other'],
  'Pest Control': ['Dylox 6.2G', 'Talstar P', 'Meridian 25WG', 'Sevin SL', 'Safari 20SG', 'Other'],
  'Other': ['Custom / Other'],
};

function updateProductList() {
  const cat = document.getElementById('sp-cat').value;
  const sel = document.getElementById('sp-prod');
  const custom = document.getElementById('sp-prod-custom');
  // Merge hardcoded + DB products for this category
  const dbMatches = sprayProducts.filter(p => !cat || (p.type && p.type.toLowerCase().includes(cat.toLowerCase().split(' ')[0])));
  const staticList = SPRAY_PRODUCTS_BY_CAT[cat] || [];
  const allNames = [...new Set([...dbMatches.map(p => p.name), ...staticList])];
  if (!allNames.length) {
    sel.innerHTML = '<option value="">— Select category first —</option>';
    hide('sp-prod-custom'); return;
  }
  sel.innerHTML = allNames.map(n => `<option value="${n}">${n}</option>`).join('');
  sel.onchange = () => {
    if (sel.value === 'Other') show('sp-prod-custom');
    else { hide('sp-prod-custom'); custom.value = ''; }
  };
  hide('sp-prod-custom'); custom.value = '';
}

async function logSpray() {
  const locationId = document.getElementById('sp-loc').value || null;
  const cat      = document.getElementById('sp-cat').value;
  const prodSel  = document.getElementById('sp-prod').value;
  const prodCustom = document.getElementById('sp-prod-custom').value.trim();
  const product  = (prodSel === 'Other' || !prodSel) ? prodCustom : prodSel;
  const appliedAt = document.getElementById('sp-date').value;
  const notes    = document.getElementById('sp-notes').value.trim();

  if (!cat)     { showAlert('Please select a category.', 'error'); return; }
  if (!product) { showAlert('Please select or enter a product.', 'error'); return; }

  const r = await post('/api/spray/records', {
    workerId: worker.id, locationId, product, category: cat,
    appliedAt: appliedAt ? new Date(appliedAt).toISOString() : new Date().toISOString(), notes
  });
  if (r.success) {
    document.getElementById('sp-cat').value = '';
    document.getElementById('sp-prod').innerHTML = '<option value="">— Select category first —</option>';
    document.getElementById('sp-prod-custom').value = '';
    hide('sp-prod-custom');
    document.getElementById('sp-notes').value = '';
    showAlert('Application logged!', 'success');
    loadSprayHistory();
  } else {
    showAlert(r.message || 'Failed to log.', 'error');
  }
}

async function loadSprayHistory() {
  const records = await get(`/api/spray/records?workerId=${worker.id}`);
  const el = document.getElementById('spray-list');
  if (!records.length) { el.innerHTML = '<div class="table-empty">No applications logged yet</div>'; return; }
  el.innerHTML = records.slice(0, 15).map(r => `
    <div class="entry-row">
      <div class="entry-main">
        <div class="entry-loc">${esc(r.product)}</div>
        <div>${sprayBadge(r.category)}</div>
      </div>
      <div class="entry-meta">
        <span>${fmtDate(r.applied_at)}</span>
        ${r.location_name ? `<span>📍 ${esc(r.location_name)}</span>` : ''}
        ${r.notes ? `<span>📝 ${esc(r.notes)}</span>` : ''}
      </div>
    </div>`).join('');
}

function sprayBadge(cat) {
  if (!cat) return '';
  const cls = cat === 'Fertilizer' ? 'badge-fert'
    : (cat === 'Weed Control' || cat === 'Pre-emergent') ? 'badge-herb'
    : cat === 'Fungicide' ? 'badge-fung'
    : cat === 'Pest Control' ? 'badge-ins'
    : 'badge-gray';
  return `<span class="badge ${cls}">${esc(cat)}</span>`;
}

function renderSeasonalPrompt() {
  const month = new Date().getMonth();
  const season = SEASONAL.find(s => s.months.includes(month));
  const el = document.getElementById('seasonal-prompt');
  if (!season || !el) return;
  el.innerHTML = `
    <h3>🗓 ${season.label} — Recommended This Month</h3>
    <ul>${season.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

// ── Photo ─────────────────────────────────────────

function handlePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 900;
      let w = img.width, h = img.height;
      if (w > MAX) { h = h * MAX / w; w = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      photoData = canvas.toDataURL('image/jpeg', 0.72);
      document.getElementById('photo-preview').src = photoData;
      show('photo-preview-wrap');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearPhoto() {
  photoData = null;
  document.getElementById('photo-input').value = '';
  document.getElementById('photo-preview').src = '';
  hide('photo-preview-wrap');
}

async function viewPhoto(entryId) {
  const data = await get(`/api/entries/${entryId}/photo`);
  if (!data.photo) { showAlert('No photo for this entry.', 'error'); return; }
  document.getElementById('photo-modal-img').src = data.photo;
  show('photo-modal');
}

function closePhotoModal() {
  hide('photo-modal');
  document.getElementById('photo-modal-img').src = '';
}

// ── Push Notifications ────────────────────────────

async function setupPushNotifications() {
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    const cfg = await get('/api/config');
    if (!cfg.vapidPublicKey) return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey)
    });
    await post('/api/push/subscribe', { workerId: worker.id, subscription: sub.toJSON() });
  } catch {}
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Helpers ───────────────────────────────────────

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
function fmtDateShort(iso) { return iso ? new Date(iso + 'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric'}) : ''; }
function fmtDateTime(iso) { const d = new Date(iso); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString(); }
function today() { return new Date().toISOString().split('T')[0]; }
function pad(n) { return String(n).padStart(2,'0'); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
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
