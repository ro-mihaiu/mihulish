require("dotenv").config();
const store = require("../src/database");
store.ensureGuild("smoke-guild");
const warning = store.addWarning("smoke-guild", "user", "moderator", "test");
if (!warning || warning.guild_id !== "smoke-guild")
  throw new Error("warning persistence failed");
store.setLeave("loa", "smoke-guild", "user", true, "test", null, null);
store.setLeave("sloa", "smoke-guild", "user", true, "test", "evenings", null);
store.tag("smoke-guild", "java");
console.log("database smoke test passed", {
  warningId: warning.id,
  loa: !!store.getLeave("loa", "smoke-guild", "user"),
  sloa: !!store.getLeave("sloa", "smoke-guild", "user"),
});
