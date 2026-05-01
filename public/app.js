let worker = null;
let currentEntry = null;
let timerInterval = null;
let sbTimerInterval = null;
let deferredPrompt = null;
let photoData = null;
let weekEntries = [];
let sprayProducts = [];
let allClientsCache = [];

// Selected state for new start-job UI
let selectedClientId = null;
let selectedClientName = null;
let selectedClientPhone = null;
let selectedClientAddress = null;
let selectedJobType = null;

const REAPPLY_DAYS = {
  'Weed Control': 21, 'Fertilizer': 35, 'Pest Control': 60,
  'Pre-emergent': 90, 'Fungicide': 21, 'Custom': 28,
};

// PWA
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e;
  if (!isInStandaloneMode()) show('install-banner');
});
window.addEventListener('appinstalled', () => hide('install-banner'));

async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; hide('install-banner');
}

function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('gt_worker');
  if (saved) { worker = JSON.parse(saved); showApp(); }
  document.getElementById('inp-pin').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('inp-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('inp-pin').focus(); });
  if (isIOS() && !isInStandaloneMode()) show('ios-banner');
});

async function login() {
  const name = document.getElementById('inp-name').value.trim();
  const pin  = document.getElementById('inp-pin').value.trim();
  if (!name || !pin) { showLoginErr('Enter your name and PIN.'); return; }
  try {
    const r = await post('/api/auth/login', { name, pin });
    if (r.success) { worker = r.worker; localStorage.setItem('gt_worker', JSON.stringify(worker)); showApp(); }
    else showLoginErr(r.message || 'Invalid name or PIN.');
  } catch { showLoginErr('Connection error. Please try again.'); }
}

function signOut() {
  localStorage.removeItem('gt_worker');
  localStorage.removeItem('gt_pending_job');
  worker = null; currentEntry = null;
  clearInterval(timerInterval); clearInterval(sbTimerInterval);
  show('login-section'); hide('app-section');
  document.getElementById('inp-name').value = '';
  document.getElementById('inp-pin').value = '';
}

async function showApp() {
  hide('login-section'); show('app-section');
  document.getElementById('hdr-name').textContent = worker.name;
  await Promise.all([loadLocations(), loadClientsForHome(), loadProductsCache()]);
  await refreshStatus();
  showLastJobButton();
  showWorkerTab('home');
  setupPushNotifications();
}

// ── Tab Navigation ─────────────────────────────────

function showWorkerTab(tab) {
  ['home','clients','jobs','hours'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('section-hidden', t !== tab);
    const nav = document.getElementById('nav-' + t);
    if (nav) nav.classList.toggle('active', t === tab);
  });
  if (tab === 'hours')   loadWeekHours();
  if (tab === 'jobs')    loadJobs();
  if (tab === 'clients') loadClientsTab();
}

// ── Loaders ────────────────────────────────────────

async function loadLocations() {
  const locs = await get('/api/locations');
  const sel = document.getElementById('loc-select');
  sel.innerHTML = '<option value="">— Choose location —</option>';
  locs.forEach(l => sel.insertAdjacentHTML('beforeend',
    `<option value="${l.id}">${esc(l.name)}${l.address ? ' — ' + esc(l.address) : ''}</option>`));
}

async function loadClientsForHome() {
  allClientsCache = await get('/api/clients');
  const container = document.getElementById('client-buttons');
  if (!container) return;
  const shown = allClientsCache.slice(0, 6);
  if (!shown.length) {
    container.innerHTML = '<div style="grid-column:1/-1;font-size:.82rem;color:var(--gray-400);padding:.5rem 0">No clients yet — add one below</div>';
    return;
  }
  container.innerHTML = shown.map(c => `
    <button class="client-btn${selectedClientId == c.id ? ' selected' : ''}"
      onclick="selectClient(${c.id},'${esc(c.name)}','${esc(c.phone||'')}','${esc(c.address||'')}')">
      <span class="client-btn-name">${esc(c.name)}</span>
      <span class="client-btn-sub">${c.phone ? esc(c.phone) : c.address ? esc(c.address) : 'No contact'}</span>
    </button>`).join('');
}

async function loadProductsCache() {
  sprayProducts = await get('/api/spray/products');
}

