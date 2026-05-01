console.log('SERVER STARTING...');
const express = require('express');
const path = require('path');
const webpush = require('web-push');
const db = require('./database');

const app = express();
app.use(express.json({ limit: '5mb' }));

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

app.use(express.static(path.join(__dirname, 'public')));

// Auth
app.post('/api/auth/login', async (req, res) => {
  const { name, pin } = req.body;
  if (!name || !pin) return res.status(400).json({ success: false, message: 'Name and PIN required.' });
  const worker = await db.getWorkerByCredentials(name.trim(), pin.trim());
  if (worker) {
    res.json({ success: true, worker: { id: worker.id, name: worker.name, sprayAccess: !!worker.spray_access } });
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

app.get('/api/config', async (req, res) => {
  const vapidPublic = await db.getSetting('vapid_public').catch(() => null);
  res.json({ mapboxToken: process.env.MAPBOX_TOKEN || '', vapidPublicKey: vapidPublic || '' });
});

// Clients
app.get('/api/clients', async (req, res) => res.json(await db.getClients()));
app.post('/api/clients', async (req, res) => {
  const { name, phone, address, notes } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Name required.' });
  res.json({ success: true, client: await db.addClient(name.trim(), phone, address, notes) });
});
app.put('/api/clients/:id', async (req, res) => {
  const { name, phone, address, notes } = req.body;
  await db.updateClient(req.params.id, name, phone, address, notes);
  res.json({ success: true });
});
app.delete('/api/clients/:id', async (req, res) => {
  await db.deleteClient(req.params.id);
  res.json({ success: true });
});
app.get('/api/admin/clients', async (req, res) => res.json(await db.getAllClientsWithStats()));

// Spray Products
app.get('/api/spray/products', async (req, res) => res.json(await db.getSprayProducts()));
app.post('/api/spray/products', async (req, res) => {
  const { name, type, notes, reapplyMin, reapplyMax } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Name required.' });
  res.json({ success: true, product: await db.addSprayProduct(name, type, notes, reapplyMin, reapplyMax) });
});
app.put('/api/spray/products/:id', async (req, res) => {
  const { name, type, notes, reapplyMin, reapplyMax } = req.body;
  await db.updateSprayProduct(req.params.id, name, type, notes, reapplyMin, reapplyMax);
  res.json({ success: true });
});
app.delete('/api/spray/products/:id', async (req, res) => {
  await db.deleteSprayProduct(req.params.id);
  res.json({ success: true });
});

// Locations
app.get('/api/locations', async (req, res) => res.json(await db.getLocations()));

// Time Entries
app.post('/api/entries/clock-in', async (req, res) => {
  const { workerId, locationId, latitude, longitude, jobType } = req.body;
  if (!workerId || !locationId) return res.status(400).json({ success: false, message: 'Missing required fields.' });
  if (await db.getCurrentEntry(workerId)) return res.status(400).json({ success: false, message: 'Already clocked in.' });

  const location = await db.getLocationById(locationId);
  if (location && location.polygon && location.polygon.length >= 3) {
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'This location requires GPS verification. Please allow location access and try again.' });
    }
    if (!pointInPolygon(latitude, longitude, location.polygon)) {
      return res.status(400).json({ success: false, message: `You are outside the property boundary for ${location.name}. Move to the job site and try again.` });
    }
  } else if (location && location.geofence_lat && location.geofence_lng) {
    if (latitude == null || longitude == null) {
      return res.status(400).json({ success: false, message: 'This location requires GPS verification. Please allow location access and try again.' });
    }
    const distance = Math.round(haversineMeters(latitude, longitude, location.geofence_lat, location.geofence_lng));
    const radius = location.geofence_radius || 150;
    if (distance > radius) {
      return res.status(400).json({ success: false, message: `You are ${distance}m from ${location.name}. Must be within ${radius}m to clock in.` });
    }
  }

  const entry = await db.clockIn(workerId, locationId, latitude, longitude, jobType || null);
  res.json({ success: true, entry });
});

app.post('/api/entries/clock-out', async (req, res) => {
  const { workerId, latitude, longitude, notes, photo, job } = req.body;
  const current = await db.getCurrentEntry(workerId);
  if (!current) return res.status(400).json({ success: false, message: 'Not currently clocked in.' });
  const entry = await db.clockOut(current.id, latitude, longitude, notes, photo);

  // If job details were provided, create a spray/job record
  if (job && job.product) {
    await db.addSprayRecord({
      workerId,
      locationId: current.location_id,
      clientId: job.clientId || null,
      clientName: job.clientName || null,
      clientPhone: job.clientPhone || null,
      clientAddress: job.clientAddress || null,
      product: job.product,
      category: job.serviceType || null,
      appliedAt: current.clock_in,
      notes: notes || null,
      nextServiceDate: job.nextServiceDate || null,
      timeEntryId: current.id,
    });
  }

  res.json({ success: true, entry });
});

