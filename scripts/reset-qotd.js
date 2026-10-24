require("dotenv").config();
const store = require("../src/database");

// TEMPORARY: resets the QOTD day counter so the next tick posts Day 1.
// Delete this file after running it once.
const GUILD_ID = "985227944236568606";

store.ensureGuild(GUILD_ID);
store.setQotdState(GUILD_ID, 0, null);

console.log("[reset-qotd] QOTD countdown reset to Day 1 for guild", GUILD_ID);
console.log("[reset-qotd] next scheduler tick will post the first question immediately.");
console.log("[reset-qotd] Delete scripts/reset-qotd.js after running.");
