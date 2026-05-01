let allEntries = [];
let activeWorkers = [];
let allLocations = [];
let propertyMap = null;
let drawnItems = null;
let MAPBOX_TOKEN = null;

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
  try { const cfg = await get('/api/config'); MAPBOX_TOKEN = cfg.mapboxToken; } catch {}
  await Promise.all([loadStats(), loadActive(), loadWorkers(), loadLocations(), loadOvertime()]);
  setInterval(updateTimers, 1000);
  setInterval(() => { if (!document.getElementById('tab-dashboard').classList.contains('section-hidden')) { loadStats(); loadActive(); loadOvertime(); } }, 30000);
}

function showTab(btn, tab) {
  ['dashboard','entries','spray','workers','locations','settings'].forEach(t => {
    document.getElementById('tab-' + t).classList.add('section-hidden');
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.remove('section-hidden');
  btn.classList.add('active');
  if (tab === 'entries') loadEntries();
  if (tab === 'spray')   loadSprayLog();
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
        ? `<span class="badge badge-warning-hrs">${hrs}h — approaching 40h</span>`
        : `<span class="badge badge-gray">${hrs}h</span>`;
    return `<div class="active-row">
      <div>
        <div class="active-name">${esc(w.worker_name)}</div>
        <div style="background:var(--gray-200);border-radius:99px;height:5px;width:120px;margin-top:.4rem">
          <div style="background:${w.week_minutes>=2400?'var(--red)':w.week_minutes>=2100?'var(--amber)':'var(--green)'};height:5px;border-radius:99px;width:${pct}%"></div>
        </div>
      </div>
      ${badge}
    </div>`;
  }).join('');
}

let allSprayRecords = [];

async function loadSprayLog() {
  const params = new URLSearchParams();
  const w = document.getElementById('sp-f-worker')?.value;
  const l = document.getElementById('sp-f-location')?.value;
  const s = document.getElementById('sp-f-start')?.value;
  const e = document.getElementById('sp-f-end')?.value;
  if (w) params.set('workerId', w);
  if (l) params.set('locationId', l);
  if (s) params.set('startDate', s);
  if (e) params.set('endDate', e);
  allSprayRecords = await get('/api/admin/spray?' + params);
  const tbody = document.getElementById('spray-tbody');
  if (!allSprayRecords.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No records found</td></tr>'; return;
  }
  tbody.innerHTML = allSprayRecords.map(r => `<tr>
    <td>${fmtDate(r.applied_at)}</td>
    <td><strong>${esc(r.worker_name)}</strong></td>
    <td>${r.location_name ? esc(r.location_name) : '<span class="text-muted">—</span>'}</td>
    <td>${r.category ? `<span class="badge badge-gray">${esc(r.category)}</span>` : '<span class="text-muted">—</span>'}</td>
    <td><strong>${esc(r.product)}</strong></td>
    <td>${r.notes ? esc(r.notes) : '<span class="text-muted">—</span>'}</td>
  </tr>`).join('');
}

function exportSprayCSV() {
  if (!allSprayRecords.length) { showAlert('No records to export. Apply filters first.', 'warning'); return; }
  const hdr = ['Date', 'Worker', 'Location', 'Category', 'Product', 'Notes'];
  const rows = allSprayRecords.map(r => [
    fmtDate(r.applied_at), r.worker_name, r.location_name || '',
    r.category || '', r.product, r.notes || ''
  ]);
  const csv = [hdr, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: `spray-log-${new Date().toISOString().split('T')[0]}.csv`
  });
  a.click();
}

async function forceClockOut(id, name) {
  if (!confirm(`Clock out ${name}?`)) return;
  const r = await post(`/api/admin/entries/${id}/clock-out`, {});
  if (r.success) { showAlert(`${name} clocked out.`, 'success'); loadActive(); loadStats(); }
}

async function loadWorkers() {
  const workers = await get('/api/admin/workers');
  const opts = workers.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  document.getElementById('f-worker').innerHTML = '<option value="">All Workers</option>' + opts;
  const spW = document.getElementById('sp-f-worker');
  if (spW) spW.innerHTML = '<option value="">All Workers</option>' + opts;
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
  allLocations = locs;
  const opts = locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  document.getElementById('f-location').innerHTML = '<option value="">All Locations</option>' + opts;
  const spL = document.getElementById('sp-f-location');
  if (spL) spL.innerHTML = '<option value="">All Locations</option>' + opts;
  const tbody = document.getElementById('locations-tbody');
  if (!locs.length) { tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No locations yet</td></tr>'; return; }
  tbody.innerHTML = locs.map(l => {
    const hasPolygon = l.polygon && l.polygon.length >= 3;
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
        <button class="btn btn-outline btn-sm" onclick="openGeofenceModal(${l.id},'${esc(l.name)}',${l.geofence_lat || 'null'},${l.geofence_lng || 'null'},${l.geofence_radius || 150})">📍 Radius</button>
        <button class="btn btn-danger btn-sm" onclick="removeLocation(${l.id},'${esc(l.name)}')">Remove</button>
      </td>
    </tr>`;
  }).join('');
}

function openMapModal(id) {
  const loc = allLocations.find(l => l.id === id);
  if (!loc) return;
  document.getElementById('map-loc-id').value = id;
  document.getElementById('map-loc-name').textContent = loc.name;
  document.getElementById('map-search').value = '';
  document.getElementById('m-property-map').classList.add('open');

  setTimeout(() => {
    if (propertyMap) { propertyMap.remove(); propertyMap = null; }

    const center = loc.geofence_lat && loc.geofence_lng
      ? [loc.geofence_lat, loc.geofence_lng] : [39.5, -98.35];

    propertyMap = L.map('property-map').setView(center, loc.geofence_lat ? 19 : 4);

    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`, {
      attribution: '© <a href="https://mapbox.com">Mapbox</a>',
      maxZoom: 22, tileSize: 256,
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

    propertyMap.on(L.Draw.Event.CREATED, e => {
      drawnItems.clearLayers();
      drawnItems.addLayer(e.layer);
    });
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
    } else {
      showAlert('Address not found.', 'error');
    }
  } catch { showAlert('Search failed.', 'error'); }
}

function closeMapModal() {
  document.getElementById('m-property-map').classList.remove('open');
  if (propertyMap) { propertyMap.remove(); propertyMap = null; }
  drawnItems = null;
}

function clearMapPolygon() {
  if (drawnItems) drawnItems.clearLayers();
}

async function savePolygon() {
  const id = document.getElementById('map-loc-id').value;
  let polygon = null;
  drawnItems.eachLayer(layer => {
    if (layer instanceof L.Polygon)
      polygon = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
  });
  await put(`/api/admin/locations/${id}/polygon`, { polygon });
  closeMapModal();
  loadLocations();
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
    () => { status.textContent = 'Location unavailable. Check permissions.'; },
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
  closeModal('m-set-geofence');
  loadLocations();
  showAlert('Geofence saved.', 'success');
}

async function clearGeofence() {
  const id = document.getElementById('gf-loc-id').value;
  const name = document.getElementById('gf-loc-name').textContent;
  if (!confirm(`Remove geofence from "${name}"? Workers will be able to clock in from anywhere.`)) return;
  await put(`/api/admin/locations/${id}`, { geofence_lat: null, geofence_lng: null, geofence_radius: null });
  closeModal('m-set-geofence');
  loadLocations();
  showAlert('Geofence removed.', 'success');
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