app.get('/api/entries/current/:workerId', async (req, res) => {
  res.json({ entry: await db.getCurrentEntry(req.params.workerId) });
});

app.get('/api/entries/worker/:workerId', async (req, res) => {
  const { startDate, endDate } = req.query;
  res.json(await db.getWorkerEntries(req.params.workerId, startDate, endDate));
});

app.get('/api/entries/:id/photo', async (req, res) => {
  const photo = await db.getEntryPhoto(req.params.id);
  if (!photo) return res.status(404).json({ photo: null });
  res.json({ photo });
});

// Push Notifications
app.post('/api/push/subscribe', async (req, res) => {
  const { workerId, subscription } = req.body;
  if (!workerId || !subscription) return res.status(400).json({ success: false });
  await db.savePushSubscription(workerId, subscription.endpoint, subscription);
  res.json({ success: true });
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) await db.removePushSubscription(endpoint);
  res.json({ success: true });
});

// Spray / Job Records
app.get('/api/spray/records', async (req, res) => {
  const { workerId, startDate, endDate } = req.query;
  res.json(await db.getWorkerSprayRecords(workerId, startDate, endDate));
});

app.post('/api/spray/records', async (req, res) => {
  const { workerId, locationId, clientId, clientName, clientPhone, clientAddress, product, category, appliedAt, notes, nextServiceDate, timeEntryId } = req.body;
  if (!workerId || !product) return res.status(400).json({ success: false, message: 'Worker and product required.' });
  const record = await db.addSprayRecord({ workerId, locationId, clientId, clientName, clientPhone, clientAddress, product, category, appliedAt, notes, nextServiceDate, timeEntryId });
  res.json({ success: true, record });
});

app.get('/api/spray/upcoming', async (req, res) => {
  const { workerId, days } = req.query;
  res.json(await db.getUpcomingJobs(workerId, days || 30));
});

function sundayStart() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

// Admin
app.get('/api/admin/stats', async (req, res) => {
  try { res.json(await db.getStats(sundayStart())); }
  catch (e) { console.error('Stats error:', e.message); res.json({ totalWorkers: 0, clockedIn: 0, todayHours: 0, weekHours: 0 }); }
});
app.get('/api/admin/active', async (req, res) => res.json(await db.getActiveEntries()));
app.get('/api/admin/overtime', async (req, res) => res.json(await db.getWeeklyHoursByWorker(sundayStart())));

app.get('/api/admin/entries', async (req, res) => {
  const { workerId, locationId, startDate, endDate } = req.query;
  res.json(await db.getAllEntries({ workerId, locationId, startDate, endDate }));
});

app.post('/api/admin/entries/:id/clock-out', async (req, res) => {
  const entry = await db.clockOut(req.params.id, null, null, 'Clocked out by admin', null);
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
app.put('/api/admin/workers/:id/spray-access', async (req, res) => {
  await db.setWorkerSprayAccess(req.params.id, req.body.spray_access);
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
app.put('/api/admin/locations/:id/polygon', async (req, res) => {
  const { polygon } = req.body;
  await db.setLocationPolygon(req.params.id, polygon);
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

app.get('/api/admin/spray', async (req, res) => {
  const { workerId, locationId, clientId, startDate, endDate, upcoming } = req.query;
  res.json(await db.getAllSprayRecords({ workerId, locationId, clientId, startDate, endDate, upcoming: upcoming === 'true' }));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
  db.init().then(async () => {
    console.log('Database connected OK');
    try {
      let pub = await db.getSetting('vapid_public');
      let priv = await db.getSetting('vapid_private');
      if (!pub || !priv) {
        const keys = webpush.generateVAPIDKeys();
        pub = keys.publicKey; priv = keys.privateKey;
        await db.setSetting('vapid_public', pub);
        await db.setSetting('vapid_private', priv);
        console.log('Generated new VAPID keys');
      }
      webpush.setVapidDetails('mailto:admin@legacylandscape.com', pub, priv);
      console.log('VAPID keys loaded');

      setInterval(async () => {
        try {
          const checks = await db.getOvertimeChecks();
          for (const row of checks) {
            try {
              await webpush.sendNotification(
                JSON.parse(row.subscription),
                JSON.stringify({
                  title: 'Clock Out Reminder',
                  body: `You've been clocked in at ${row.location_name} for 8+ hours. Don't forget to clock out!`,
                  icon: '/logo.png'
                })
              );
            } catch {}
            await db.markOvertimeNotified(row.entry_id);
          }
        } catch (e) { console.error('Push check error:', e.message); }
      }, 30 * 60 * 1000);
    } catch (e) { console.error('VAPID init error:', e.message); }
  }).catch(err => { console.error('Database error:', err.message); });
});
