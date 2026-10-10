const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const databasePath = path.resolve(process.env.DATABASE_URL || './data/mihulish.db');
const defaultPanels = ['java', 'br', 'bug', 'report', 'partnership'];

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
    mute_role_id TEXT,
    support_category_id TEXT,
    manager_role_id TEXT,
    log_channel_id TEXT,
    loa_rules TEXT NOT NULL DEFAULT '[]',
    sloa_rules TEXT NOT NULL DEFAULT '[]',
    appeal_link TEXT,
    mod_role_id TEXT,
    headmod_role_id TEXT,
    admin_role_id TEXT,
    theysix_role_id TEXT
  );

  CREATE TABLE IF NOT EXISTS staff (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT,
    added_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS warnings_user
    ON warnings (guild_id, user_id, created_at);

  CREATE TABLE IF NOT EXISTS loa (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    active INTEGER NOT NULL,
    reason TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ends_at INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS sloa (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    active INTEGER NOT NULL,
    reason TEXT NOT NULL,
    availability TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ends_at INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (guild_id, name)
  );

  CREATE TABLE IF NOT EXISTS staff_tags (
    guild_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    assigned_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, tag_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS ticket_panels (
    guild_id TEXT NOT NULL,
    panel TEXT NOT NULL,
    tag_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (guild_id, panel)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    panel TEXT NOT NULL,
    ticket_user_id TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    assigned_staff_id TEXT,
    UNIQUE (guild_id, channel_id)
  );

  CREATE TABLE IF NOT EXISTS moderation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_id TEXT,
    moderator_id TEXT,
    reason TEXT,
    created_at INTEGER NOT NULL
  );
`);

function ensureGuild(guildId) {
  db.prepare('INSERT OR IGNORE INTO guilds VALUES (?, ?)').run(guildId, Date.now());
  db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)').run(guildId);

  for (const panel of defaultPanels) {
    db.prepare(
      'INSERT OR IGNORE INTO ticket_panels (guild_id, panel, tag_name) VALUES (?, ?, ?)',
    ).run(guildId, panel, panel);
  }
}

function getSettings(guildId) {
  ensureGuild(guildId);
  return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
}

function updateSettings(guildId, values) {
  ensureGuild(guildId);
  const allowedKeys = ['mute_role_id', 'support_category_id', 'manager_role_id', 'log_channel_id', 'appeal_link', 'dn_link_style', 'mod_role_id', 'headmod_role_id', 'admin_role_id', 'themsix_role_id'];

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      db.prepare(`UPDATE guild_settings SET ${key} = ? WHERE guild_id = ?`).run(
        values[key] || null,
        guildId,
      );
    }
  }

  return getSettings(guildId);
}

function addWarning(guildId, userId, moderatorId, reason) {
  ensureGuild(guildId);
  const result = db.prepare(`
    INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
    VALUES (?, ?, ?)
  `).run(guildId, userId, moderatorId, reason, Date.now());
  return db.prepare('SELECT * FROM warnings WHERE id = ?').get(Number(result.lastInsertRowid));
}

function listWarnings(guildId, userId = null, moderatorId = null) {
  let query = 'SELECT * FROM warnings WHERE guild_id = ?';
  const parameters = [guildId];

  if (userId) {
    query += ' AND user_id = ?';
    parameters.push(userId);
  }
  if (moderatorId) {
    query += ' AND moderator_id = ?';
    parameters.push(moderatorId);
  }

  return db.prepare(`${query} ORDER BY created_at DESC`).all(...parameters);
}

function setLeaveStatus(table, guildId, userId, active, reason, availability, endsAt) {
  ensureGuild(guildId);
  const isSloa = table === 'sloa';
  const columns = isSloa
    ? 'guild_id, user_id, active, reason, availability, started_at, ends_at'
    : 'guild_id, user_id, active, reason, started_at, ends_at';
  const values = isSloa
    ? [guildId, userId, active ? 1 : 0, reason, availability, Date.now(), endsAt || null]
    : [guildId, userId, active ? 1 : 0, reason, Date.now(), endsAt || null];
  const placeholders = values.map(() => '?').join(', ');
  const update = isSloa
    ? 'active = excluded.active, reason = excluded.reason, availability = excluded.availability, started_at = excluded.started_at, ends_at = excluded.ends_at'
    : 'active = excluded.active, reason = excluded.reason, started_at = excluded.started_at, ends_at = excluded.ends_at';

  db.prepare(`
    INSERT INTO ${table} (${columns}) VALUES (${placeholders})
    ON CONFLICT (guild_id, user_id) DO UPDATE SET ${update}
  `).run(...values);

  return getLeaveStatus(table, guildId, userId);
}

function getLeaveStatus(table, guildId, userId) {
  return db.prepare(`SELECT * FROM ${table} WHERE guild_id = ? AND user_id = ?`).get(guildId, userId);
}

function listLeaveStatuses(table, guildId) {
  return db.prepare(`SELECT * FROM ${table} WHERE guild_id = ? AND active = 1 ORDER BY started_at`).all(guildId);
}

function isStaff(guildId, userId) {
  return Boolean(db.prepare('SELECT 1 FROM staff WHERE guild_id = ? AND user_id = ?').get(guildId, userId));
}

function saveStaff(guildId, userId, roleId, addedBy) {
  ensureGuild(guildId);
  db.prepare(`
    INSERT INTO staff (guild_id, user_id, role_id, added_by, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET role_id = excluded.role_id
  `).run(guildId, userId, roleId, addedBy, Date.now());
}

function removeStaff(guildId, userId) {
  return db.prepare('DELETE FROM staff WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes > 0;
}

function getTag(guildId, name, displayName = name) {
  ensureGuild(guildId);
  db.prepare('INSERT OR IGNORE INTO tags (guild_id, name, display_name, created_at) VALUES (?, ?, ?)').run(guildId, name, displayName, Date.now());
  return db.prepare('SELECT * FROM tags WHERE guild_id = ? AND name = ?').get(guildId, name);
}

function getTagMembers(guildId, name) {
  return db.prepare(`
    SELECT staff_tags.user_id
    FROM staff_tags JOIN tags ON tags.id = staff_tags.tag_id
    WHERE staff_tags.guild_id = ? AND tags.name = ?
  `).all(guildId, name).map(row => row.user_id);
}

function getTicket(guildId, channelId) {
  ensureGuild(guildId);
  return db.prepare('SELECT * FROM tickets WHERE guild_id = ? AND channel_id = ?').get(guildId, channelId);
}

function saveTicket(guildId, channelId, panel, ticketUserId, status) {
  ensureGuild(guildId);
  db.prepare(`
    INSERT INTO tickets (guild_id, channel_id, panel, ticket_user_id, status, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT (guild_id, channel_id) DO UPDATE SET
      panel = excluded.panel,
      ticket_user_id = COALESCE(excluded.ticket_user_id, tickets.ticket_user_id),
      status = excluded.status,
      closed_at = CASE
        WHEN excluded.status = 'CLOSED' THEN COALESCE(tickets.closed_at, excluded.closed_at)
        ELSE NULL
      END
  `).run(guildId, channelId, panel, ticketUserId || null, status, Date.now());
  return getTicket(guildId, channelId);
}

function assignTicket(guildId, channelId, staffUserId) {
  db.prepare('UPDATE tickets SET assigned_staff_id = ? WHERE guild_id = ? AND channel_id = ?').run(staffUserId, guildId, channelId);
  return getTicket(guildId, channelId);
}

function deleteTicket(guildId, channelId) {
  db.prepare('DELETE FROM tickets WHERE guild_id = ? AND channel_id = ?').run(guildId, channelId);
}

function getStaff(guildId) {
  return db.prepare('SELECT * FROM staff WHERE guild_id = ?').all(guildId);
}

function addStaffTag(guildId, name, userId, assignedBy) {
  const tag = getTag(guildId, name);
  db.prepare(`
    INSERT OR IGNORE INTO staff_tags (guild_id, tag_id, user_id, assigned_by, created_at)
    VALUES (?, ?, ?)
  `).run(guildId, tag.id, userId, assignedBy, Date.now());
}

function removeStaffTag(guildId, name, userId) {
  db.prepare(`
    DELETE FROM staff_tags
    WHERE guild_id = ?
      AND tag_id = (SELECT id FROM tags WHERE guild_id = ? AND name = ?)
      AND user_id = ?
  `).run(guildId, guildId, name, userId);
}

function getUserTags(guildId, userId) {
  return db.prepare(`
    SELECT tags.* FROM staff_tags
    JOIN tags ON tags.id = staff_tags.tag_id
    WHERE staff_tags.guild_id = ? AND staff_tags.user_id = ?
    ORDER BY tags.name
  `).all(guildId, userId);
}

module.exports = {
  db,
  ensureGuild,
  getSettings,
  updateSettings,
  addWarning,
  listWarnings,
  setLeaveStatus,
  getLeaveStatus,
  listLeaveStatuses,
  isStaff,
  saveStaff,
  removeStaff,
  getStaff,
  getTag,
  getTagMembers,
  addStaffTag,
  removeStaffTag,
  getUserTags,
  getTicket,
  saveTicket,
  assignTicket,
  deleteTicket,
};
