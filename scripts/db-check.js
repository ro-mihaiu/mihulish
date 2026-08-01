// ─── SQLite storage smoke test / migration check ───────────────────────────
// Run with: node scripts/db-check.js
//
// 1. Loads the database (this also triggers the one-time JSON → SQLite
//    migration if data/bot-data.json exists and the DB is fresh).
// 2. Prints row counts for every table.
// 3. Performs a save → reload round-trip and verifies the data matches.
const { loadData, saveData, getStats, close } = require('../database');

const data = loadData();

console.log('=== SQLite storage check ===');
console.log('Tables (row counts):');
for (const [table, count] of Object.entries(getStats())) {
  console.log(`  ${table}: ${count}`);
}
console.log('Loaded sections:');
console.log(`  users:             ${Object.keys(data.users).length}`);
console.log(`  warnings:          ${data.warnings.length}`);
console.log(`  nextWarningId:     ${data.nextWarningId}`);
console.log(`  wallOfFame:        ${data.wallOfFame.length}`);
console.log(`  items:             ${Object.keys(data.items).length}`);
console.log(`  subscriptions:     ${Object.keys(data.subscriptions).length}`);
console.log(`  sessions:          ${Object.keys(data.sessions).length}`);
console.log(`  coins:             ${Object.keys(data.coins).length}`);
console.log(`  giveaways:         ${data.giveaways.length}`);
console.log(`  customCommands:    ${Object.keys(data.customCommands).length}`);
console.log(`  claims:            ${Object.keys(data.claims).length}`);

// Round-trip: save the in-memory state, reload, and compare.
saveData(data);
const reloaded = loadData();
const before = JSON.stringify(data);
const after = JSON.stringify(reloaded);

if (before === after) {
  console.log('\nRound-trip save → reload: OK');
} else {
  console.error('\nRound-trip save → reload: MISMATCH!');
  process.exitCode = 1;
}

close();

