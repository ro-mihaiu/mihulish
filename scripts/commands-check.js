// Reports what Discord actually has registered, so a duplicate slash command
// can be traced to the server state or to client-side propagation lag.
//   npm run commands-check
require("dotenv").config();
const { REST, Routes } = require("discord.js");

const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORD_TOKEN || "",
);

function duplicates(names) {
  const seen = new Set();
  const dupes = new Set();
  for (const name of names) {
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }
  return [...dupes];
}

async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN is missing.");
  const applicationId = process.env.CLIENT_ID;
  if (!applicationId) throw new Error("CLIENT_ID is missing.");
  const guildId = process.env.DISCORD_GUILD_ID;

  const me = await rest.get("/users/@me");
  console.log(`bot            ${me.username} (${me.id})`);
  console.log(`CLIENT_ID      ${applicationId}`);
  if (me.id !== applicationId)
    console.log(
      "  WARNING: CLIENT_ID is not this bot's id, so commands are registered against another application.",
    );
  console.log(
    `scope          ${guildId ? `guild ${guildId}` : "global (no DISCORD_GUILD_ID set)"}`,
  );

  const global = await rest.get(Routes.applicationCommands(applicationId));
  console.log(`\nglobal         ${global.length} command(s)`);

  const guild = guildId
    ? await rest.get(Routes.applicationGuildCommands(applicationId, guildId))
    : [];
  if (guildId) console.log(`guild          ${guild.length} command(s)`);

  const problems = [];
  if (global.length) {
    problems.push(`${global.length} leftover global command(s)`);
    console.log(
      "  These apply to every guild and are what makes commands look duplicated next\n" +
        "  to the guild ones. Clear them by overwriting the set with an empty list:\n" +
        "  PUT /applications/{id}/commands   body: []",
    );
  }
  const guildDupes = duplicates(guild.map((c) => c.name));
  if (guildDupes.length) {
    problems.push(`duplicates inside the guild set: ${guildDupes.join(", ")}`);
    console.log(`  DUPLICATES in the guild set: ${guildDupes.join(", ")}`);
  }

  const shadowedNames = guildId
    ? global.map((c) => c.name).filter((name) => guild.some((g) => g.name === name))
    : [];
  if (shadowedNames.length)
    console.log(
      `\npresent in both scopes (${shadowedNames.length}): ${shadowedNames.join(", ")}\n` +
        "  Discord can show these twice until the global removal propagates, which\n" +
        "  takes up to an hour. Guild-side changes are instant; global ones are not.",
    );

  console.log(
    `\nverdict        ${
      problems.length ? problems.join("; ") : "server state is clean"
    }`,
  );
  if (!problems.length && shadowedNames.length)
    console.log(
      "                (duplicates seen in the client are propagation lag, not server state)",
    );
}

main().catch((e) => {
  console.error(`\ncommands-check failed: ${e.status ?? ""} ${e.message}`);
  process.exit(1);
});