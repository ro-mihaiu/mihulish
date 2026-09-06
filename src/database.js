const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATABASE_PATH = path.resolve(
  process.env.DATABASE_URL || "./data/mihulish.db",
);

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
`);
db.exec(`
CREATE TABLE IF NOT EXISTS guilds (guild_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS guild_settings (guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE, mute_role_id TEXT, support_category_id TEXT, manager_role_id TEXT, log_channel_id TEXT, prefix TEXT NOT NULL DEFAULT 'm.', loa_rules TEXT NOT NULL DEFAULT '[]', sloa_rules TEXT NOT NULL DEFAULT '[]', appeal_link TEXT);
`);

try {
  db.exec(
    "ALTER TABLE guild_settings ADD COLUMN prefix TEXT NOT NULL DEFAULT 'm.'",
  );
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN staff_updated_at INTEGER");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN appeal_link TEXT");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
try {
  db.exec("ALTER TABLE tickets ADD COLUMN last_message_at INTEGER");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
try {
  db.exec("ALTER TABLE sticky_messages ADD COLUMN format TEXT NOT NULL DEFAULT 'plain'");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
try {
  db.exec("ALTER TABLE sticky_messages ADD COLUMN embed_json TEXT");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}

db.exec(`

CREATE TABLE IF NOT EXISTS staff (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT, added_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id,user_id), FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS warnings (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, moderator_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (guild_id) REFERENCES guilds(guild_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS warnings_user ON warnings(guild_id,user_id,created_at);
CREATE TABLE IF NOT EXISTS loa (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, active INTEGER NOT NULL, reason TEXT NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER, PRIMARY KEY (guild_id,user_id));
CREATE TABLE IF NOT EXISTS sloa (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, active INTEGER NOT NULL, reason TEXT NOT NULL, availability TEXT NOT NULL, started_at INTEGER NOT NULL, ends_at INTEGER, PRIMARY KEY (guild_id,user_id));
CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, name TEXT NOT NULL, display_name TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(guild_id,name));
CREATE TABLE IF NOT EXISTS staff_tags (guild_id TEXT NOT NULL, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, user_id TEXT NOT NULL, assigned_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(guild_id,tag_id,user_id));
CREATE TABLE IF NOT EXISTS ticket_panels (guild_id TEXT NOT NULL, panel TEXT NOT NULL, tag_name TEXT, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(guild_id,panel));
CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, panel TEXT NOT NULL, ticket_user_id TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, closed_at INTEGER, assigned_staff_id TEXT, last_message_at INTEGER, UNIQUE(guild_id,channel_id));
CREATE TABLE IF NOT EXISTS sticky_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT, content TEXT NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(guild_id,channel_id));
CREATE TABLE IF NOT EXISTS moderation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, moderator_id TEXT, reason TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS original_nicknames (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, nickname TEXT, PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS votes (guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE, streak INTEGER NOT NULL DEFAULT 0, last_vote_at INTEGER, last_voter_id TEXT);
CREATE TABLE IF NOT EXISTS user_votes (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, last_vote_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
`);

const DEFAULT_TICKET_PANELS = ["java", "br", "bug", "report", "partnership"];

function ensureGuild(guildId) {
  db.prepare("INSERT OR IGNORE INTO guilds VALUES (?, ?)").run(
    guildId,
    Date.now(),
  );
  db.prepare("INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)").run(
    guildId,
  );

  for (const panel of DEFAULT_TICKET_PANELS) {
    db.prepare(
      "INSERT OR IGNORE INTO ticket_panels (guild_id, panel, tag_name) VALUES (?, ?, ?)",
    ).run(guildId, panel, panel);
  }
}
function settings(guildId) {
  ensureGuild(guildId);
  return db
    .prepare("SELECT * FROM guild_settings WHERE guild_id=?")
    .get(guildId);
}
function updateSettings(guildId, values) {
  ensureGuild(guildId);

  const allowedKeys = [
    "mute_role_id",
    "support_category_id",
    "manager_role_id",
    "log_channel_id",
    "prefix",
    "appeal_link",
  ];

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      db.prepare(`UPDATE guild_settings SET ${key} = ? WHERE guild_id = ?`).run(
        values[key] || null,
        guildId,
      );
    }
  }

  return settings(guildId);
}
function getPrefix(guildId) {
  return settings(guildId).prefix || "m.";
}

function addWarning(g, u, m, r) {
  ensureGuild(g);
  const x = db
    .prepare(
      "INSERT INTO warnings(guild_id,user_id,moderator_id,reason,created_at) VALUES(?,?,?,?,?)",
    )
    .run(g, u, m, r, Date.now());
  return db
    .prepare("SELECT * FROM warnings WHERE id=?")
    .get(Number(x.lastInsertRowid));
}
function getWarning(g, id) {
  ensureGuild(g);
  return db
    .prepare("SELECT * FROM warnings WHERE guild_id=? AND id=?")
    .get(g, id);
}
function deleteWarning(g, id) {
  ensureGuild(g);
  return (
    db.prepare("DELETE FROM warnings WHERE guild_id=? AND id=?").run(g, id)
      .changes > 0
  );
}
function warnings(g, u = null, m = null) {
  let q = "SELECT * FROM warnings WHERE guild_id=?",
    a = [g];
  if (u) {
    q += " AND user_id=?";
    a.push(u);
  }
  if (m) {
    q += " AND moderator_id=?";
    a.push(m);
  }
  return db.prepare(q + " ORDER BY created_at DESC").all(...a);
}
function touchStaffDirectory(g) {
  ensureGuild(g);
  db.prepare("UPDATE guild_settings SET staff_updated_at=? WHERE guild_id=?").run(Date.now(), g);
}
function getStaffDirectoryUpdatedAt(g) {
  return settings(g).staff_updated_at || null;
}
function setLeave(table, g, u, active, reason, availability, endsAt) {
  ensureGuild(g);
  const cols =
    table === "loa"
      ? "reason,started_at,ends_at"
      : "reason,availability,started_at,ends_at";
  const vals =
    table === "loa"
      ? [g, u, active ? 1 : 0, reason, Date.now(), endsAt || null]
      : [
          g,
          u,
          active ? 1 : 0,
          reason,
          availability,
          Date.now(),
          endsAt || null,
        ];
  const placeholders = table === "loa" ? "?,?,?,?,?,?" : "?,?,?,?,?,?,?";
  db.prepare(
    `INSERT INTO ${table}(guild_id,user_id,active,${cols}) VALUES(${placeholders}) ON CONFLICT(guild_id,user_id) DO UPDATE SET active=excluded.active,reason=excluded.reason,${table === "loa" ? "started_at=excluded.started_at,ends_at=excluded.ends_at" : "availability=excluded.availability,started_at=excluded.started_at,ends_at=excluded.ends_at"}`,
  ).run(...vals);
  touchStaffDirectory(g);
  return db
    .prepare(`SELECT * FROM ${table} WHERE guild_id=? AND user_id=?`)
    .get(g, u);
}
function getLeave(table, g, u) {
  return db
    .prepare(`SELECT * FROM ${table} WHERE guild_id=? AND user_id=?`)
    .get(g, u);
}
function listLeave(table, g) {
  return db
    .prepare(
      `SELECT * FROM ${table} WHERE guild_id=? AND active=1 ORDER BY started_at`,
    )
    .all(g);
}
function isStaff(g, u) {
  return !!db
    .prepare("SELECT 1 FROM staff WHERE guild_id=? AND user_id=?")
    .get(g, u);
}
function upsertStaff(g, u, r, a) {
  ensureGuild(g);
  db.prepare(
    "INSERT INTO staff VALUES(?,?,?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET role_id=excluded.role_id",
  ).run(g, u, r, a, Date.now());
  touchStaffDirectory(g);
}
function removeStaff(g, u) {
  const removed = (

    db.prepare("DELETE FROM staff WHERE guild_id=? AND user_id=?").run(g, u)
      .changes > 0
  );
  if (removed) touchStaffDirectory(g);
  return removed;
}
function listStaff(g) {
  return db.prepare("SELECT * FROM staff WHERE guild_id=?").all(g);
}
function listStaffStatuses(g) {
  return db
    .prepare(
      "SELECT st.*, l.active AS loa_active, l.reason AS loa_reason, l.started_at AS loa_started_at, l.ends_at AS loa_ends_at, s.active AS sloa_active, s.reason AS sloa_reason, s.availability AS sloa_availability, s.started_at AS sloa_started_at, s.ends_at AS sloa_ends_at FROM staff st LEFT JOIN loa l ON l.guild_id=st.guild_id AND l.user_id=st.user_id LEFT JOIN sloa s ON s.guild_id=st.guild_id AND s.user_id=st.user_id WHERE st.guild_id=? ORDER BY st.created_at",
    )
    .all(g);
}
function tag(g, name, display = name) {
  ensureGuild(g);
  db.prepare(
    "INSERT OR IGNORE INTO tags(guild_id,name,display_name,created_at) VALUES(?,?,?,?)",
  ).run(g, name, display, Date.now());
  touchStaffDirectory(g);
  return db
    .prepare("SELECT * FROM tags WHERE guild_id=? AND name=?")
    .get(g, name);
}
function listTags(g) {
  ensureGuild(g);
  return db.prepare("SELECT * FROM tags WHERE guild_id=? ORDER BY display_name COLLATE NOCASE").all(g);
}
function deleteTag(g, name) {
  const deleted = db.prepare("DELETE FROM tags WHERE guild_id=? AND name=?").run(g, name).changes > 0;
  if (deleted) touchStaffDirectory(g);
  return deleted;
}
function tagMembers(g, name) {
  return db
    .prepare(
      "SELECT st.user_id FROM staff_tags st JOIN tags t ON t.id=st.tag_id WHERE st.guild_id=? AND t.name=?",
    )
    .all(g, name)
    .map((x) => x.user_id);
}
function ticket(g, c) {
  ensureGuild(g);
  return db
    .prepare("SELECT * FROM tickets WHERE guild_id=? AND channel_id=?")
    .get(g, c);
}
function saveTicket(g, c, p, user, status) {
  ensureGuild(g);
  db.prepare(
    "INSERT INTO tickets(guild_id,channel_id,panel,ticket_user_id,status,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(guild_id,channel_id) DO UPDATE SET panel=excluded.panel,ticket_user_id=COALESCE(excluded.ticket_user_id,tickets.ticket_user_id),status=excluded.status,closed_at=CASE WHEN excluded.status='CLOSED' THEN COALESCE(tickets.closed_at,excluded.closed_at) ELSE NULL END",
  ).run(g, c, p, user || null, status, Date.now());
  return ticket(g, c);
}
function assignTicket(g, c, u) {
  db.prepare(
    "UPDATE tickets SET assigned_staff_id=? WHERE guild_id=? AND channel_id=?",
  ).run(u, g, c);
  return ticket(g, c);
}
function updateTicketLastMessage(g, c) {
  db.prepare("UPDATE tickets SET last_message_at=? WHERE guild_id=? AND channel_id=?").run(Date.now(), g, c);
}
function deleteTicket(g, c) {
  db.prepare("DELETE FROM tickets WHERE guild_id=? AND channel_id=?").run(g, c);
}
function addStaffTag(g, name, u, by) {
  const t = tag(g, name);
  db.prepare(
    "INSERT OR IGNORE INTO staff_tags(guild_id,tag_id,user_id,assigned_by,created_at) VALUES(?,?,?,?,?)",
  ).run(g, t.id, u, by, Date.now());
  touchStaffDirectory(g);
}
function removeStaffTag(g, name, u) {
  db.prepare(
    "DELETE FROM staff_tags WHERE guild_id=? AND tag_id=(SELECT id FROM tags WHERE guild_id=? AND name=?) AND user_id=?",
  ).run(g, g, name, u);
  touchStaffDirectory(g);
}
function saveOriginalNickname(g, u, nickname) {
  db.prepare(
    "INSERT OR REPLACE INTO original_nicknames(guild_id,user_id,nickname) VALUES(?,?,?)",
  ).run(g, u, nickname);
}
function getOriginalNickname(g, u) {
  const row = db
    .prepare("SELECT nickname FROM original_nicknames WHERE guild_id=? AND user_id=?")
    .get(g, u);
  return row?.nickname || null;
}
function deleteOriginalNickname(g, u) {
  db.prepare("DELETE FROM original_nicknames WHERE guild_id=? AND user_id=?").run(g, u);
}
function userTags(g, u) {
  return db
    .prepare(
      "SELECT t.* FROM staff_tags s JOIN tags t ON t.id=s.tag_id WHERE s.guild_id=? AND s.user_id=? ORDER BY t.name",
    )
    .all(g, u);
}
function addModerationLog(guildId, action, targetId, moderatorId, reason) {
  ensureGuild(guildId);
  return db
    .prepare(
      "INSERT INTO moderation_logs(guild_id,action,target_id,moderator_id,reason,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(guildId, action, targetId || null, moderatorId, reason || null, Date.now());
}
function getModerationLogs(guildId, targetId = null) {
  let q = "SELECT * FROM moderation_logs WHERE guild_id=?",
    a = [guildId];
  if (targetId) {
    q += " AND target_id=?";
    a.push(targetId);
  }
  return db.prepare(q + " ORDER BY created_at DESC").all(...a);
}
function vote(guildId, userId) {
  ensureGuild(guildId);
  const row = db
    .prepare("SELECT * FROM votes WHERE guild_id=?")
    .get(guildId);
  const now = Date.now();
  const STREAK_RESET_MS = 48 * 60 * 60 * 1000;
  const USER_COOLDOWN_MS = 12 * 60 * 60 * 1000;
  const userRow = db
    .prepare("SELECT * FROM user_votes WHERE guild_id=? AND user_id=?")
    .get(guildId, userId);
  if (userRow && now - userRow.last_vote_at < USER_COOLDOWN_MS) {
    const remaining = Math.ceil((USER_COOLDOWN_MS - (now - userRow.last_vote_at)) / 60000);
    return { ok: false, remainingMinutes: remaining, streak: row?.streak || 0, lastVoterId: row?.last_voter_id || null };
  }
  let streak = 0;
  if (row && row.last_vote_at && now - row.last_vote_at < STREAK_RESET_MS) {
    streak = row.streak + 1;
  } else {
    streak = 1;
  }
  db.prepare(
    "INSERT INTO votes(guild_id,streak,last_vote_at,last_voter_id) VALUES(?,?,?,?) ON CONFLICT(guild_id) DO UPDATE SET streak=excluded.streak,last_vote_at=excluded.last_vote_at,last_voter_id=excluded.last_voter_id",
  ).run(guildId, streak, now, userId);
  db.prepare(
    "INSERT INTO user_votes(guild_id,user_id,last_vote_at) VALUES(?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET last_vote_at=excluded.last_vote_at",
  ).run(guildId, userId, now);
  const updated = db
    .prepare("SELECT * FROM votes WHERE guild_id=?")
    .get(guildId);
  const prevVoter = row?.last_voter_id || null;
  const isNewStreak = streak === 1 && (!row || !row.last_vote_at || now - row.last_vote_at >= STREAK_RESET_MS);
  return { ok: true, streak: updated.streak, lastVoterId: updated.last_voter_id, prevVoterId: prevVoter, isNewStreak };
}
function getVotes(guildId) {
  const row = db
    .prepare("SELECT * FROM votes WHERE guild_id=?")
    .get(guildId);
  if (!row) return { streak: 0, lastVoterId: null, lastVoteAt: null };
  return { streak: row.streak, lastVoterId: row.last_voter_id, lastVoteAt: row.last_vote_at };
}
function getSticky(guildId, channelId) {
  return db
    .prepare("SELECT * FROM sticky_messages WHERE guild_id=? AND channel_id=?")
    .get(guildId, channelId);
}
function setSticky(guildId, channelId, content, format = "plain", embedJson = null) {
  ensureGuild(guildId);
  db.prepare(
    "INSERT INTO sticky_messages (guild_id, channel_id, content, format, embed_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(guild_id, channel_id) DO UPDATE SET content=excluded.content, format=excluded.format, embed_json=excluded.embed_json, message_id=NULL, updated_at=excluded.updated_at",
  ).run(guildId, channelId, content, format, embedJson, Date.now());
  return getSticky(guildId, channelId);
}
function setStickyMessageId(guildId, channelId, messageId) {
  db.prepare(
    "UPDATE sticky_messages SET message_id=? WHERE guild_id=? AND channel_id=?",
  ).run(messageId, guildId, channelId);
}
function deleteSticky(guildId, channelId) {
  const info = db
    .prepare("DELETE FROM sticky_messages WHERE guild_id=? AND channel_id=?")
    .run(guildId, channelId);
  return info.changes > 0;
}
module.exports = {
  db,
  ensureGuild,
  settings,
  getPrefix,
  updateSettings,
  addWarning,
  getWarning,
  deleteWarning,
  warnings,
  setLeave,
  getLeave,
  listLeave,
  isStaff,
  upsertStaff,
  removeStaff,
  listStaff,
  listStaffStatuses,
  getStaffDirectoryUpdatedAt,
  tag,
  listTags,
  deleteTag,
  tagMembers,
  ticket,
  saveTicket,
  assignTicket,
  deleteTicket,
  addStaffTag,
  removeStaffTag,
  userTags,
  getSticky,
  setSticky,
  setStickyMessageId,
  deleteSticky,
  saveOriginalNickname,
  getOriginalNickname,
  deleteOriginalNickname,
  addModerationLog,
  getModerationLogs,
  vote,
  getVotes,
  updateTicketLastMessage,
  getAppealLink: (g) => settings(g).appeal_link || null,
};
