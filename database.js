const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      pin TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      notes TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS spray_products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      notes TEXT,
      reapply_min_days INTEGER,
      reapply_max_days INTEGER,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS locations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE locations ADD COLUMN IF NOT EXISTS geofence_lat REAL;
    ALTER TABLE locations ADD COLUMN IF NOT EXISTS geofence_lng REAL;
    ALTER TABLE locations ADD COLUMN IF NOT EXISTS geofence_radius INTEGER DEFAULT 150;
    ALTER TABLE locations ADD COLUMN IF NOT EXISTS polygon JSONB;
    CREATE TABLE IF NOT EXISTS time_entries (
      id SERIAL PRIMARY KEY,
      worker_id INTEGER REFERENCES workers(id),
      location_id INTEGER REFERENCES locations(id),
      clock_in TIMESTAMPTZ NOT NULL,
      clock_out TIMESTAMPTZ,
      clock_in_lat REAL,
      clock_in_lng REAL,
      clock_out_lat REAL,
      clock_out_lng REAL,
      duration_minutes INTEGER,
      notes TEXT
    );
    ALTER TABLE workers ADD COLUMN IF NOT EXISTS spray_access BOOLEAN DEFAULT FALSE;
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS photo TEXT;
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS notified_overtime BOOLEAN DEFAULT FALSE;
    ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS job_type TEXT;
    CREATE TABLE IF NOT EXISTS spray_records (
      id SERIAL PRIMARY KEY,
      worker_id INTEGER REFERENCES workers(id),
      location_id INTEGER REFERENCES locations(id),
      client_id INTEGER REFERENCES clients(id),
      client_name TEXT,
      client_phone TEXT,
      client_address TEXT,
      product TEXT NOT NULL,
      category TEXT,
      applied_at TIMESTAMPTZ NOT NULL,
      notes TEXT,
      next_service_date DATE,
      time_entry_id INTEGER REFERENCES time_entries(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE spray_records ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id);
    ALTER TABLE spray_records ADD COLUMN IF NOT EXISTS client_name TEXT;
    ALTER TABLE spray_records ADD COLUMN IF NOT EXISTS client_phone TEXT;
    ALTER TABLE spray_records ADD COLUMN IF NOT EXISTS client_address TEXT;
    ALTER TABLE spray_records ADD COLUMN IF NOT EXISTS next_service_date DATE;
    ALTER TABLE spray_records ADD COLUMN IF NOT EXISTS time_entry_id INTEGER REFERENCES time_entries(id);
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      worker_id INTEGER REFERENCES workers(id),
      endpoint TEXT UNIQUE NOT NULL,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO settings (key,value) VALUES ('admin_password','admin1234') ON CONFLICT DO NOTHING;
  `);

  // Seed default products if none exist
  const { rows } = await pool.query('SELECT COUNT(*) FROM spray_products');
  if (parseInt(rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO spray_products (name,type,notes,reapply_min_days,reapply_max_days) VALUES
        ('Pre-emergent (Prodiamine)', 'Pre-emergent', 'Apply before soil temp hits 55°F', 90, 180),
        ('Post-emergent Broadleaf', 'Weed Control', 'Spot treat actively growing weeds', 14, 28),
        ('Slow-Release Fertilizer 16-4-8', 'Fertilizer', 'Standard season fertilizer', 28, 42),
        ('Winterizer Fertilizer', 'Fertilizer', 'Late fall before dormancy', 180, 365),
        ('Grub Control (Dylox)', 'Pest Control', 'Best applied June–July', 180, 365),
        ('Fungicide (Heritage G)', 'Pest Control', 'Treat brown patch, dollar spot', 14, 28),
        ('Fire Ant Bait', 'Pest Control', 'Broadcast or mound treat', 60, 90),
        ('Horticultural Oil', 'Pre-emergent', 'Dormant season tree & shrub spray', 60, 120)
    `);
  }
}

