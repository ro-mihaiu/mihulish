require("dotenv").config();
const store = require("../src/database");
// The database is single-guild gated (ALLOWED_GUILD_ID in src/database.js),
// so the smoke test must use the real guild id rather than a fake one.
const GUILD_ID = "985227944236568606";
store.ensureGuild(GUILD_ID);
const warning = store.addWarning(GUILD_ID, "smoke-user", "smoke-moderator", "test");
if (!warning || warning.guild_id !== GUILD_ID)
  throw new Error("warning persistence failed");
const fetchedWarning = store.getWarning(GUILD_ID, warning.id);
if (!fetchedWarning || fetchedWarning.reason !== "test")
  throw new Error("getWarning failed");
const deleted = store.deleteWarning(GUILD_ID, warning.id);
if (!deleted || store.getWarning(GUILD_ID, warning.id))
  throw new Error("deleteWarning failed");
store.setLeave("loa", GUILD_ID, "smoke-user", true, "test", null, null);
store.setLeave("sloa", GUILD_ID, "smoke-user", true, "test", "evenings", null);
store.tag(GUILD_ID, "java");
console.log("database smoke test passed", {
  warningId: warning.id,
  loa: !!store.getLeave("loa", GUILD_ID, "smoke-user"),
  sloa: !!store.getLeave("sloa", GUILD_ID, "smoke-user"),
});