function showLastJobButton() {
  const lj = getLastJob();
  if (!lj) return;
  show('last-job-wrap');
  document.getElementById('last-job-detail').textContent =
    `${lj.clientName || 'No client'} · ${lj.jobType || 'Unknown type'}`;
}

// ── Client selection ───────────────────────────────

function selectClient(id, name, phone, address) {
  selectedClientId = id;
  selectedClientName = name;
  selectedClientPhone = phone;
  selectedClientAddress = address;
  document.querySelectorAll('.client-btn').forEach(b => b.classList.remove('selected'));
  event?.currentTarget?.classList.add('selected');
}

function selectJobType(btn) {
  selectedJobType = btn.dataset.type;
  document.querySelectorAll('.job-type-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function startLastJob() {
  const lj = getLastJob();
  if (!lj) return;
  // Re-select client button
  if (lj.clientId) selectClient(lj.clientId, lj.clientName, lj.clientPhone || '', lj.clientAddress || '');
  // Re-select job type button
  const btn = document.querySelector(`.job-type-btn[data-type="${lj.jobType}"]`);
  if (btn) selectJobType(btn);
  // Re-select location
  if (lj.locationId) document.getElementById('loc-select').value = lj.locationId;
  window.scrollTo(0, 0);
  showAlert(`Ready: ${lj.clientName || ''} ${lj.jobType ? '· ' + lj.jobType : ''}`, 'success');
}

function getLastJob() {
  try { return JSON.parse(localStorage.getItem('gt_last_job') || 'null'); } catch { return null; }
}

// ── New client inline form ─────────────────────────

function showNewClientForm() {
  show('new-client-form');
  document.getElementById('nc-name-inline').focus();
}
function hideNewClientForm() {
  hide('new-client-form');
  ['nc-name-inline','nc-phone-inline','nc-addr-inline'].forEach(id => document.getElementById(id).value = '');
}

async function saveNewClientInline() {
  const name    = document.getElementById('nc-name-inline').value.trim();
  const phone   = document.getElementById('nc-phone-inline').value.trim();
  const address = document.getElementById('nc-addr-inline').value.trim();
  if (!name) { showAlert('Client name is required.', 'error'); return; }
  const r = await post('/api/clients', { name, phone, address });
  if (r.success) {
    hideNewClientForm();
    await loadClientsForHome();
    selectClient(r.client.id, r.client.name, r.client.phone || '', r.client.address || '');
    showAlert(`${name} added!`, 'success');
  }
}

// ── Clock In / Out ─────────────────────────────────

async function refreshStatus() {
  const data = await get(`/api/entries/current/${worker.id}`);
  currentEntry = data.entry;
  renderStatus();
}

function renderStatus() {
  clearInterval(timerInterval);
  clearInterval(sbTimerInterval);

  if (currentEntry) {
    hide('start-section'); show('active-section');

    const pendingJob = getPendingJob();
    const jobType = pendingJob?.jobType || 'Working';
    const clientName = pendingJob?.clientName || '';
    document.getElementById('ac-type').textContent = jobType;
    document.getElementById('ac-client').textContent = clientName || currentEntry.location_name;
    document.getElementById('ac-detail').textContent = '📍 ' + currentEntry.location_name + (clientName ? '' : '');

    const start = new Date(currentEntry.clock_in).getTime();
    const tick = () => {
      const el = document.getElementById('ac-timer');
      const sbEl = document.getElementById('sb-timer');
      const elapsed = fmtElapsed(Date.now() - start);
      if (el) el.textContent = elapsed;
      if (sbEl) sbEl.textContent = elapsed;
    };
    tick(); timerInterval = setInterval(tick, 1000);

    // Status bar
    const sbText = document.getElementById('sb-text');
    if (sbText) sbText.textContent = (clientName || jobType) + ' · Since ' + fmtTime(currentEntry.clock_in);
    show('sb-timer-wrap');

    // Pre-fill next date
    updateNextDateSuggestion();

    // Clear selected state for next job
    selectedClientId = null; selectedClientName = null;
    selectedJobType = null;
    document.querySelectorAll('.client-btn,.job-type-btn').forEach(b => b.classList.remove('selected'));

  } else {
    show('start-section'); hide('active-section');
    document.getElementById('out-notes').value = '';
    document.getElementById('job-next-date').value = '';
    document.getElementById('next-date-hint').textContent = '';
    clearPhoto();

    // Status bar
    const sbText = document.getElementById('sb-text');
    if (sbText) sbText.textContent = 'Not clocked in';
    hide('sb-timer-wrap');
  }
}

function updateNextDateSuggestion() {
  const pendingJob = getPendingJob();
  const serviceType = pendingJob?.serviceType || '';
  const hint = document.getElementById('next-date-hint');
  const nextInput = document.getElementById('job-next-date');
  if (!nextInput) return;
  const days = REAPPLY_DAYS[serviceType];
  if (days && !nextInput.value) {
    const d = new Date(); d.setDate(d.getDate() + days);
    nextInput.value = d.toISOString().split('T')[0];
    if (hint) hint.textContent = `Suggested: ${days} days for ${serviceType}`;
  }
}

async function clockIn() {
  const locationId = document.getElementById('loc-select').value;
  if (!locationId) { showAlert('Please select a job site.', 'error'); return; }
  if (!selectedJobType) { showAlert('Please select a job type.', 'error'); return; }

  let lat = null, lng = null;
  try { const p = await getGPS(); lat = p.coords.latitude; lng = p.coords.longitude; } catch {}

  const r = await post('/api/entries/clock-in', { workerId: worker.id, locationId, latitude: lat, longitude: lng, jobType: selectedJobType });
  if (!r.success) { showAlert(r.message || 'Failed to clock in.', 'error'); return; }

  // Save pending job + last job to localStorage
  const jobData = {
    jobType: selectedJobType,
    clientId: selectedClientId,
    clientName: selectedClientName,
    clientPhone: selectedClientPhone,
    clientAddress: selectedClientAddress,
    serviceType: selectedJobType === 'Spray / Treatment' ? selectedJobType : '',
    productId: null, productName: '', locationId,
  };
  localStorage.setItem('gt_pending_job', JSON.stringify(jobData));

  const loc = document.getElementById('loc-select');
  const locationName = loc.options[loc.selectedIndex]?.text || '';
  localStorage.setItem('gt_last_job', JSON.stringify({
    clientId: selectedClientId, clientName: selectedClientName,
    clientPhone: selectedClientPhone, clientAddress: selectedClientAddress,
    jobType: selectedJobType, locationId, locationName,
  }));

  showLastJobButton();
  await refreshStatus();
  showAlert(selectedClientName ? `Started for ${selectedClientName}!` : `${selectedJobType} started!`, 'success');
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

  const job = (pendingJob?.clientName || pendingJob?.serviceType) ? {
    clientId: pendingJob.clientId,
    clientName: pendingJob.clientName,
    clientPhone: pendingJob.clientPhone,
    clientAddress: pendingJob.clientAddress,
    serviceType: pendingJob.serviceType,
    product: pendingJob.productName || pendingJob.serviceType || null,
    nextServiceDate,
  } : null;

  const r = await post('/api/entries/clock-out', { workerId: worker.id, latitude: lat, longitude: lng, notes, photo: photoData, job });
  if (r.success) {
    localStorage.removeItem('gt_pending_job');
    clearPhoto();
    await refreshStatus(); await loadWeekHours();
    showAlert(`Job complete! Worked ${fmtDur(r.entry.duration_minutes)}.`, 'success');
  } else {
    showAlert(r.message || 'Failed.', 'error');
  }
}

// ── Jobs Tab ───────────────────────────────────────

async function loadJobs(all = false) {
  let url = `/api/entries/worker/${worker.id}`;
  if (!all) { const d = new Date(); d.setDate(d.getDate() - 30); url += '?startDate=' + d.toISOString().split('T')[0]; }
  const entries = await get(url);
  const el = document.getElementById('jobs-list');
  if (!entries.length) { el.innerHTML = '<div class="table-empty">No jobs yet — start a job from Home</div>'; return; }
  el.innerHTML = entries.map(e => {
    const jobType = e.job_type || 'General Work';
    const initials = jobType.replace(/[^A-Za-z ]/g,'').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()||'JB';
    const dur = e.duration_minutes ? fmtDur(e.duration_minutes) : null;
    const col = jobTypeColor(jobType);
    return `<div class="job-card">
      <div class="job-avatar" style="background:${col.bg};color:${col.text}">${esc(initials)}</div>
      <div class="job-card-body">
        <div class="job-card-top">
          <div>
            <div class="job-card-name">${esc(jobType)}</div>
            <div class="job-card-addr">📍 ${esc(e.location_name||'Unknown')}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${!e.clock_out ? '<span class="badge badge-success">Active</span>' : ''}
            ${dur ? `<div class="job-card-dur">⏱ ${dur}</div>` : ''}
            <div class="job-card-date">${fmtDate(e.clock_in)}</div>
          </div>
        </div>
        ${e.notes ? `<div class="job-card-notes">📝 ${esc(e.notes)}</div>` : ''}
        ${e.has_photo ? `<button class="btn btn-outline btn-sm" style="margin-top:.4rem;font-size:.72rem" onclick="viewPhoto(${e.id})">📷 Photo</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function jobTypeColor(type) {
  const t = (type||'').toLowerCase();
  if (t.includes('mow')) return { bg:'#d1fae5', text:'#065f46' };
  if (t.includes('trim')||t.includes('edg')) return { bg:'#dbeafe', text:'#1e40af' };
  if (t.includes('landscape')||t.includes('general')) return { bg:'#fef3c7', text:'#92400e' };
  if (t.includes('weed')) return { bg:'#fef9c3', text:'#854d0e' };
  if (t.includes('spray')||t.includes('treatment')) return { bg:'#fee2e2', text:'#991b1b' };
  if (t.includes('fert')) return { bg:'#dcfce7', text:'#166534' };
  return { bg:'var(--green-pale)', text:'var(--green-dark)' };
}

// ── Clients Tab ────────────────────────────────────

async function loadClientsTab() {
  const el = document.getElementById('clients-tab-list');
  if (!allClientsCache.length) { el.innerHTML = '<div class="table-empty">No clients yet</div>'; return; }
  el.innerHTML = allClientsCache.map(c => `
    <div class="worker-client-row" onclick="openClientHistory(${c.id},'${esc(c.name)}')">
      <div>
        <div class="wcr-name">${esc(c.name)}</div>
        <div class="wcr-sub">${[c.phone,c.address].filter(Boolean).join(' · ')||'No contact info'}</div>
      </div>
      <span style="color:var(--gray-300);font-size:1.1rem">›</span>
    </div>`).join('');
}

async function openClientHistory(id, name) {
  const records = await get(`/api/clients/${id}/history`);
  const hist = records.length
    ? records.map(r => {
        const col = jobTypeColor(r.category || r.product || '');
        const initials = (r.category||r.product||'?').slice(0,2).toUpperCase();
        return `<div class="client-hist-row">
          <div class="hist-dot" style="background:${col.bg};color:${col.text}">${initials}</div>
          <div>
            <div class="hist-product">${esc(r.product||'Service')}</div>
            <div class="hist-date">${fmtDate(r.applied_at||r.created_at)} ${r.worker_name ? '· ' + esc(r.worker_name) : ''}</div>
            ${r.notes ? `<div class="hist-notes">${esc(r.notes)}</div>` : ''}
          </div>
        </div>`;
      }).join('')
    : '<div class="table-empty">No service history yet</div>';

  // Render into an overlay/modal
  let overlay = document.getElementById('client-hist-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'client-hist-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:flex;align-items:flex-end;padding:0';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div style="background:#fff;width:100%;max-height:85vh;border-radius:var(--r-lg) var(--r-lg) 0 0;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;border-bottom:1px solid var(--gray-100)">
        <div style="font-weight:800;font-size:1rem">${esc(name)}</div>
        <button onclick="document.getElementById('client-hist-overlay').style.display='none'" style="background:none;border:none;font-size:1.25rem;cursor:pointer;color:var(--gray-400)">✕</button>
      </div>
      <div style="overflow-y:auto;padding:.5rem 1.25rem 2rem">${hist}</div>
    </div>`;
  overlay.style.display = 'flex';
  overlay.onclick = e => { if (e.target === overlay) overlay.style.display = 'none'; };
}

// ── Hours Tab ──────────────────────────────────────

async function loadWeekHours() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay());
  const start = d.toISOString().split('T')[0];
  weekEntries = await get(`/api/entries/worker/${worker.id}?startDate=${start}`);
  const mins = weekEntries.reduce((s,e) => s + (e.duration_minutes||0), 0);
  document.getElementById('week-hours').textContent = fmtDur(mins) || '0h';
  const byDay = {};
  weekEntries.forEach(e => { const day = fmtDate(e.clock_in); byDay[day] = (byDay[day]||0) + (e.duration_minutes||0); });
  const bd = document.getElementById('week-breakdown');
  const days = Object.keys(byDay);
  if (!days.length) { bd.innerHTML = '<div class="table-empty">No entries this week</div>'; return; }
  bd.innerHTML = days.map(day => `
    <div class="entry-row">
      <div class="entry-main">
        <div class="entry-loc">${esc(day)}</div>
        <div class="entry-dur">${fmtDur(byDay[day])||'0m'}</div>
      </div>
    </div>`).join('');
}

function exportHoursCSV() {
  if (!weekEntries.length) { showAlert('Load the Hours tab first.', 'error'); return; }
  const hdr = ['Date','Location','Clock In','Clock Out','Duration (min)','Duration (hrs)','Notes'];
  const rows = weekEntries.map(e => [
    fmtDate(e.clock_in), e.location_name, fmtDateTime(e.clock_in),
    e.clock_out ? fmtDateTime(e.clock_out) : '',
    e.duration_minutes||'', e.duration_minutes ? (e.duration_minutes/60).toFixed(2) : '', e.notes||''
  ]);
  const csv = [hdr,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})),
    download: `hours-${worker.name.replace(/\s+/g,'-')}-${today()}.csv`
  });
  a.click();
}

// ── Photo ──────────────────────────────────────────

function handlePhoto(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 900; let w = img.width, h = img.height;
      if (w > MAX) { h = h*MAX/w; w = MAX; }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img,0,0,w,h);
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
  const inp = document.getElementById('photo-input');
  if (inp) inp.value = '';
  const prev = document.getElementById('photo-preview');
  if (prev) prev.src = '';
  hide('photo-preview-wrap');
}

async function viewPhoto(entryId) {
  const data = await get(`/api/entries/${entryId}/photo`);
  if (!data.photo) { showAlert('No photo for this entry.', 'error'); return; }
  document.getElementById('photo-modal-img').src = data.photo;
  show('photo-modal');
}
function closePhotoModal() { hide('photo-modal'); document.getElementById('photo-modal-img').src = ''; }

// ── Push Notifications ─────────────────────────────

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
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey) });
    await post('/api/push/subscribe', { workerId: worker.id, subscription: sub.toJSON() });
  } catch {}
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Helpers ────────────────────────────────────────

function getGPS() {
  return new Promise((res,rej) => {
    if (!navigator.geolocation) { rej(); return; }
    navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 });
  });
}
function fmtElapsed(ms) {
  const s = Math.floor(ms/1000);
  return `${Math.floor(s/3600)}:${pad(Math.floor((s%3600)/60))}:${pad(s%60)}`;
}
function fmtDur(m) {
  if (!m) return null;
  const h = Math.floor(m/60), min = m%60;
  return h===0 ? `${min}m` : min===0 ? `${h}h` : `${h}h ${min}m`;
}
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}) : ''; }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}) : ''; }
function fmtDateShort(iso) { return iso ? new Date(iso+'T12:00:00').toLocaleDateString([],{month:'short',day:'numeric'}) : ''; }
function fmtDateTime(iso) { const d=new Date(iso); return d.toLocaleDateString()+' '+d.toLocaleTimeString(); }
function today() { return new Date().toISOString().split('T')[0]; }
function pad(n) { return String(n).padStart(2,'0'); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function show(id) { const el=document.getElementById(id); if(el) el.classList.remove('section-hidden'); }
function hide(id) { const el=document.getElementById(id); if(el) el.classList.add('section-hidden'); }
function showLoginErr(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg; show('login-error');
  setTimeout(()=>hide('login-error'), 5000);
}
function showAlert(msg, type) {
  const el = document.getElementById('app-alert');
  el.className = `alert alert-${type==='error'?'error':'success'}`;
  el.textContent = msg; show('app-alert');
  setTimeout(()=>hide('app-alert'), 5000);
}
async function get(url) { const r=await fetch(url); return r.json(); }
async function post(url, body) {
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}
