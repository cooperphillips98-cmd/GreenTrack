let worker = null;
let currentEntry = null;
let timerInterval = null;
let deferredPrompt = null;
let photoData = null;
let allEntries = [];

const SPRAY_PRODUCTS = {
  'Pre-emergent': ['Prodiamine 65 WDG', 'Barricade 4FL', 'Dimension 0.15G', 'Pendimethalin', 'Other'],
  'Post-emergent Herbicide': ['Celsius WG', 'Trimec / 3-Way', 'Certainty', 'Drive XLR8', 'Roundup (spot treat)', 'Other'],
  'Fertilizer': ['16-4-8 Slow Release', '24-0-11 Summer Blend', '12-12-12 Balanced', '0-0-7 Potassium', 'Milorganite', 'Winterizer', 'Other'],
  'Fungicide': ['Heritage G', 'Headway G', 'Pillar G', 'Clearys 3336 F', 'Triton Flo', 'Other'],
  'Insecticide / Grub Control': ['Dylox 6.2G', 'Talstar P', 'Meridian 25WG', 'Sevin SL', 'Safari 20SG', 'Other'],
  'Dormant / Horticultural Oil': ['Horticultural Oil', 'Neem Oil', 'Other'],
  'Other': ['Custom / Other'],
};

const SEASONAL = [
  { months: [0],     label: 'January',           tips: ['Apply dormant oil to trees & shrubs', 'Plan spring pre-emergent timing', 'Equipment maintenance'] },
  { months: [1],     label: 'February',           tips: ['Pre-emergent if soil temp approaching 50°F', 'Prepare products for spring'] },
  { months: [2],     label: 'March',              tips: ['PRE-EMERGENT — crabgrass prevention', 'Round 1 fertilizer if soil >55°F', 'Broadleaf spot treatment'] },
  { months: [3],     label: 'April',              tips: ['Round 1 fertilizer (slow-release nitrogen)', 'Post-emergent broadleaf weed control', 'Fire ant bait application'] },
  { months: [4],     label: 'May',                tips: ['Post-emergent weed control', 'Light Round 2 fertilizer', 'Begin grub monitoring'] },
  { months: [5],     label: 'June',               tips: ['Grub control application', 'Fungicide if brown patch appears', 'Spot weed treatment'] },
  { months: [6],     label: 'July',               tips: ['Grub control if missed June', 'Monitor for chinch bugs', 'Minimal fertilizer — heat stress risk'] },
  { months: [7],     label: 'August',             tips: ['Round 2–3 fertilizer (late summer)', 'Fungicide for brown patch', 'Broadleaf spot treatment'] },
  { months: [8],     label: 'September',          tips: ['PRE-EMERGENT — winter weeds (poa annua)', 'Round 3 fertilizer', 'Aeration & overseeding'] },
  { months: [9],     label: 'October',            tips: ['Broadleaf weed control', 'Round 4 fertilizer', 'Second pre-emergent application'] },
  { months: [10],    label: 'November',           tips: ['WINTERIZER fertilizer (last application)', 'Final pre-emergent if needed', 'Equipment winterization'] },
  { months: [11],    label: 'December',           tips: ['Dormant oil spray', 'Review spray records for the year', 'Order spring products'] },
];

// PWA install prompt
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
  // Set spray datetime to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const el = document.getElementById('sp-date');
  if (el) el.value = now.toISOString().slice(0, 16);
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
  showWorkerTab('clock');
  setupPushNotifications();
}

function showWorkerTab(tab) {
  ['clock', 'hours', 'history', 'spray'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('section-hidden', t !== tab);
    document.getElementById('nav-' + t).classList.toggle('active', t === tab);
  });
  if (tab === 'hours')   loadWeekHours();
  if (tab === 'history') loadHistory();
  if (tab === 'spray')   { loadSprayHistory(); renderSeasonalPrompt(); populateSprayLocations(); }
}

async function loadLocations() {
  const locs = await get('/api/locations');
  const sel = document.getElementById('loc-select');
  sel.innerHTML = '<option value="">— Choose a location —</option>';
  locs.forEach(l => sel.insertAdjacentHTML('beforeend',
    `<option value="${l.id}">${esc(l.name)}${l.address ? ' — ' + esc(l.address) : ''}</option>`));
  // Also populate spray location dropdown
  const sp = document.getElementById('sp-loc');
  if (sp) {
    sp.innerHTML = '<option value="">— Select location —</option>';
    locs.forEach(l => sp.insertAdjacentHTML('beforeend',
      `<option value="${l.id}">${esc(l.name)}${l.address ? ' — ' + esc(l.address) : ''}</option>`));
  }
}

function populateSprayLocations() {
  // Called when switching to spray tab, locations already populated in loadLocations
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
    await refreshStatus();
    showAlert('Clocked in!', 'success');
  } else {
    showAlert(r.message || 'Failed to clock in.', 'error');
  }
}

