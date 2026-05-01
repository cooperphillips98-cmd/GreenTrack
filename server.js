console.log('SERVER STARTING...');
const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
app.use(express.json());

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/login', async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ success: false, message: 'Name and PIN required.' });
  const worker = await db.getWorkerByCredentials(name.trim(), pin.trim());
  if (worker) {
    res.json({ success: true, worker: { id: worker.id, name: worker.name } });
  } else {
    res.status(401).json({ success: false, message: 'Invalid name or PIN.' });
  }
});

app.post('/api/admin/auth', async (req, res) => {
  const { password } = req.body;
  if (await db.checkAdminPassword(password)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Invalid password.' });
  }
});

app.get('/api/locations', async (req, res) => res.json(await db.getLocations()));

app.post('/api/entries/clock-in', async (req, res) => {
  const { workerId, locationId, latitude, longitude } = req.body;
  if (!workerId || !locationId) return res.status(400).json({ success: false, message: 'Missing required fields.' });
  if (await db.getCurrentEntry(workerId)) return res.status(400).json({ success: false, message: 'Already clocked in.' });

  const location = await db.getLocationById(locationId);
  if (location && location.geofence_lat && location.geofence_lng) {
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'This location requires GPS verification. Please allow location access and try again.' });
    }
    const distance = Math.round(haversineMeters(latitude, longitude, location.geofence_lat, location.geofence_lng));
    const radius = location.geofence_radius || 150;
    if (distance > radius) {
      return res.status(400).json({ success: false, message: `You are ${distance}m from ${location.name}. Must be within ${radius}m to clock in.` });
    }
  }

  const entry = await db.clockIn(workerId, locationId, latitude, longitude);
  res.json({ success: true, entry });
});

app.post('/api/entries/clock-out', async (req, res) => {
  const { workerId, latitude, longitude, notes } = req.body;
  const current = await db.getCurrentEntry(workerId);
  if (!current) return res.status(400).json({ success: false, message: 'Not currently clocked in.' });
  const entry = await db.clockOut(current.id, latitude, longitude, notes);
  res.json({ success: true, entry });
});

app.get('/api/entries/current/:workerId', async (req, res) => {
  res.json({ entry: await db.getCurrentEntry(req.params.workerId) });
});

app.get('/api/entries/worker/:workerId', async (req, res) => {
  const { startDate, endDate } = req.query;
  res.json(await db.getWorkerEntries(req.params.workerId, startDate, endDate));
});

app.get('/api/admin/stats', async (req, res) => res.json(await db.getStats()));
app.get('/api/admin/active', async (req, res) => res.json(await db.getActiveEntries()));

app.get('/api/admin/entries', async (req, res) => {
  const { workerId, locationId, startDate, endDate } = req.query;
  res.json(await db.getAllEntries({ workerId, locationId, startDate, endDate }));
});

app.post('/api/admin/entries/:id/clock-out', async (req, res) => {
  const entry = await db.clockOut(req.params.id, null, null, 'Clocked out by admin');
  res.json({ success: true, entry });
});

app.get('/api/admin/workers', async (req, res) => res.json(await db.getWorkers()));

app.post('/api/admin/workers', async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ success: false, message: 'Name and PIN required.' });
  try {
    res.json({ success: true, worker: await db.addWorker(name.trim(), pin.trim()) });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

app.put('/api/admin/workers/:id', async (req, res) => {
  const { name, pin } = req.body;
  await db.updateWorker(req.params.id, name, pin || null);
  res.json({ success: true });
});

app.delete('/api/admin/workers/:id', async (req, res) => {
  await db.deleteWorker(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/locations', async (req, res) => {
  const { name, address } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Name required.' });
  res.json({ success: true, location: await db.addLocation(name.trim(), address) });
});

app.put('/api/admin/locations/:id', async (req, res) => {
  const { geofence_lat, geofence_lng, geofence_radius } = req.body;
  await db.setLocationGeofence(req.params.id, geofence_lat, geofence_lng, geofence_radius);
  res.json({ success: true });
});

app.delete('/api/admin/locations/:id', async (req, res) => {
  await db.deleteLocation(req.params.id);
  res.json({ success: true });
});

app.put('/api/admin/settings/password', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: 'Password required.' });
  await db.updateAdminPassword(password);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  db.init().then(() => {
    console.log('Database connected OK');
  }).catch(err => {
    console.error('Database error:', err.message);
  });
});
