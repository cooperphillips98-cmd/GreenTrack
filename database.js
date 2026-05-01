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
    INSERT INTO settings (key,value) VALUES ('admin_password','admin1234') ON CONFLICT DO NOTHING;
  `);
}

module.exports = {
  init,
  async getWorkerByCredentials(name, pin) {
    const r = await pool.query('SELECT * FROM workers WHERE name=$1 AND pin=$2 AND active=TRUE', [name, pin]);
    return r.rows[0] || null;
  },
  async checkAdminPassword(password) {
    const r = await pool.query("SELECT value FROM settings WHERE key='admin_password'");
    return r.rows[0]?.value === password;
  },
  async updateAdminPassword(password) {
    await pool.query("UPDATE settings SET value=$1 WHERE key='admin_password'", [password]);
  },
  async getWorkers() {
    const r = await pool.query('SELECT id,name,active,created_at FROM workers WHERE active=TRUE ORDER BY name');
    return r.rows;
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
  async clockIn(workerId, locationId, lat, lng) {
    const r = await pool.query(
      'INSERT INTO time_entries (worker_id,location_id,clock_in,clock_in_lat,clock_in_lng) VALUES ($1,$2,NOW(),$3,$4) RETURNING id,clock_in',
      [workerId, locationId, lat || null, lng || null]
    );
    return r.rows[0];
  },
  async clockOut(entryId, lat, lng, notes) {
    const r = await pool.query(`
      UPDATE time_entries SET
        clock_out=NOW(),
        clock_out_lat=$2,
        clock_out_lng=$3,
        duration_minutes=ROUND(EXTRACT(EPOCH FROM (NOW()-clock_in))/60),
        notes=$4
      WHERE id=$1
      RETURNING id,clock_out,duration_minutes
    `, [entryId, lat || null, lng || null, notes || null]);
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
      SELECT te.*,l.name as location_name
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
      pool.query("SELECT COALESCE(SUM(duration_minutes),0) as total FROM time_entries WHERE clock_in::date>=CURRENT_DATE-6 AND duration_minutes IS NOT NULL"),
    ]);
    return {
      totalWorkers: parseInt(w.rows[0].count),
      clockedIn:    parseInt(a.rows[0].count),
      todayHours:   +(parseInt(t.rows[0].total)  / 60).toFixed(1),
      weekHours:    +(parseInt(wk.rows[0].total) / 60).toFixed(1),
    };
  },
};