async function clockOut() {
  let lat = null, lng = null;
  try { const p = await getGPS(); lat = p.coords.latitude; lng = p.coords.longitude; } catch {}
  const notes = document.getElementById('out-notes').value.trim();
  const r = await post('/api/entries/clock-out', { workerId: worker.id, latitude: lat, longitude: lng, notes, photo: photoData });
  if (r.success) {
    document.getElementById('out-notes').value = '';
    clearPhoto();
    await refreshStatus(); await loadWeekHours();
    showAlert(`Clocked out! Worked ${fmtDur(r.entry.duration_minutes)}.`, 'success');
  } else {
    showAlert(r.message || 'Failed.', 'error');
  }
}

// Photo handling
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

async function loadHistory(all = false) {
  allEntries = await get(`/api/entries/worker/${worker.id}${all ? '' : '?endDate=' + today()}`);
  const el = document.getElementById('entries-list');
  if (!allEntries.length) { el.innerHTML = '<div class="table-empty">No entries yet</div>'; return; }
  const shown = all ? allEntries : allEntries.slice(0, 15);
  el.innerHTML = shown.map(e => `
    <div class="entry-row">
      <div class="entry-main">
        <div class="entry-loc">${esc(e.location_name)}</div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <div class="entry-dur">${e.duration_minutes ? fmtDur(e.duration_minutes) : (e.clock_out ? '0m' : '<span class="badge badge-success">Active</span>')}</div>
          ${e.has_photo ? `<button class="btn btn-ghost btn-sm" style="color:var(--green);padding:.1rem .35rem" onclick="viewPhoto(${e.id})">📷</button>` : ''}
        </div>
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
  document.getElementById('week-hours').textContent = fmtDur(mins) || '0h';

  const byDay = {};
  entries.forEach(e => {
    const day = fmtDate(e.clock_in);
    byDay[day] = (byDay[day] || 0) + (e.duration_minutes || 0);
  });
  const bd = document.getElementById('week-breakdown');
  const days = Object.keys(byDay);
  if (!days.length) {
    bd.innerHTML = '<div class="table-empty">No entries this week</div>';
    return;
  }
  bd.innerHTML = days.map(day => `
    <div class="entry-row">
      <div class="entry-main">
        <div class="entry-loc">${esc(day)}</div>
        <div class="entry-dur">${fmtDur(byDay[day]) || '0m'}</div>
      </div>
    </div>`).join('');
}

function exportHoursCSV() {
  if (!allEntries.length) { showAlert('Load history first.', 'error'); return; }
  const hdr = ['Date', 'Location', 'Clock In', 'Clock Out', 'Duration (min)', 'Duration (hrs)', 'Notes'];
  const rows = allEntries.map(e => [
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

// Spray Log
function updateProductList() {
  const cat = document.getElementById('sp-cat').value;
  const sel = document.getElementById('sp-prod');
  const custom = document.getElementById('sp-prod-custom');
  if (!cat || !SPRAY_PRODUCTS[cat]) {
    sel.innerHTML = '<option value="">— Select category first —</option>';
    hide('sp-prod-custom');
    return;
  }
  sel.innerHTML = SPRAY_PRODUCTS[cat].map(p => `<option value="${p}">${p}</option>`).join('');
  sel.onchange = () => {
    if (sel.value === 'Other') show('sp-prod-custom');
    else { hide('sp-prod-custom'); custom.value = ''; }
  };
  hide('sp-prod-custom');
  custom.value = '';
}

async function logSpray() {
  const locationId = document.getElementById('sp-loc').value || null;
  const cat   = document.getElementById('sp-cat').value;
  const prodSel = document.getElementById('sp-prod').value;
  const prodCustom = document.getElementById('sp-prod-custom').value.trim();
  const product = (prodSel === 'Other' || !prodSel) ? prodCustom : prodSel;
  const appliedAt = document.getElementById('sp-date').value;
  const notes = document.getElementById('sp-notes').value.trim();

  if (!cat)      { showAlert('Please select a category.', 'error'); return; }
  if (!product)  { showAlert('Please select or enter a product.', 'error'); return; }

  const r = await post('/api/spray/records', {
    workerId: worker.id, locationId, product, category: cat,
    appliedAt: appliedAt ? new Date(appliedAt).toISOString() : new Date().toISOString(),
    notes
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
  el.innerHTML = records.map(r => `
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
  const cls = cat.startsWith('Fert') ? 'badge-fert'
    : cat.startsWith('Pre') ? 'badge-herb'
    : cat.startsWith('Post') ? 'badge-herb'
    : cat.startsWith('Fung') ? 'badge-fung'
    : cat.startsWith('Ins') ? 'badge-ins'
    : 'badge-gray';
  return `<span class="badge ${cls}">${esc(cat)}</span>`;
}

function renderSeasonalPrompt() {
  const month = new Date().getMonth();
  const season = SEASONAL.find(s => s.months.includes(month));
  const el = document.getElementById('seasonal-prompt');
  if (!season || !el) return;
  el.innerHTML = `
    <h3>🗓 ${season.label} — What's Due</h3>
    <ul>${season.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

// Push Notifications
async function setupPushNotifications() {
  if (!('PushManager' in window) || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return; // already subscribed

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const cfg = await get('/api/config');
    if (!cfg.vapidPublicKey) return;

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey)
    });
    await post('/api/push/subscribe', { workerId: worker.id, subscription: sub.toJSON() });
  } catch { /* push not supported or denied */ }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
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
