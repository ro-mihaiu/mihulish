const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATABASE_PATH = path.resolve(
  process.env.DATABASE_URL || "./data/mihulish.db",
);

// Privacy gate: this deployment stores and serves database data for a single
// guild only. Every write path checks this before touching the database.
const ALLOWED_GUILD_ID = "985227944236568606";
function isAllowedGuild(guildId) {
  return guildId === ALLOWED_GUILD_ID;
}

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
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, content TEXT NOT NULL, due_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sticky_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT, content TEXT NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(guild_id,channel_id));
CREATE TABLE IF NOT EXISTS moderation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, moderator_id TEXT, reason TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS original_nicknames (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, nickname TEXT, PRIMARY KEY (guild_id, user_id));
CREATE TABLE IF NOT EXISTS farm_channel_config (guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE, video_channel_id TEXT, world_channel_id TEXT, schematic_channel_id TEXT);
CREATE TABLE IF NOT EXISTS farms (guild_id TEXT NOT NULL, dn TEXT NOT NULL, type TEXT, video TEXT, video_title TEXT, world TEXT, schematic TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT, PRIMARY KEY (guild_id, dn));
CREATE INDEX IF NOT EXISTS farms_type ON farms(guild_id, type, created_at);
CREATE TABLE IF NOT EXISTS dn_lookup_cooldowns (user_id TEXT PRIMARY KEY, last_used_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS farm_changelog (guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE, pending_changes TEXT NOT NULL DEFAULT '[]', last_exported_changes TEXT NOT NULL DEFAULT '[]', last_exported_at INTEGER);
CREATE TABLE IF NOT EXISTS farm_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, dn TEXT, kind TEXT NOT NULL, url TEXT, title TEXT, message_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS guild_wikis (guild_id TEXT NOT NULL, article_name TEXT NOT NULL, link TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER, PRIMARY KEY (guild_id, article_name));
CREATE UNIQUE INDEX IF NOT EXISTS guild_wikis_name ON guild_wikis(guild_id, article_name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS custom_commands (guild_id TEXT NOT NULL, trigger TEXT NOT NULL, content TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, trigger));
CREATE TABLE IF NOT EXISTS saved_embeds (guild_id TEXT NOT NULL, embed_id TEXT NOT NULL, channel_id TEXT NOT NULL, webhook_id TEXT, message_id TEXT, title TEXT, content TEXT, author_id TEXT, author_name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER, PRIMARY KEY (guild_id, embed_id));
CREATE INDEX IF NOT EXISTS saved_embeds_channel ON saved_embeds(guild_id, channel_id);
CREATE TABLE IF NOT EXISTS embed_webhooks (guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, webhook_id TEXT NOT NULL, webhook_token TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, channel_id));
`);

// Column migrations for pre-existing tables (must run after the CREATE TABLE
// block above so they never fail with "no such table" on older/newer DBs).
try {
  db.exec("ALTER TABLE tickets ADD COLUMN last_message_at INTEGER");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
// Per-ticket ping toggle: 0 (default) = ping the ticket when it goes stale,
// 1 = never ping anyone in this ticket (set with `/ticket ping:<off>`).
try {
  db.exec("ALTER TABLE tickets ADD COLUMN ping_disabled INTEGER NOT NULL DEFAULT 0");
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
try {
  db.exec("ALTER TABLE sticky_messages ADD COLUMN sticky_id TEXT");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}

// Farm-table migrations.
for (const col of ["type TEXT", "video_title TEXT", "created_at INTEGER"]) {
  try {
    db.exec(`ALTER TABLE farms ADD COLUMN ${col}`);
  } catch (error) {
    if (!error.message.includes("duplicate column name")) throw error;
  }
}
try {
  db.exec("ALTER TABLE farm_suggestions ADD COLUMN title TEXT");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
// Optional display-only role name (used when the live Discord role isn't mapped).
try {
  db.exec("ALTER TABLE staff ADD COLUMN role_name TEXT");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
try {
  db.exec("ALTER TABLE guild_settings ADD COLUMN dn_link_style TEXT");
} catch (error) {
  if (!error.message.includes("duplicate column name")) throw error;
}
try {
  db.exec("CREATE INDEX IF NOT EXISTS farms_type ON farms(guild_id, type, created_at)");
} catch {}
try {
  db.exec(
    "UPDATE farms SET created_at = updated_at WHERE created_at IS NULL",
  );
} catch {}

// Voting was removed: drop the tables so existing databases stop carrying the
// data. Idempotent, and never referenced by any command any more.
db.exec("DROP TABLE IF EXISTS user_votes");
db.exec("DROP TABLE IF EXISTS votes");

const DEFAULT_TICKET_PANELS = ["java", "br", "bug", "report", "partnership"];

// One-time farm seed for the allowed guild from farms_builds.jsonl.
// Idempotent: existing farm rows (e.g. manager-curated links) are never overwritten.
try {
  const jsonlPath = path.resolve(__dirname, "../farms_builds.jsonl");
  if (fs.existsSync(jsonlPath)) {
    const seen = new Set(
      db.prepare("SELECT dn FROM farms WHERE guild_id=?").all(ALLOWED_GUILD_ID).map((r) => r.dn),
    );
    let seeded = 0;
    for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (!row?.dn || seen.has(row.dn)) continue;
      upsertFarm(ALLOWED_GUILD_ID, row.dn, {
        video: row.video_link || null,
        video_title: row.title || null,
        world: row.world_link || null,
        schematic: row.schematic_link || null,
        created_at: row.upload_date ? Date.parse(row.upload_date) || undefined : undefined,
      }, null);
      seeded++;
    }
    if (seeded) console.log(`[database] seeded ${seeded} farm(s) from farms_builds.jsonl`);
  }
} catch (error) {
  console.error("[database] farm seed failed:", error.message);
}

function ensureGuild(guildId) {
  if (!isAllowedGuild(guildId)) return;
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
function addReminder(g, u, c, content, dueAt) {
  ensureGuild(g);
  const info = db
    .prepare(
      "INSERT INTO reminders(guild_id,user_id,channel_id,content,due_at,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(g, u, c, content, dueAt, Date.now());
  return db.prepare("SELECT * FROM reminders WHERE id=?").get(info.lastInsertRowid);
}
function dueReminders(now = Date.now()) {
  return db.prepare("SELECT * FROM reminders WHERE due_at<=? ORDER BY due_at").all(now);
}
function deleteReminder(id) {
  db.prepare("DELETE FROM reminders WHERE id=?").run(id);
}
function userReminders(g, u) {
  ensureGuild(g);
  return db
    .prepare(
      "SELECT * FROM reminders WHERE guild_id=? AND user_id=? ORDER BY due_at",
    )
    .all(g, u);
}
function listTicketPanels(guildId) {
  ensureGuild(guildId);
  return db
    .prepare(
      "SELECT panel, tag_name, enabled FROM ticket_panels WHERE guild_id=? ORDER BY panel",
    )
    .all(guildId);
}
function settings(guildId) {
  if (!isAllowedGuild(guildId)) return {};
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
    "dn_link_style",
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
  if (!isAllowedGuild(g)) return null;
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
function upsertStaff(g, u, r, a, roleName = null) {
  ensureGuild(g);
  db.prepare(
    "INSERT INTO staff(guild_id,user_id,role_id,added_by,created_at,role_name) VALUES(?,?,?,?,?,?) " +
      "ON CONFLICT(guild_id,user_id) DO UPDATE SET role_id=excluded.role_id,role_name=COALESCE(excluded.role_name,staff.role_name)",
  ).run(g, u, r, a, Date.now(), roleName);
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
  if (!isAllowedGuild(g)) return null;
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
  if (!isAllowedGuild(g)) return null;
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
function ticketPingDisabled(g, c) {
  const row = db
    .prepare("SELECT ping_disabled FROM tickets WHERE guild_id=? AND channel_id=?")
    .get(g, c);
  return Boolean(row?.ping_disabled);
}
function setTicketPingDisabled(g, c, disabled) {
  db.prepare(
    "UPDATE tickets SET ping_disabled=? WHERE guild_id=? AND channel_id=?",
  ).run(disabled ? 1 : 0, g, c);
  return ticketPingDisabled(g, c);
}
function listOpenTickets(g) {
  ensureGuild(g);
  return db
    .prepare(
      "SELECT * FROM tickets WHERE guild_id=? AND status='OPEN' AND ticket_user_id IS NOT NULL",
    )
    .all(g);
}
function deleteTicket(g, c) {
  db.prepare("DELETE FROM tickets WHERE guild_id=? AND channel_id=?").run(g, c);
}
function addStaffTag(g, name, u, by) {
  if (!isAllowedGuild(g)) return;
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
function removeAllStaffTags(g, u) {
  db.prepare("DELETE FROM staff_tags WHERE guild_id=? AND user_id=?").run(g, u);
  touchStaffDirectory(g);
}
function saveOriginalNickname(g, u, nickname) {
  if (!isAllowedGuild(g)) return;
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
function randomStickyId() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let n = 0; n < 6; n++)
    id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
function getSticky(guildId, channelId) {
  return db
    .prepare("SELECT * FROM sticky_messages WHERE guild_id=? AND channel_id=?")
    .get(guildId, channelId);
}
function setSticky(guildId, channelId, content, format = "plain", embedJson = null) {
  if (!isAllowedGuild(guildId)) return null;
  ensureGuild(guildId);
  let stickyId;
  do {
    stickyId = randomStickyId();
  } while (
    db
      .prepare("SELECT 1 FROM sticky_messages WHERE guild_id=? AND sticky_id=?")
      .get(guildId, stickyId)
  );
  db.prepare(
    "INSERT INTO sticky_messages (guild_id, channel_id, content, format, embed_json, sticky_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(guild_id, channel_id) DO UPDATE SET content=excluded.content, format=excluded.format, embed_json=excluded.embed_json, sticky_id=excluded.sticky_id, message_id=NULL, updated_at=excluded.updated_at",
  ).run(guildId, channelId, content, format, embedJson, stickyId, Date.now());
  return getSticky(guildId, channelId);
}
function getStickyById(guildId, stickyId) {
  return db
    .prepare("SELECT * FROM sticky_messages WHERE guild_id=? AND sticky_id=?")
    .get(guildId, stickyId);
}
function setStickyMessageId(guildId, channelId, messageId) {
  db.prepare(
    "UPDATE sticky_messages SET message_id=? WHERE guild_id=? AND channel_id=?",
  ).run(messageId, guildId, channelId);
}
function listStickies(guildId) {
  return db
    .prepare("SELECT * FROM sticky_messages WHERE guild_id=? ORDER BY channel_id")
    .all(guildId);
}
function deleteSticky(guildId, channelId) {
  const info = db
    .prepare("DELETE FROM sticky_messages WHERE guild_id=? AND channel_id=?")
    .run(guildId, channelId);
  return info.changes > 0;
}
function deleteStickyById(guildId, stickyId) {
  const row = getStickyById(guildId, stickyId);
  if (!row) return null;
  db.prepare("DELETE FROM sticky_messages WHERE guild_id=? AND sticky_id=?").run(
    guildId,
    stickyId,
  );
  return row;
}
function getStickyByMessageId(guildId, messageId) {
  return db
    .prepare("SELECT * FROM sticky_messages WHERE guild_id=? AND message_id=?")
    .get(guildId, messageId);
}
function deleteStickyByMessageId(guildId, messageId) {
  const row = getStickyByMessageId(guildId, messageId);
  if (!row) return null;
  db.prepare("DELETE FROM sticky_messages WHERE guild_id=? AND message_id=?").run(
    guildId,
    messageId,
  );
  return row;
}
// ---------------- Farm link tracker ----------------
function getFarmChannelConfig(guildId) {
  return db
    .prepare("SELECT * FROM farm_channel_config WHERE guild_id=?")
    .get(guildId);
}
function setFarmChannelConfig(guildId, values) {
  ensureGuild(guildId);
  const current = getFarmChannelConfig(guildId) || {};
  db.prepare(
    "INSERT INTO farm_channel_config(guild_id,video_channel_id,world_channel_id,schematic_channel_id) VALUES(?,?,?,?) " +
      "ON CONFLICT(guild_id) DO UPDATE SET video_channel_id=excluded.video_channel_id,world_channel_id=excluded.world_channel_id,schematic_channel_id=excluded.schematic_channel_id",
  ).run(
    guildId,
    values.video_channel_id ?? current.video_channel_id ?? null,
    values.world_channel_id ?? current.world_channel_id ?? null,
    values.schematic_channel_id ?? current.schematic_channel_id ?? null,
  );
  return getFarmChannelConfig(guildId);
}
function farmByChannel(guildId, channelId) {
  const c = getFarmChannelConfig(guildId);
  if (!c) return null;
  if (c.world_channel_id === channelId) return "world";
  if (c.schematic_channel_id === channelId) return "schematic";
  if (c.video_channel_id === channelId) return "video";
  return null;
}
// DNs are alphanumeric (e.g. `467`, `B105`, `C21`) and users type them with
// stray case, spaces or punctuation (`b 105`, `#B105`, `dn:B105`). Collapse
// any input to the canonical uppercase alphanumeric form before lookup.
function normalizeDn(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned || null;
}
// LIKE patterns treat % and _ as wildcards; escape them for literal matching.
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}
function getFarm(guildId, dn) {
  const key = normalizeDn(dn);
  if (!key) return null;
  return db
    .prepare("SELECT * FROM farms WHERE guild_id=? AND dn=? COLLATE NOCASE")
    .get(guildId, key);
}
function upsertFarm(guildId, dn, fields, updatedBy) {
  if (!isAllowedGuild(guildId)) return { farm: null, changed: {}, isNew: false };
  ensureGuild(guildId);
  const key = normalizeDn(dn) || dn;
  const current = getFarm(guildId, key);
  const now = Date.now();
  const merged = {
    type: fields.type ?? current?.type ?? null,
    video: fields.video ?? current?.video ?? null,
    video_title: fields.video_title ?? current?.video_title ?? null,
    world: fields.world ?? current?.world ?? null,
    schematic: fields.schematic ?? current?.schematic ?? null,
  };
  // created_at is set once on first insert and never overwritten on edits.
  const createdAt = fields.created_at ?? current?.created_at ?? now;
  db.prepare(
    "INSERT INTO farms(guild_id,dn,type,video,video_title,world,schematic,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(guild_id,dn) DO UPDATE SET type=excluded.type,video=excluded.video,video_title=excluded.video_title,world=excluded.world,schematic=excluded.schematic,created_at=excluded.created_at,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
  ).run(guildId, key, merged.type, merged.video, merged.video_title, merged.world, merged.schematic, createdAt, now, updatedBy || null);
  const changed = {};
  for (const key2 of ["type", "video", "video_title", "world", "schematic"]) {
    if (fields[key2] !== undefined && fields[key2] !== current?.[key2]) changed[key2] = fields[key2];
  }
  return { farm: getFarm(guildId, key), changed, isNew: !current };
}
function deleteFarm(guildId, dn) {
  const key = normalizeDn(dn);
  if (!key) return false;
  return (
    db
      .prepare("DELETE FROM farms WHERE guild_id=? AND dn=? COLLATE NOCASE")
      .run(guildId, key).changes > 0
  );
}
function listFarms(guildId, type = null) {
  if (type)
    return db
      .prepare("SELECT * FROM farms WHERE guild_id=? AND type=? ORDER BY created_at DESC")
      .all(guildId, type);
  return db
    .prepare("SELECT * FROM farms WHERE guild_id=? ORDER BY created_at DESC")
    .all(guildId);
}
// Prefix/substring search over DNs, powering `/dn` autocomplete and the
// "did you mean" hints when a lookup misses. Prefix hits are ranked first.
function searchFarms(guildId, query, limit = 25) {
  const key = normalizeDn(query);
  if (!key)
    return db
      .prepare(
        "SELECT dn, type, video_title FROM farms WHERE guild_id=? ORDER BY dn COLLATE NOCASE LIMIT ?",
      )
      .all(guildId, limit);
  const like = `%${escapeLike(key)}%`;
  const prefix = `${escapeLike(key)}%`;
  return db
    .prepare(
      "SELECT dn, type, video_title FROM farms WHERE guild_id=? AND dn LIKE ? ESCAPE '\\' " +
        "ORDER BY CASE WHEN dn LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, dn COLLATE NOCASE LIMIT ?",
    )
    .all(guildId, like, prefix, limit);
}
// Close matches for a failed lookup: DNs containing the query, the digit-only
// reading of it (`B105` still finds `105`), then numeric neighbours so a gap in
// the sequence (`B105`) points at the DNs around it.
function suggestFarms(guildId, dn, limit = 5) {
  const key = normalizeDn(dn);
  if (!key) return [];
  const rows = [];
  const seen = new Set();
  const push = (row) => {
    if (row && !seen.has(row.dn)) {
      seen.add(row.dn);
      rows.push(row);
    }
  };
  const byLike = db.prepare(
    "SELECT dn, video_title FROM farms WHERE guild_id=? AND dn LIKE ? ESCAPE '\\' ORDER BY dn COLLATE NOCASE LIMIT ?",
  );
  // 1. DNs containing the query as typed.
  for (const row of byLike.all(guildId, `%${escapeLike(key)}%`, limit * 2)) push(row);
  // 2. Numeric neighbours fill a gap in the sequence (`B105` -> B104/B106).
  if (rows.length < limit) {
    const shaped = key.match(/^([A-Z]*)(\d+)([A-Z]*)$/);
    if (shaped) {
      const [, prefix, rawDigits, suffix] = shaped;
      const width = rawDigits.length;
      const byDn = db.prepare(
        "SELECT dn, video_title FROM farms WHERE guild_id=? AND dn=? COLLATE NOCASE",
      );
      const centre = Number(rawDigits);
      for (const delta of [1, -1, 2, -2, 3, -3]) {
        const next = centre + delta;
        if (next < 0) continue;
        push(byDn.get(guildId, prefix + String(next).padStart(width, "0") + suffix));
      }
    }
  }
  // 3. Lookalike characters (`B1O5` -> B105) and the bare digits (`105`).
  if (rows.length < limit) {
    const folded = key.replace(/[O]/g, "0").replace(/[IL]/g, "1").replace(/[S]/g, "5");
    if (folded !== key)
      for (const row of byLike.all(guildId, `%${escapeLike(folded)}%`, limit)) push(row);
    const digits = key.replace(/[^0-9]/g, "");
    if (digits && digits !== key)
      for (const row of byLike.all(guildId, `%${escapeLike(digits)}%`, limit)) push(row);
  }
  return rows.slice(0, limit);
}
function setDnCooldown(userId, timestamp = Date.now()) {
  db.prepare(
    "INSERT INTO dn_lookup_cooldowns(user_id,last_used_at) VALUES(?,?) " +
      "ON CONFLICT(user_id) DO UPDATE SET last_used_at=excluded.last_used_at",
  ).run(userId, timestamp);
}
function getDnCooldown(userId) {
  return db
    .prepare("SELECT last_used_at FROM dn_lookup_cooldowns WHERE user_id=?")
    .get(userId)?.last_used_at || null;
}
function farmChangelogState(guildId) {
  ensureGuild(guildId);
  db.prepare("INSERT OR IGNORE INTO farm_changelog(guild_id) VALUES(?)").run(guildId);
  const row = db
    .prepare("SELECT * FROM farm_changelog WHERE guild_id=?")
    .get(guildId);
  if (!row) return { pending_changes: [], last_exported_changes: [], last_exported_at: null };
  let pending, last;
  try { pending = JSON.parse(row.pending_changes) || []; } catch { pending = []; }
  try { last = JSON.parse(row.last_exported_changes) || []; } catch { last = []; }
  return { pending_changes: pending, last_exported_changes: last, last_exported_at: row.last_exported_at || null };
}
function setFarmChangelogState(guildId, pending, lastExported) {
  ensureGuild(guildId);
  db.prepare(
    "INSERT INTO farm_changelog(guild_id,pending_changes,last_exported_changes,last_exported_at) VALUES(?,?,?,?) " +
      "ON CONFLICT(guild_id) DO UPDATE SET pending_changes=excluded.pending_changes,last_exported_changes=excluded.last_exported_changes,last_exported_at=excluded.last_exported_at",
  ).run(
    guildId,
    JSON.stringify(pending || []),
    JSON.stringify(lastExported || []),
    Date.now(),
  );
}
function appendFarmChange(guildId, entry) {
  const state = farmChangelogState(guildId);
  state.pending_changes.push(entry);
  db.prepare("UPDATE farm_changelog SET pending_changes=? WHERE guild_id=?").run(
    JSON.stringify(state.pending_changes),
    guildId,
  );
}
function rotateFarmChangelog(guildId) {
  const state = farmChangelogState(guildId);
  const current = state.pending_changes;
  setFarmChangelogState(guildId, [], current);
  return { current, previous: state.last_exported_changes };
}
function upsertFarmSuggestion(guildId, { dn = null, kind, url = null, title = null, messageId = null }) {
  if (!isAllowedGuild(guildId)) return null;
  ensureGuild(guildId);
  // try to merge into an existing partial suggestion (same dn, same kind)
  const existing = db
    .prepare("SELECT * FROM farm_suggestions WHERE guild_id=? AND kind=?")
    .all(guildId, kind);
  const target =
    existing.find((x) => dn && x.dn === dn) ||
    existing.find((x) => url && x.url === url) ||
    existing.find((x) => messageId && x.message_id === messageId) ||
    existing.find((x) => x.dn === null && x.url === null);
  if (target) {
    db.prepare(
      "UPDATE farm_suggestions SET dn=COALESCE(dn,?),url=COALESCE(url,?),title=COALESCE(title,?),message_id=COALESCE(message_id,?) WHERE id=?",
    ).run(dn, url, title, messageId, target.id);
    return db.prepare("SELECT * FROM farm_suggestions WHERE id=?").get(target.id);
  }
  const dupe = url
    ? db
        .prepare("SELECT 1 FROM farm_suggestions WHERE guild_id=? AND kind=? AND url=? AND dn IS ?")
        .get(guildId, kind, url, dn)
    : null;
  if (dupe) return null;
  db.prepare(
    "INSERT INTO farm_suggestions(guild_id,dn,kind,url,title,message_id,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(guildId, dn, kind, url, title, messageId, Date.now());
  return null;
}
function listFarmSuggestions(guildId) {
  return db
    .prepare("SELECT * FROM farm_suggestions WHERE guild_id=? ORDER BY created_at DESC")
    .all(guildId);
}
function deleteFarmSuggestion(guildId, id) {
  return db.prepare("DELETE FROM farm_suggestions WHERE guild_id=? AND id=?").run(guildId, id).changes > 0;
}
function getFarmByDn(guildId, dn) {
  return getFarm(guildId, dn);
}
// ---------------- Per-guild wiki ----------------
function addWikiEntry(guildId, articleName, link, createdBy) {
  ensureGuild(guildId);
  const now = Date.now();
  try {
    db.prepare(
      "INSERT INTO guild_wikis(guild_id,article_name,link,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).run(guildId, articleName, link, createdBy || null, now, now);
  } catch (error) {
    if (!String(error.message).includes("UNIQUE")) throw error;
    return db
      .prepare(
        "SELECT * FROM guild_wikis WHERE guild_id=? AND article_name=? COLLATE NOCASE",
      )
      .get(guildId, articleName);
  }
  return db
    .prepare(
      "SELECT * FROM guild_wikis WHERE guild_id=? AND article_name=? COLLATE NOCASE",
    )
    .get(guildId, articleName);
}
function deleteWikiByLink(guildId, link) {
  return (
    db
      .prepare(
        "DELETE FROM guild_wikis WHERE guild_id=? AND lower(trim(link))=lower(?)",
      )
      .run(guildId, link.trim()).changes > 0
  );
}
function getWikiByName(guildId, articleName) {
  return db
    .prepare(
      "SELECT * FROM guild_wikis WHERE guild_id=? AND article_name=? COLLATE NOCASE",
    )
    .get(guildId, articleName.trim());
}
function listWikiNames(guildId) {
  return db
    .prepare(
      "SELECT article_name FROM guild_wikis WHERE guild_id=? ORDER BY article_name COLLATE NOCASE",
    )
    .all(guildId)
    .map((x) => x.article_name);
}
function listWikiLinks(guildId) {
  return db
    .prepare("SELECT * FROM guild_wikis WHERE guild_id=? ORDER BY article_name COLLATE NOCASE")
    .all(guildId);
}

function addCustomCommand(guildId, trigger, content, createdBy) {
  return db
    .prepare(
      "INSERT OR REPLACE INTO custom_commands(guild_id,trigger,content,created_by,created_at) VALUES(?,?,?,?,?)",
    )
    .run(guildId, trigger.toLowerCase().trim(), content.trim(), createdBy, Date.now());
}

function removeCustomCommand(guildId, trigger) {
  return db
    .prepare("DELETE FROM custom_commands WHERE guild_id=? AND trigger=?")
    .run(guildId, trigger.toLowerCase().trim()).changes > 0;
}

function getCustomCommand(guildId, trigger) {
  return db
    .prepare("SELECT * FROM custom_commands WHERE guild_id=? AND trigger=?")
    .get(guildId, trigger.toLowerCase().trim());
}

function listCustomCommands(guildId) {
  return db
    .prepare("SELECT * FROM custom_commands WHERE guild_id=? ORDER BY trigger COLLATE NOCASE")
    .all(guildId);
}

// ---------------- Saved embeds ----------------
// Embeds are posted through a per-channel webhook so the message carries the
// server name and icon instead of the bot's, and stay editable/deletable later.
const EMBED_ID_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randomEmbedId() {
  let id = "";
  for (let n = 0; n < 8; n++)
    id += EMBED_ID_CHARS[Math.floor(Math.random() * EMBED_ID_CHARS.length)];
  return id;
}
function getEmbed(guildId, embedId) {
  if (!embedId) return null;
  return db
    .prepare(
      "SELECT * FROM saved_embeds WHERE guild_id=? AND embed_id=? COLLATE NOCASE",
    )
    .get(guildId, embedId);
}
function createEmbed(
  guildId,
  {
    channelId,
    webhookId = null,
    messageId = null,
    title = null,
    content = null,
    authorId = null,
    authorName = null,
  },
) {
  if (!isAllowedGuild(guildId)) return null;
  ensureGuild(guildId);
  let embedId;
  do {
    embedId = randomEmbedId();
  } while (getEmbed(guildId, embedId));
  db.prepare(
    "INSERT INTO saved_embeds (guild_id, embed_id, channel_id, webhook_id, message_id, title, content, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    guildId,
    embedId,
    channelId,
    webhookId,
    messageId,
    title,
    content,
    authorId,
    authorName,
    Date.now(),
  );
  return getEmbed(guildId, embedId);
}
function listEmbeds(guildId) {
  return db
    .prepare(
      "SELECT * FROM saved_embeds WHERE guild_id=? ORDER BY created_at DESC",
    )
    .all(guildId);
}
function updateEmbed(guildId, embedId, fields = {}) {
  if (!isAllowedGuild(guildId)) return null;
  const row = getEmbed(guildId, embedId);
  if (!row) return null;
  const allowedKeys = ["channel_id", "webhook_id", "message_id", "title", "content"];
  const sets = [];
  const args = [];
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      sets.push(`${key}=?`);
      args.push(fields[key] || null);
    }
  }
  if (!sets.length) return row;
  sets.push("updated_at=?");
  args.push(Date.now(), guildId, row.embed_id);
  db.prepare(
    `UPDATE saved_embeds SET ${sets.join(", ")} WHERE guild_id=? AND embed_id=?`,
  ).run(...args);
  return getEmbed(guildId, row.embed_id);
}
function deleteEmbed(guildId, embedId) {
  const row = getEmbed(guildId, embedId);
  if (!row) return null;
  db.prepare("DELETE FROM saved_embeds WHERE guild_id=? AND embed_id=?").run(
    guildId,
    row.embed_id,
  );
  return row;
}
function getEmbedWebhook(guildId, channelId) {
  return db
    .prepare("SELECT * FROM embed_webhooks WHERE guild_id=? AND channel_id=?")
    .get(guildId, channelId);
}
function setEmbedWebhook(guildId, channelId, webhookId, webhookToken) {
  if (!isAllowedGuild(guildId)) return null;
  db.prepare(
    "INSERT INTO embed_webhooks (guild_id, channel_id, webhook_id, webhook_token, created_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(guild_id, channel_id) DO UPDATE SET webhook_id=excluded.webhook_id, webhook_token=excluded.webhook_token",
  ).run(guildId, channelId, webhookId, webhookToken, Date.now());
  return getEmbedWebhook(guildId, channelId);
}
function deleteEmbedWebhook(guildId, channelId) {
  db.prepare("DELETE FROM embed_webhooks WHERE guild_id=? AND channel_id=?").run(
    guildId,
    channelId,
  );
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
  ticketPingDisabled,
  setTicketPingDisabled,
  addStaffTag,
  removeStaffTag,
  removeAllStaffTags,
  userTags,
  getSticky,
  setSticky,
  setStickyMessageId,
  listStickies,
  getStickyById,
  deleteStickyById,
  deleteStickyByMessageId,
  deleteSticky,
  saveOriginalNickname,
  getOriginalNickname,
  deleteOriginalNickname,
  addModerationLog,
  getModerationLogs,
  updateTicketLastMessage,
  listOpenTickets,
  getAppealLink: (g) => settings(g).appeal_link || null,
  getFarmChannelConfig,
  setFarmChannelConfig,
  farmByChannel,
  getFarm,
  getFarmByDn,
  searchFarms,
  suggestFarms,
  normalizeDn,
  upsertFarm,
  deleteFarm,
  listFarms,
  listFarmsByType: (g, t) => listFarms(g, t),
  setDnCooldown,
  getDnCooldown,
  farmChangelogState,
  setFarmChangelogState,
  appendFarmChange,
  rotateFarmChangelog,
  upsertFarmSuggestion,
  listFarmSuggestions,
  deleteFarmSuggestion,
  addWikiEntry,
  deleteWikiByLink,
  getWikiByName,
  listWikiNames,
  listWikiLinks,
  addCustomCommand,
  removeCustomCommand,
  getCustomCommand,
  listCustomCommands,
  getEmbed,
  createEmbed,
  listEmbeds,
  updateEmbed,
  deleteEmbed,
  getEmbedWebhook,
  setEmbedWebhook,
  deleteEmbedWebhook,
  listTicketPanels,
  addReminder,
  dueReminders,
  deleteReminder,
  userReminders,
  saveTicket,
  ticket,
  assignTicket,
};