module.exports = {
  init,

  // Settings
  async getSetting(key) {
    const r = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
    return r.rows[0]?.value || null;
  },
  async setSetting(key, value) {
    await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2', [key, value]);
  },
  async checkAdminPassword(password) {
    const r = await pool.query("SELECT value FROM settings WHERE key='admin_password'");
    return r.rows[0]?.value === password;
  },
  async updateAdminPassword(password) {
    await pool.query("UPDATE settings SET value=$1 WHERE key='admin_password'", [password]);
  },

  // Workers
  async getWorkers() {
    const r = await pool.query('SELECT id,name,active,spray_access,created_at FROM workers WHERE active=TRUE ORDER BY name');
    return r.rows;
  },
  async getWorkerByCredentials(name, pin) {
    const r = await pool.query('SELECT * FROM workers WHERE name=$1 AND pin=$2 AND active=TRUE', [name, pin]);
    return r.rows[0] || null;
  },
  async setWorkerSprayAccess(id, access) {
    await pool.query('UPDATE workers SET spray_access=$1 WHERE id=$2', [!!access, id]);
  },
  async addWorker(name, pin) {
    try {
      const r = await pool.query('INSERT INTO workers (name,pin) VALUES ($1,$2) RETURNING id,name', [name, pin]);
      return r.rows[0];
    } catch {
      throw new Error('A worker with that name already exists.');
    }
  },
  async updateWorker(id, name, pin) {
    if (pin) {
      await pool.query('UPDATE workers SET name=$1,pin=$2 WHERE id=$3', [name, pin, id]);
    } else {
      await pool.query('UPDATE workers SET name=$1 WHERE id=$2', [name, id]);
    }
  },
  async deleteWorker(id) {
    await pool.query('UPDATE workers SET active=FALSE WHERE id=$1', [id]);
  },

  // Clients
  async getClients() {
    const r = await pool.query('SELECT * FROM clients WHERE active=TRUE ORDER BY name');
    return r.rows;
  },
  async addClient(name, phone, address, notes) {
    const r = await pool.query(
      'INSERT INTO clients(name,phone,address,notes) VALUES($1,$2,$3,$4) RETURNING *',
      [name, phone || null, address || null, notes || null]
    );
    return r.rows[0];
  },
  async updateClient(id, name, phone, address, notes) {
    await pool.query(
      'UPDATE clients SET name=$1,phone=$2,address=$3,notes=$4 WHERE id=$5',
      [name, phone || null, address || null, notes || null, id]
    );
  },
  async deleteClient(id) {
    await pool.query('UPDATE clients SET active=FALSE WHERE id=$1', [id]);
  },
  async getClientWithStats(id) {
    const r = await pool.query(`
      SELECT c.*,
        MAX(sr.applied_at) as last_service_date,
        (SELECT sr2.product FROM spray_records sr2 WHERE sr2.client_id=c.id ORDER BY sr2.applied_at DESC LIMIT 1) as last_product,
        (SELECT sr3.next_service_date FROM spray_records sr3 WHERE sr3.client_id=c.id AND sr3.next_service_date IS NOT NULL ORDER BY sr3.applied_at DESC LIMIT 1) as next_service_date
      FROM clients c
      LEFT JOIN spray_records sr ON sr.client_id=c.id
      WHERE c.id=$1
      GROUP BY c.id
    `, [id]);
    return r.rows[0] || null;
  },
  async getAllClientsWithStats() {
    const r = await pool.query(`
      SELECT c.*,
        MAX(sr.applied_at) as last_service_date,
        (SELECT sr2.product FROM spray_records sr2 WHERE sr2.client_id=c.id ORDER BY sr2.applied_at DESC LIMIT 1) as last_product,
        (SELECT sr3.next_service_date FROM spray_records sr3 WHERE sr3.client_id=c.id AND sr3.next_service_date IS NOT NULL ORDER BY sr3.applied_at DESC LIMIT 1) as next_service_date
      FROM clients c
      LEFT JOIN spray_records sr ON sr.client_id=c.id
      WHERE c.active=TRUE
      GROUP BY c.id
      ORDER BY c.name
    `);
    return r.rows;
  },

  // Spray Products
  async getSprayProducts() {
    const r = await pool.query('SELECT * FROM spray_products WHERE active=TRUE ORDER BY type,name');
    return r.rows;
  },
  async addSprayProduct(name, type, notes, reapplyMin, reapplyMax) {
    const r = await pool.query(
      'INSERT INTO spray_products(name,type,notes,reapply_min_days,reapply_max_days) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [name, type || null, notes || null, reapplyMin || null, reapplyMax || null]
    );
    return r.rows[0];
  },
  async updateSprayProduct(id, name, type, notes, reapplyMin, reapplyMax) {
    await pool.query(
      'UPDATE spray_products SET name=$1,type=$2,notes=$3,reapply_min_days=$4,reapply_max_days=$5 WHERE id=$6',
      [name, type || null, notes || null, reapplyMin || null, reapplyMax || null, id]
    );
  },
  async deleteSprayProduct(id) {
    await pool.query('UPDATE spray_products SET active=FALSE WHERE id=$1', [id]);
  },

  // Locations
  async getLocations() {
    const r = await pool.query('SELECT * FROM locations WHERE active=TRUE ORDER BY name');
    return r.rows;
  },
  async addLocation(name, address) {
    const r = await pool.query('INSERT INTO locations (name,address) VALUES ($1,$2) RETURNING *', [name, address || null]);
    return r.rows[0];
  },
  async deleteLocation(id) {
    await pool.query('UPDATE locations SET active=FALSE WHERE id=$1', [id]);
  },
  async getLocationById(id) {
    const r = await pool.query('SELECT * FROM locations WHERE id=$1', [id]);
    return r.rows[0] || null;
  },
  async setLocationGeofence(id, lat, lng, radius) {
    await pool.query(
      'UPDATE locations SET geofence_lat=$1, geofence_lng=$2, geofence_radius=$3 WHERE id=$4',
      [lat || null, lng || null, radius || 150, id]
    );
  },
  async setLocationPolygon(id, polygon) {
    await pool.query(
      'UPDATE locations SET polygon=$1 WHERE id=$2',
      [polygon ? JSON.stringify(polygon) : null, id]
    );
  },

  // Time Entries
  async clockIn(workerId, locationId, lat, lng, jobType) {
    const r = await pool.query(
      'INSERT INTO time_entries (worker_id,location_id,clock_in,clock_in_lat,clock_in_lng,job_type) VALUES ($1,$2,NOW(),$3,$4,$5) RETURNING id,clock_in',
      [workerId, locationId, lat || null, lng || null, jobType || null]
    );
    return r.rows[0];
  },
  async clockOut(entryId, lat, lng, notes, photo) {
    const r = await pool.query(`
      UPDATE time_entries SET
        clock_out=NOW(),
        clock_out_lat=$2,
        clock_out_lng=$3,
        duration_minutes=ROUND(EXTRACT(EPOCH FROM (NOW()-clock_in))/60),
        notes=$4,
        photo=$5
      WHERE id=$1
      RETURNING id,clock_out,duration_minutes,clock_in
    `, [entryId, lat || null, lng || null, notes || null, photo || null]);
    return r.rows[0];
  },
  async getCurrentEntry(workerId) {
    const r = await pool.query(`
      SELECT te.*,l.name as location_name
      FROM time_entries te
      JOIN locations l ON te.location_id=l.id
      WHERE te.worker_id=$1 AND te.clock_out IS NULL
    `, [workerId]);
    return r.rows[0] || null;
  },
  async getEntryPhoto(entryId) {
    const r = await pool.query('SELECT photo FROM time_entries WHERE id=$1', [entryId]);
    return r.rows[0]?.photo || null;
  },
  async getActiveEntries() {
    const r = await pool.query(`
      SELECT te.*,l.name as location_name,w.name as worker_name
      FROM time_entries te
      JOIN locations l ON te.location_id=l.id
      JOIN workers w ON te.worker_id=w.id
      WHERE te.clock_out IS NULL
      ORDER BY te.clock_in
    `);
    return r.rows;
  },
  async getWorkerEntries(workerId, startDate, endDate) {
    let q = `
      SELECT te.id,te.worker_id,te.location_id,te.clock_in,te.clock_out,
             te.duration_minutes,te.notes,(te.photo IS NOT NULL) as has_photo,
             te.job_type,l.name as location_name
      FROM time_entries te
      JOIN locations l ON te.location_id=l.id
      WHERE te.worker_id=$1
    `;
    const p = [workerId]; let i = 2;
    if (startDate) { q += ` AND te.clock_in::date>=$${i++}`; p.push(startDate); }
    if (endDate)   { q += ` AND te.clock_in::date<=$${i++}`; p.push(endDate); }
    q += ' ORDER BY te.clock_in DESC LIMIT 100';
    const r = await pool.query(q, p);
    return r.rows;
  },
  async getAllEntries({ workerId, locationId, startDate, endDate }) {
    let q = `
      SELECT te.*,l.name as location_name,w.name as worker_name
      FROM time_entries te
      JOIN locations l ON te.location_id=l.id
      JOIN workers w ON te.worker_id=w.id
      WHERE 1=1
    `;
    const p = []; let i = 1;
    if (workerId)   { q += ` AND te.worker_id=$${i++}`;       p.push(workerId); }
    if (locationId) { q += ` AND te.location_id=$${i++}`;     p.push(locationId); }
    if (startDate)  { q += ` AND te.clock_in::date>=$${i++}`; p.push(startDate); }
    if (endDate)    { q += ` AND te.clock_in::date<=$${i++}`; p.push(endDate); }
    q += ' ORDER BY te.clock_in DESC';
    const r = await pool.query(q, p);
    return r.rows;
  },
  async getStats() {
    const [w, a, t, wk] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM workers WHERE active=TRUE'),
      pool.query('SELECT COUNT(*) FROM time_entries WHERE clock_out IS NULL'),
      pool.query("SELECT COALESCE(SUM(duration_minutes),0) as total FROM time_entries WHERE clock_in::date=CURRENT_DATE AND duration_minutes IS NOT NULL"),
      pool.query("SELECT COALESCE(SUM(duration_minutes),0) as total FROM time_entries WHERE clock_in::date>=CURRENT_DATE-EXTRACT(DOW FROM CURRENT_DATE)::INTEGER AND duration_minutes IS NOT NULL"),
    ]);
    return {
      totalWorkers: parseInt(w.rows[0].count),
      clockedIn:    parseInt(a.rows[0].count),
      todayHours:   +(parseInt(t.rows[0].total)  / 60).toFixed(1),
      weekHours:    +(parseInt(wk.rows[0].total) / 60).toFixed(1),
    };
  },
  async getWeeklyHoursByWorker() {
    const r = await pool.query(`
      SELECT w.id, w.name as worker_name,
        COALESCE(SUM(
          CASE
            WHEN te.clock_out IS NOT NULL THEN te.duration_minutes
            ELSE ROUND(EXTRACT(EPOCH FROM (NOW()-te.clock_in))/60)
          END
        ), 0)::integer as week_minutes
      FROM workers w
      LEFT JOIN time_entries te ON te.worker_id=w.id
        AND te.clock_in::date >= CURRENT_DATE-EXTRACT(DOW FROM CURRENT_DATE)::INTEGER
      WHERE w.active=TRUE
      GROUP BY w.id, w.name
      ORDER BY week_minutes DESC
    `);
    return r.rows;
  },
  async getOvertimeChecks() {
    const r = await pool.query(`
      SELECT te.id as entry_id, te.clock_in, te.worker_id, l.name as location_name,
             ps.subscription
      FROM time_entries te
      JOIN locations l ON te.location_id=l.id
      JOIN push_subscriptions ps ON ps.worker_id=te.worker_id
      WHERE te.clock_out IS NULL
        AND te.notified_overtime=FALSE
        AND NOW()-te.clock_in > INTERVAL '8 hours'
    `);
    return r.rows;
  },
  async markOvertimeNotified(entryId) {
    await pool.query('UPDATE time_entries SET notified_overtime=TRUE WHERE id=$1', [entryId]);
  },

  // Spray Records (Job Entries)
  async addSprayRecord({ workerId, locationId, clientId, clientName, clientPhone, clientAddress, product, category, appliedAt, notes, nextServiceDate, timeEntryId }) {
    const r = await pool.query(`
      INSERT INTO spray_records
        (worker_id,location_id,client_id,client_name,client_phone,client_address,
         product,category,applied_at,notes,next_service_date,time_entry_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
      workerId, locationId || null, clientId || null, clientName || null,
      clientPhone || null, clientAddress || null, product, category || null,
      appliedAt || new Date().toISOString(), notes || null,
      nextServiceDate || null, timeEntryId || null
    ]);
    return r.rows[0];
  },
  async getWorkerSprayRecords(workerId, startDate, endDate) {
    let q = `
      SELECT sr.*,l.name as location_name,w.name as worker_name,
             te.duration_minutes, te.clock_in as entry_clock_in, te.clock_out as entry_clock_out
      FROM spray_records sr
      LEFT JOIN locations l ON sr.location_id=l.id
      JOIN workers w ON sr.worker_id=w.id
      LEFT JOIN time_entries te ON sr.time_entry_id=te.id
      WHERE sr.worker_id=$1
    `;
    const p = [workerId]; let i = 2;
    if (startDate) { q += ` AND sr.applied_at::date>=$${i++}`; p.push(startDate); }
    if (endDate)   { q += ` AND sr.applied_at::date<=$${i++}`; p.push(endDate); }
    q += ' ORDER BY sr.applied_at DESC LIMIT 60';
    const r = await pool.query(q, p);
    return r.rows;
  },
  async getAllSprayRecords({ workerId, locationId, clientId, startDate, endDate, upcoming } = {}) {
    let q = `
      SELECT sr.*,l.name as location_name,w.name as worker_name,
             te.duration_minutes, te.clock_in as entry_clock_in, te.clock_out as entry_clock_out
      FROM spray_records sr
      LEFT JOIN locations l ON sr.location_id=l.id
      JOIN workers w ON sr.worker_id=w.id
      LEFT JOIN time_entries te ON sr.time_entry_id=te.id
      WHERE 1=1
    `;
    const p = []; let i = 1;
    if (workerId)   { q += ` AND sr.worker_id=$${i++}`;         p.push(workerId); }
    if (locationId) { q += ` AND sr.location_id=$${i++}`;       p.push(locationId); }
    if (clientId)   { q += ` AND sr.client_id=$${i++}`;         p.push(clientId); }
    if (startDate)  { q += ` AND sr.applied_at::date>=$${i++}`; p.push(startDate); }
    if (endDate)    { q += ` AND sr.applied_at::date<=$${i++}`; p.push(endDate); }
    if (upcoming)   { q += ` AND sr.next_service_date IS NOT NULL AND sr.next_service_date <= CURRENT_DATE + 30`; }
    q += ' ORDER BY ' + (upcoming ? 'sr.next_service_date ASC' : 'sr.applied_at DESC');
    const r = await pool.query(q, p);
    return r.rows;
  },
  async getUpcomingJobs(workerId, days = 30) {
    const r = await pool.query(`
      SELECT sr.*,l.name as location_name,w.name as worker_name
      FROM spray_records sr
      LEFT JOIN locations l ON sr.location_id=l.id
      JOIN workers w ON sr.worker_id=w.id
      WHERE sr.worker_id=$1
        AND sr.next_service_date IS NOT NULL
        AND sr.next_service_date <= CURRENT_DATE + $2
      ORDER BY sr.next_service_date ASC
    `, [workerId, days]);
    return r.rows;
  },

  // Push subscriptions
  async savePushSubscription(workerId, endpoint, subscription) {
    await pool.query(
      'INSERT INTO push_subscriptions(worker_id,endpoint,subscription) VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET subscription=$3',
      [workerId, endpoint, JSON.stringify(subscription)]
    );
  },
  async removePushSubscription(endpoint) {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
  },
};
