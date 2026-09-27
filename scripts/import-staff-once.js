// One-time staff roster import from a Discord message-log export (discord-msgs.txt).
// Runs on ClientReady (needs the member cache to resolve usernames to IDs), then
// marks itself done with scripts/.staff-imported so it never re-runs.
const fs = require("node:fs");
const path = require("node:path");
const store = require("../src/database");

const MARKER = path.join(__dirname, ".staff-imported");
const LOG_PATH = path.resolve(
  process.env.STAFF_IMPORT_LOG || path.join(__dirname, "../discord-msgs.txt"),
);
const GUILD_ID = "985227944236568606";
const MANAGER_ROLE_ID = "1106015726864699492";
const STAFF_ROLE_ID = "1118591747472228482";

// Role ID each imported group maps to. Groups not listed here get STAFF_ROLE_ID.
const GROUP_ROLE_IDS = {
  "Manager": MANAGER_ROLE_ID,
};

// IDs recovered from raw <@...> mentions in the log (other members are resolved
// from the guild member cache at runtime).
const KNOWN_IDS = {
  "ro_mihaiu": "1027052856697684099",
  "catrooper": "1379526531415806135",
  "theysix": "483592560842113025",
  "fish5438": "208189775474065409",
  ".notmik": "941372925754359848",
  "omarmokhtar.": "885967601505820752",
};

// The final "Configured staff" block in the log is the fullest roster snapshot
// (names grouped under role headings, e.g. "@Name (username) - LOA").
function lastConfiguredStaffBlock(text) {
  const lines = text.split("\n");
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "Configured staff") starts.push(i);
  }
  if (!starts.length) return [];
  // Block ends at the "Last updated" footer or the next non-member line.
  const start = starts[starts.length - 1];
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^Last updated/i.test(line)) break;
    block.push(line);
  }
  return block;
}

// Returns [{ roleName, display, username, status }].
function parseRoster(block) {
  const entries = [];
  let roleName = null;
  const memberRe = /^@(.+?) \((.+?)\)(?: - (LOA|SLOA))?$/;
  for (const line of block) {
    const m = line.match(memberRe);
    if (m) {
      entries.push({ roleName, display: m[1], username: m[2], status: m[3] || null });
    } else if (!/^No tags$/.test(line)) {
      roleName = line;
    }
  }
  return entries;
}

async function runStaffImport(client) {
  if (fs.existsSync(MARKER)) return;
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    const entries = parseRoster(lastConfiguredStaffBlock(fs.readFileSync(LOG_PATH, "utf8")));
    if (!entries.length) {
      fs.writeFileSync(MARKER, "no roster found\n");
      return;
    }
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) await guild.members.fetch().catch(() => {});
    // The log only exposed role names, never IDs — now we have the real ones.
    store.updateSettings(GUILD_ID, { manager_role_id: MANAGER_ROLE_ID });
    let imported = 0, skipped = 0;
    for (const e of entries) {
      let id = KNOWN_IDS[e.username.toLowerCase()];
      if (!id && guild) {
        const member = guild.members.cache.find(
          (x) =>
            x.user.username.toLowerCase() === e.username.toLowerCase() ||
            (x.nickname || "").toLowerCase() === e.username.toLowerCase(),
        );
        id = member?.id;
      }
      if (!id) { skipped++; continue; }
      store.upsertStaff(
        GUILD_ID,
        id,
        GROUP_ROLE_IDS[e.roleName] || STAFF_ROLE_ID,
        "import",
        e.roleName,
      );
      if (e.status === "LOA" && !store.getLeave("loa", GUILD_ID, id)) {
        store.setLeave("loa", GUILD_ID, id, true, "LOA (imported)", null, null);
      }
      imported++;
    }
    fs.writeFileSync(MARKER, `${new Date().toISOString()} — ${imported} imported, ${skipped} unresolved\n`);
    console.log(`[staff-import] imported ${imported} staff member(s), ${skipped} unresolved`);
  } catch (error) {
    console.error("[staff-import]", error.message);
  }
}

module.exports = { runStaffImport };
