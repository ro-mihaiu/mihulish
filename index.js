require("dotenv").config();
const { client, register } = require("./src/index.js");
if (process.env.DISCORD_TOKEN) {
  client.login(process.env.DISCORD_TOKEN).catch((e) => console.error("[login]", e.message));
} else {
  console.error("DISCORD_TOKEN is missing.");
}
