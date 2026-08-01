// ─── SQLite storage layer (Node built-in, no native dependencies) ──────────
// Persists all bot records in data/bot-data.db using Node's built-in
// `node:sqlite` module (available in Node >= 22.5). This requires NO native
// compilation and NO install scripts, so it works on bot-hosting providers
// that block `node-gyp rebuild` and native modules like better-sqlite3.
//
// The in-memory data shape is identical to the old data/bot-data.json format,
// so command modules keep working via `data` + `saveData()` from utils.js.
//
// On first launch, if data/bot-data.json exists and the database is empty,
// the JSON data is automatically migrated into SQLite (the JSON file is kept
// as a backup).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'bot-data.db');
const JSON_PATH = path.join(DATA_DIR, 'bot-data.json');

const DEFAULT_STATE = {
  users: {},
  warnings: [],
  nextWarningId: 1,
  wallOfFame: [],
  items: {},
  subscriptions: {},
  sessions: {},
  coins: {},
  giveaways: [],
  customCommands: {},
  claims: {},
};

// ─── Open database (WAL mode for atomic, crash-safe writes) ────────────────
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  points INTEGER NOT NULL DEFAULT 0,
  rank TEXT,
  in_game_user TEXT,
  trusted_locations TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS wall_of_fame (
  position INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS items (
  name TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  price INTEGER NOT NULL,
  min_amount INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL DEFAULT 0,
  history TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT PRIMARY KEY,
  gear TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 0,
  start_time INTEGER,
  end_time INTEGER,
  hours INTEGER NOT NULL DEFAULT 0,
  history TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS coins (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS giveaways (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  prize TEXT NOT NULL,
  winners INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  ended INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS custom_commands (
  name TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
  user_id TEXT PRIMARY KEY,
  daily INTEGER NOT NULL DEFAULT 0,
  weekly INTEGER NOT NULL DEFAULT 0,
  monthly INTEGER NOT NULL DEFAULT 0
);
`);

// ─── Save entire state to SQLite inside one atomic transaction ─────────────
function saveData(state) {
  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM warnings').run();
    db.prepare('DELETE FROM wall_of_fame').run();
    db.prepare('DELETE FROM items').run();
    db.prepare('DELETE FROM subscriptions').run();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM coins').run();
    db.prepare('DELETE FROM giveaways').run();
    db.prepare('DELETE FROM custom_commands').run();
    db.prepare('DELETE FROM claims').run();
    db.prepare("DELETE FROM meta WHERE key = 'nextWarningId'").run();

    const insertUser = db.prepare('INSERT INTO users (user_id, points, rank, in_game_user, trusted_locations) VALUES (?, ?, ?, ?, ?)');
    for (const [id, u] of Object.entries(state.users || {})) {
      insertUser.run(id, u.points ?? 0, u.rank ?? null, u.inGameUser ?? null, JSON.stringify(u.trustedLocations || []));
    }

    const insertWarning = db.prepare('INSERT INTO warnings (id, user_id, reason, staff_id, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const w of state.warnings || []) {
      insertWarning.run(w.id, w.userId, w.reason, w.staffId, w.createdAt);
    }

    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('nextWarningId', String(state.nextWarningId ?? 1));

    const insertWof = db.prepare('INSERT INTO wall_of_fame (user_id) VALUES (?)');
    for (const id of state.wallOfFame || []) {
      insertWof.run(id);
    }

    const insertItem = db.prepare('INSERT INTO items (name, type, price, min_amount, stock, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (const it of Object.values(state.items || {})) {
      insertItem.run(it.name, it.type, it.price, it.minAmount, it.stock, it.createdAt);
    }

    const insertSub = db.prepare('INSERT INTO subscriptions (user_id, tokens, history) VALUES (?, ?, ?)');
    for (const [id, sub] of Object.entries(state.subscriptions || {})) {
      insertSub.run(id, sub.tokens ?? 0, JSON.stringify(sub.history || []));
    }

    const insertSession = db.prepare('INSERT INTO sessions (user_id, gear, active, start_time, end_time, hours, history) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [id, s] of Object.entries(state.sessions || {})) {
      insertSession.run(id, JSON.stringify(s.gear || []), s.active ? 1 : 0, s.startTime ?? null, s.endTime ?? null, s.hours ?? 0, JSON.stringify(s.history || []));
    }

    const insertCoin = db.prepare('INSERT INTO coins (user_id, balance) VALUES (?, ?)');
    for (const [id, bal] of Object.entries(state.coins || {})) {
      insertCoin.run(id, bal ?? 0);
    }

    const insertGw = db.prepare('INSERT INTO giveaways (message_id, channel_id, guild_id, host_id, prize, winners, end_time, ended) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const g of state.giveaways || []) {
      insertGw.run(g.messageId, g.channelId, g.guildId, g.hostId, g.prize, g.winners, g.endTime, g.ended ? 1 : 0);
    }

    const insertCmd = db.prepare('INSERT INTO custom_commands (name, content, staff_id, created_at) VALUES (?, ?, ?, ?)');
    for (const [name, c] of Object.entries(state.customCommands || {})) {
      insertCmd.run(name, c.content, c.staffId, c.createdAt);
    }

    const insertClaim = db.prepare('INSERT INTO claims (user_id, daily, weekly, monthly) VALUES (?, ?, ?, ?)');
    for (const [id, cl] of Object.entries(state.claims || {})) {
      insertClaim.run(id, cl.daily ?? 0, cl.weekly ?? 0, cl.monthly ?? 0);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ─── Load entire state from SQLite back into the legacy object shape ───────
function loadData() {
  const state = structuredClone(DEFAULT_STATE);

  for (const row of db.prepare('SELECT * FROM users').all()) {
    state.users[row.user_id] = {
      points: row.points,
      rank: row.rank,
      inGameUser: row.in_game_user,
      trustedLocations: JSON.parse(row.trusted_locations),
    };
  }

  const warnings = db.prepare('SELECT id, user_id, reason, staff_id, created_at FROM warnings ORDER BY id ASC').all();
  state.warnings = warnings.map((w) => ({ id: w.id, userId: w.user_id, reason: w.reason, staffId: w.staff_id, createdAt: w.created_at }));

  const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'nextWarningId'").get();
  state.nextWarningId = metaRow ? Number(metaRow.value) : 1;

  const wof = db.prepare('SELECT user_id FROM wall_of_fame ORDER BY position ASC').all();
  state.wallOfFame = wof.map((r) => r.user_id);

  for (const row of db.prepare('SELECT * FROM items').all()) {
    state.items[row.name] = { name: row.name, type: row.type, price: row.price, minAmount: row.min_amount, stock: row.stock, createdAt: row.created_at };
  }

  for (const row of db.prepare('SELECT * FROM subscriptions').all()) {
    state.subscriptions[row.user_id] = { tokens: row.tokens, history: JSON.parse(row.history) };
  }

  for (const row of db.prepare('SELECT * FROM sessions').all()) {
    state.sessions[row.user_id] = {
      gear: JSON.parse(row.gear),
      active: Boolean(row.active),
      startTime: row.start_time,
      endTime: row.end_time,
      hours: row.hours,
      history: JSON.parse(row.history),
    };
  }

  for (const row of db.prepare('SELECT * FROM coins').all()) {
    state.coins[row.user_id] = row.balance;
  }

  const gws = db.prepare('SELECT * FROM giveaways').all();
  state.giveaways = gws.map((g) => ({
    messageId: g.message_id,
    channelId: g.channel_id,
    guildId: g.guild_id,
    hostId: g.host_id,
    prize: g.prize,
    winners: g.winners,
    endTime: g.end_time,
    ended: Boolean(g.ended),
  }));

  for (const row of db.prepare('SELECT * FROM custom_commands').all()) {
    state.customCommands[row.name] = { content: row.content, staffId: row.staff_id, createdAt: row.created_at };
  }

  for (const row of db.prepare('SELECT * FROM claims').all()) {
    state.claims[row.user_id] = { daily: row.daily, weekly: row.weekly, monthly: row.monthly };
  }

  return state;
}

// ─── One-time migration from the legacy JSON file (kept as backup) ─────────
function migrateIfNeeded() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'initialized'").get();
  if (row) return false;

  let migrated = false;
  if (fs.existsSync(JSON_PATH)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      const state = { ...structuredClone(DEFAULT_STATE), ...legacy };
      saveData(state);
      migrated = true;
      console.log('[database] Migrated data/bot-data.json into SQLite database (data/bot-data.db).');
    } catch (error) {
      console.error('[database] Could not migrate data/bot-data.json:', error.message);
    }
  }

  db.prepare("INSERT INTO meta (key, value) VALUES ('initialized', '1')").run();
  return migrated;
}

// ─── Debugging helpers ──────────────────────────────────────────────────────
function getStats() {
  const tables = ['users', 'warnings', 'wall_of_fame', 'items', 'subscriptions', 'sessions', 'coins', 'giveaways', 'custom_commands', 'claims'];
  const counts = {};
  for (const t of tables) counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
  return counts;
}

function close() {
  db.close();
}

// Run the one-time JSON → SQLite migration on startup.
migrateIfNeeded();

module.exports = { DB_PATH, loadData, saveData, migrateIfNeeded, getStats, close };

