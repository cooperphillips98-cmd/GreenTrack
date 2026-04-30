const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Worker auth
app.post('/api/auth/login', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ success: false, message: 'Name and PIN required.' });
  const worker = db.getWorkerByCredentials(name.trim(), pin.trim());
  if (worker) {
    res.json({ success: true, worker: { id: worker.id, name: worker.name } });
  } else {
    res.status(401).json({ success: false, message: 'Invalid name or PIN.' });
  }
});

// Admin auth
app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (db.checkAdminPassword(password)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password.' });
  }
});

// Locations
app.get('/api/locations', (req, res) => res.json(db.getLocations()));

// Clock in
app.post('/api/entries/clock-in', (req, res) => {
  const { workerId, locationId, latitude, longitude } = req.body;
  if (!workerId || !locationId) return res.status(400).json({ success: false, message: 'Missing required fields.' });
  if (db.getCurrentEntry(workerId)) return res.status(400).json({ success: false, message: 'Already clocked in.' });
  const entry = db.clockIn(workerId, locationId, latitude, longitude);
  res.json({ success: true, entry });
});

// Clock out
app.post('/api/entries/clock-out', (req, res) => {
  const { workerId, latitude, longitude, notes } = req.body;
  const current = db.getCurrentEntry(workerId);
  if (!current) return res.status(400).json({ success: false, message: 'Not currently clocked in.' });
  const entry = db.clockOut(current.id, latitude, longitude, notes);
  res.json({ success: true, entry });
});

// Get current entry
app.get('/api/entries/current/:workerId', (req, res) => {
  res.json({ entry: db.getCurrentEntry(req.params.workerId) || null });
});

// Worker history
app.get('/api/entries/worker/:workerId', (req, res) => {
  const { startDate, endDate } = req.query;
  res.json(db.getWorkerEntries(req.params.workerId, startDate, endDate));
});

// Admin: stats
app.get('/api/admin/stats', (req, res) => res.json(db.getStats()));

// Admin: active workers
app.get('/api/admin/active', (req, res) => res.json(db.getActiveEntries()));

// Admin: all entries
app.get('/api/admin/entries', (req, res) => {
  const { workerId, locationId, startDate, endDate } = req.query;
  res.json(db.getAllEntries({ workerId, locationId, startDate, endDate }));
});

// Admin: force clock out
app.post('/api/admin/entries/:id/clock-out', (req, res) => {
  const entry = db.clockOut(req.params.id, null, null, 'Clocked out by admin');
  res.json({ success: true, entry });
});

// Admin: workers
app.get('/api/admin/workers', (req, res) => res.json(db.getWorkers()));

app.post('/api/admin/workers', (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ success: false, message: 'Name and PIN required.' });
  try {
    res.json({ success: true, worker: db.addWorker(name.trim(), pin.trim()) });
  } catch (e) {
    res.status(400).json({ success: false, message: 'A worker with that name already exists.' });
  }
});

app.put('/api/admin/workers/:id', (req, res) => {
  const { name, pin } = req.body;
  db.updateWorker(req.params.id, name, pin || null);
  res.json({ success: true });
});

app.delete('/api/admin/workers/:id', (req, res) => {
  db.deleteWorker(req.params.id);
  res.json({ success: true });
});

// Admin: locations
app.post('/api/admin/locations', (req, res) => {
  const { name, address } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Name required.' });
  res.json({ success: true, location: db.addLocation(name.trim(), address) });
});

app.delete('/api/admin/locations/:id', (req, res) => {
  db.deleteLocation(req.params.id);
  res.json({ success: true });
});

// Admin: change password
app.put('/api/admin/settings/password', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: 'Password required.' });
  db.updateAdminPassword(password);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌿 GreenTrack running at http://localhost:${PORT}`);
  console.log(`   Worker app:  http://localhost:${PORT}`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin.html`);
  console.log(`   Default admin password: admin1234\n`);
});
