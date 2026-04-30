const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'data.json')
  : path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      workers: [],
      locations: [],
      entries: [],
      settings: { admin_password: 'admin1234' },
      nextId: { workers: 1, locations: 1, entries: 1 }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function now() {
  return new Date().toISOString();
}

module.exports = {
  getWorkerByCredentials(name, pin) {
    const db = load();
    return db.workers.find(w => w.name === name && w.pin === pin && w.active) || null;
  },
  checkAdminPassword(password) {
    return load().settings.admin_password === password;
  },
  updateAdminPassword(password) {
    const db = load(); db.settings.admin_password = password; save(db);
  },

  getWorkers() {
    return load().workers.filter(w => w.active).sort((a, b) => a.name.localeCompare(b.name));
  },
  addWorker(name, pin) {
    const db = load();
    if (db.workers.some(w => w.name === name && w.active)) throw new Error('A worker with that name already exists.');
    const worker = { id: db.nextId.workers++, name, pin, active: true, created_at: now() };
    db.workers.push(worker);
    save(db);
    return { id: worker.id, name };
  },
  updateWorker(id, name, pin) {
    const db = load();
    const w = db.workers.find(w => w.id == id);
    if (w) { w.name = name; if (pin) w.pin = pin; }
    save(db);
  },
  deleteWorker(id) {
    const db = load();
    const w = db.workers.find(w => w.id == id);
    if (w) w.active = false;
    save(db);
  },

  getLocations() {
    return load().locations.filter(l => l.active).sort((a, b) => a.name.localeCompare(b.name));
  },
  addLocation(name, address) {
    const db = load();
    const loc = { id: db.nextId.locations++, name, address: address || null, active: true, created_at: now() };
    db.locations.push(loc);
    save(db);
    return { id: loc.id, name, address };
  },
  deleteLocation(id) {
    const db = load();
    const l = db.locations.find(l => l.id == id);
    if (l) l.active = false;
    save(db);
  },

  clockIn(workerId, locationId, lat, lng) {
    const db = load();
    const entry = {
      id: db.nextId.entries++,
      worker_id: Number(workerId),
      location_id: Number(locationId),
      clock_in: now(),
      clock_out: null,
      clock_in_lat: lat || null,
      clock_in_lng: lng || null,
      clock_out_lat: null,
      clock_out_lng: null,
      duration_minutes: null,
      notes: null
    };
    db.entries.push(entry);
    save(db);
    return { id: entry.id, clock_in: entry.clock_in };
  },
  clockOut(entryId, lat, lng, notes) {
    const db = load();
    const entry = db.entries.find(e => e.id == entryId);
    if (!entry) return null;
    const clockOut = now();
    entry.clock_out = clockOut;
    entry.clock_out_lat = lat || null;
    entry.clock_out_lng = lng || null;
    entry.duration_minutes = Math.round((new Date(clockOut) - new Date(entry.clock_in)) / 60000);
    entry.notes = notes || null;
    save(db);
    return { id: entry.id, clock_out: clockOut, duration_minutes: entry.duration_minutes };
  },
  getCurrentEntry(workerId) {
    const db = load();
    const entry = db.entries.find(e => e.worker_id == workerId && !e.clock_out);
    if (!entry) return null;
    const loc = db.locations.find(l => l.id === entry.location_id);
    return { ...entry, location_name: loc ? loc.name : 'Unknown' };
  },
  getActiveEntries() {
    const db = load();
    return db.entries
      .filter(e => !e.clock_out)
      .map(e => {
        const worker = db.workers.find(w => w.id === e.worker_id);
        const loc    = db.locations.find(l => l.id === e.location_id);
        return { ...e, worker_name: worker ? worker.name : 'Unknown', location_name: loc ? loc.name : 'Unknown' };
      })
      .sort((a, b) => a.clock_in.localeCompare(b.clock_in));
  },
  getWorkerEntries(workerId, startDate, endDate) {
    const db = load();
    let entries = db.entries.filter(e => e.worker_id == workerId);
    if (startDate) entries = entries.filter(e => e.clock_in.slice(0, 10) >= startDate);
    if (endDate)   entries = entries.filter(e => e.clock_in.slice(0, 10) <= endDate);
    return entries
      .sort((a, b) => b.clock_in.localeCompare(a.clock_in))
      .slice(0, 100)
      .map(e => {
        const loc = db.locations.find(l => l.id === e.location_id);
        return { ...e, location_name: loc ? loc.name : 'Unknown' };
      });
  },
  getAllEntries({ workerId, locationId, startDate, endDate }) {
    const db = load();
    let entries = [...db.entries];
    if (workerId)   entries = entries.filter(e => e.worker_id == workerId);
    if (locationId) entries = entries.filter(e => e.location_id == locationId);
    if (startDate)  entries = entries.filter(e => e.clock_in.slice(0, 10) >= startDate);
    if (endDate)    entries = entries.filter(e => e.clock_in.slice(0, 10) <= endDate);
    return entries
      .sort((a, b) => b.clock_in.localeCompare(a.clock_in))
      .map(e => {
        const worker = db.workers.find(w => w.id === e.worker_id);
        const loc    = db.locations.find(l => l.id === e.location_id);
        return { ...e, worker_name: worker ? worker.name : 'Unknown', location_name: loc ? loc.name : 'Unknown' };
      });
  },
  getStats() {
    const db = load();
    const today   = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const totalWorkers = db.workers.filter(w => w.active).length;
    const clockedIn    = db.entries.filter(e => !e.clock_out).length;
    const todayMin     = db.entries.filter(e => e.clock_in.slice(0,10) === today && e.duration_minutes).reduce((s,e) => s + e.duration_minutes, 0);
    const weekMin      = db.entries.filter(e => e.clock_in.slice(0,10) >= weekAgo && e.duration_minutes).reduce((s,e) => s + e.duration_minutes, 0);
    return {
      totalWorkers,
      clockedIn,
      todayHours: +(todayMin / 60).toFixed(1),
      weekHours:  +(weekMin  / 60).toFixed(1),
    };
  },
};
