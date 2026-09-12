const fs = require("node:fs");
const path = require("node:path");
const store = require("../src/database");

const GUILD_ID = "985227944236568606";
const inputPath = path.resolve(__dirname, "../farms_builds.jsonl");
const importerPath = __filename;

function parseRecords() {
  const records = [];
  for (const [index, line] of fs.readFileSync(inputPath, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
    }
    if (!record.dn || !record.upload_date) {
      throw new Error(`Missing dn or upload_date on line ${index + 1}`);
    }
    const createdAt = Date.parse(record.upload_date);
    if (!Number.isFinite(createdAt)) {
      throw new Error(`Invalid upload_date on line ${index + 1}: ${record.upload_date}`);
    }
    records.push({
      dn: String(record.dn).trim(),
      video: record.video_link || null,
      video_title: record.title || null,
      world: record.world_link || null,
      schematic: record.schematic_link || null,
      created_at: createdAt,
    });
  }
  return records;
}

function mergeRecords(records) {
  const merged = new Map();
  for (const record of records) {
    const current = merged.get(record.dn);
    if (!current) {
      merged.set(record.dn, record);
      continue;
    }
    for (const key of ["video", "video_title", "world", "schematic"]) {
      if (!current[key] && record[key]) current[key] = record[key];
    }
  }
  return [...merged.values()];
}

const records = mergeRecords(parseRecords());
store.ensureGuild(GUILD_ID);

store.db.exec("BEGIN");
try {
  for (const record of records) {
    store.upsertFarm(GUILD_ID, record.dn, record, "one-shot-jsonl-import");
  }
  store.db.exec("COMMIT");
} catch (error) {
  store.db.exec("ROLLBACK");
  throw error;
}

console.log(`[farm import] imported ${records.length} farms into guild ${GUILD_ID}`);
fs.unlinkSync(importerPath);
