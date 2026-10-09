require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const {
  commands,
  store,
  farmPages,
  farmListEmbed,
  buildDnEmbed,
  dnButtonRow,
  DN_BUTTON_TTL_MS,
  pingStaleTickets,
  handleEmbedButton,
  handleEmbedModal,
  captureSnipe,
  handlePollVote,
  finishEndedPolls,
  deliverDueReminders,
} = require("./commands");
const { handleTicketInteraction } = require("./tickets");
const { handlePrefixMessage } = require("./prefix");
const { logCommand, logEvent, sendDM } = require("./commands");
const logger = require("./logger");

// One-shot importers are optional: if the import scripts/files were removed
// after a successful run, the bot still boots normally.
let runStaffImport = null;
const staffImporterPath = path.resolve(__dirname, "../scripts/import-staff-once.js");
if (fs.existsSync(staffImporterPath)) {
  ({ runStaffImport } = require(staffImporterPath));
}

const oneShotFarmImporter = path.resolve(__dirname, "../scripts/import-farms-once.js");
if (fs.existsSync(oneShotFarmImporter)) require(oneShotFarmImporter);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORD_TOKEN || "",
);
// There is no bulk delete on the global command route (it answers 405); the
// documented way to empty it is to overwrite it with an empty list.
async function clearGlobalCommands(applicationId) {
  try {
    const stale = await rest.get(Routes.applicationCommands(applicationId));
    if (!stale.length) return;
    await rest.put(Routes.applicationCommands(applicationId), { body: [] });
    logger.log(
      `[commands] cleared ${stale.length} leftover global command(s) so they do not duplicate the guild ones`,
    );
  } catch (e) {
    // Never let cleanup look like a registration failure.
    logger.error("[commands] could not clear leftover global commands", e);
  }
}
async function register(applicationId) {
  const body = commands.map((c) => c.data.toJSON());
  const guildId = process.env.DISCORD_GUILD_ID;
  // Log which scope was used: a guild-scoped overwrite shows up immediately,
  // while a global one can take up to an hour to propagate to clients.
  const scope = guildId
    ? `guild ${guildId}`
    : "global (can take up to an hour to appear)";
  if (guildId) {
    await rest.put(
      Routes.applicationGuildCommands(applicationId, guildId),
      { body },
    );
    // A global set registered before this guild was configured is still there,
    // and Discord keeps both, so every command shows up twice.
    await clearGlobalCommands(applicationId);
  } else await rest.put(Routes.applicationCommands(applicationId), { body });
  logger.log(
    `[commands] registered ${body.length} commands for ${applicationId} (${scope})`,
  );
}
client.once(Events.ClientReady, async (c) => {
  console.log(`[mihulish] ready as ${c.user.tag}`);
  logger.log(`[mihulish] ready as ${c.user.tag}`);
  await c.application?.fetch().catch(() => {});
  for (const g of c.guilds.cache.values()) store.ensureGuild(g.id);
  if (runStaffImport) {
    await runStaffImport(c).catch((e) =>
      console.error("[staff-import]", e.message),
    );
  }
  // Prefer CLIENT_ID when set; otherwise fall back to the verified bot user ID
  // so registration still works when .env / panel env vars are incomplete.
  const applicationId = process.env.CLIENT_ID || c.user.id;
  await register(applicationId).catch((e) =>
    logger.error(
      `[commands] registration failed for ${applicationId}`,
      e,
    ),
  );
});
client.on(Events.GuildCreate, (g) => {
  store.ensureGuild(g.id);
  logger.log(`[mihulish] was added to ${g.id}`);
});
client.on(Events.GuildDelete, (g) => {
  logger.log(`[mihulish] was removed from ${g.id}`);
});
function ticketInfo(channel) {
  const s = store.settings(channel.guild.id);
  if (!s.support_category_id || channel.parentId !== s.support_category_id)
    return null;
  const name = channel.name.toLowerCase();
  const closed = name.startsWith("closed-");
  const raw = closed ? name.slice(7) : name;
  const panel = store.db
    .prepare(
      "SELECT panel FROM ticket_panels WHERE guild_id=? AND enabled=1 AND ? LIKE panel||'-%' ORDER BY length(panel) DESC LIMIT 1",
    )
    .get(channel.guild.id, raw)?.panel;
  if (!panel) return null;
  const suffix = raw.slice(panel.length + 1);
  const member = channel.guild.members.cache.find(
    (m) =>
      m.user.username.toLowerCase() === suffix ||
      m.displayName.toLowerCase() === suffix,
  );
  return { closed, panel, userId: member?.id || null };
}
async function inspectTicket(channel) {
  if (!channel.guild) return;
  const info = ticketInfo(channel);
  if (!info) return;
  if (info.closed) store.deleteTicket(channel.guild.id, channel.id);
  else
    store.saveTicket(
      channel.guild.id,
      channel.id,
      info.panel,
      info.userId,
      "OPEN",
    );
}
client.on(Events.ChannelCreate, inspectTicket);
client.on(Events.ChannelUpdate, (_old, next) => inspectTicket(next));
client.on(Events.MessageDelete, captureSnipe);
// Reminders and timed polls: check every 30 seconds.
setInterval(() => {
  deliverDueReminders(client).catch((e) => console.error("[reminders]", e.message));
  finishEndedPolls(client).catch((e) => console.error("[polls]", e.message));
}, 30000);
client.on(Events.MessageCreate, handlePrefixMessage);
const { handleFarmMessage } = require("./farm-detect");
client.on(Events.MessageCreate, (message) => {
  handleFarmMessage(message).catch((e) =>
    console.error("[farm-detect]", e.message),
  );
});

async function maintainSticky(message) {
  if (message.author.bot || !message.guild) return;
  const sticky = store.getSticky(message.guild.id, message.channel.id);
  if (!sticky) return;
  try {
    const last = await message.channel.messages
      .fetch({ limit: 1, cache: false })
      .then((m) => m.first());
    if (last && last.id === sticky.message_id) return;
  } catch {
    return;
  }
  if (sticky.message_id) {
    await message.channel.messages
      .delete(sticky.message_id)
      .catch(() => {});
  }
  try {
    let payload;
    if (sticky.format === "embed" && sticky.embed_json) {
      const data = JSON.parse(sticky.embed_json);
      const e = new EmbedBuilder().setColor(0xe91e63);
      if (data.title) e.setTitle(data.title);
      if (data.description) e.setDescription(data.description);
      if (data.fields?.length) e.addFields(data.fields.map((f) => ({ name: f, value: "\u200b" })));
      payload = { embeds: [e] };
    } else {
      payload = { content: sticky.content };
    }
    const sent = await message.channel.send(payload);
    store.setStickyMessageId(message.guild.id, message.channel.id, sent.id);
  } catch {
    // ignore send errors (missing permissions etc.)
  }
}
client.on(Events.MessageCreate, maintainSticky);

// DNs are alphanumeric (`467`, `B105`, `C21`), and people type them with
// prefixes, stray punctuation and lowercase (`dn:B105`, `?dn b105`, `/dn B 105`).
// Capture the DN token after any of those markers and let the store normalize it.
const DN_TYPO_REGEX = /(?<![\p{L}\p{N}])[^\p{L}\p{N}]*dn(?![\p{L}\p{N}])[^\p{L}\p{N}]{0,3}([a-z]{0,3}[^a-z0-9]{0,2}\d+[a-z0-9]*)/iu;
const DN_CHANNEL_ID = "1107506735897395332";

async function handleDnTypoMessage(message) {
  if (!message.guild || message.author.bot) return;
  if (message.channel.id !== DN_CHANNEL_ID) return;

  const match = message.content.match(DN_TYPO_REGEX);
  if (!match) return;

  const dn = store.normalizeDn(match[1]);
  if (!dn) return;
  const farm = store.getFarm(message.guild.id, dn);
  if (!farm) return;

  const { embed: built, row } = await buildDnEmbed(farm, message.guild.id, message.author);
  await message
    .reply({ embeds: [built], components: row ? [row] : [] })
    .catch(() => {});
}

client.on(Events.MessageCreate, (message) => {
  handleDnTypoMessage(message).catch((e) =>
    console.error("[dn-typo]", e.message),
  );
});

async function handleCustomCommand(message) {
  if (!message.guild || message.author.bot) return;
  const trigger = message.content.trim().toLowerCase();
  const cmd = store.getCustomCommand(message.guild.id, trigger);
  if (!cmd) return;
  await message.reply(cmd.content).catch(() => {});
}

client.on(Events.MessageCreate, (message) => {
  handleCustomCommand(message).catch((e) =>
    console.error("[custom-cmd]", e.message),
  );
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const s = store.settings(message.guild.id);
  if (!s?.support_category_id || message.channel?.parentId !== s.support_category_id) return;
  const name = message.channel.name.toLowerCase();
  const panel = store.db
    .prepare(
      "SELECT panel FROM ticket_panels WHERE guild_id=? AND enabled=1 AND ? LIKE panel||'-%' ORDER BY length(panel) DESC LIMIT 1",
    )
    .get(message.guild.id, name)?.panel;
  if (!panel) return;
  const ticket = store.ticket(message.guild.id, message.channel.id);
  if (ticket && ticket.status === "OPEN") {
    store.updateTicketLastMessage(message.guild.id, message.channel.id);
  }
});

// Automatic sweep: ping tickets with no staff reply for 24h. `/ticket ping:<h>`
// uses the same helper with a caller-chosen window.
const TICKET_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const TICKET_SWEEP_IDLE_HOURS = 24;
async function checkTicketReminders() {
  for (const guild of client.guilds.cache.values()) {
    try {
      await pingStaleTickets(guild, TICKET_SWEEP_IDLE_HOURS);
    } catch (e) {
      console.error("[ticket-reminders]", e.message);
    }
  }
}

setInterval(checkTicketReminders, TICKET_SWEEP_INTERVAL_MS);

// Answer a button click with a short notice. Ephemeral follow-ups are not
// accepted everywhere a farm embed can live (the DM channel `/dn` uses by
// default), so a plain follow-up is the fallback rather than losing the reply.
function buttonNotice(i, content, useEphemeral = true) {
  return i
    .followUp({ content, ephemeral: useEphemeral, allowedMentions: { parse: [] } })
    .catch(() =>
      useEphemeral
        ? buttonNotice(i, content, false)
        : Promise.resolve(null),
    );
}

// Farm link buttons on /dn embeds. The click is handled here rather than being a
// Link button so the 10-minute expiry can be enforced, and so using a button
// pushes the expiry back out — the timer only runs out after 10 idle minutes.
// `/dn` delivers embeds by DM, so the guild id comes from the custom id rather
// than the interaction, and the link itself is a followUp because `update()` has
// already acknowledged the interaction by the time we answer.
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton()) return;
  if (
    await handleTicketInteraction(i).catch((e) => {
      console.error("[tickets]", e.message);
      return true;
    })
  )
    return;
  if (await handlePollVote(i).catch((e) => {
    console.error("[poll-vote]", e.message);
    return true;
  }))
    return;
  const parts = i.customId.split("|");
  if (parts[0] !== "farm_dl") return;
  const [, guildId, dn, kind, expiresRaw] = parts;
  const expiresAt = Number(expiresRaw);
  const farm = store.getFarm(guildId, dn);
  const label = kind === "video" ? "video" : kind === "world" ? "world" : "schematic";

  if (!farm) {
    return buttonNotice(i, `I no longer know about farm \`${dn}\`. Run \`/dn\` again for current farms.`);
  }
  const url = farm[kind];
  if (!url) {
    return buttonNotice(i, `That farm no longer has a ${label} link. Run \`/dn\` again for the current files.`);
  }
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    // Grey the row out so nobody keeps clicking a dead button.
    await i
      .update({ components: [dnButtonRow(farm, guildId, 0, true)].filter(Boolean) })
      .catch(() => {});
    return buttonNotice(
      i,
      `These buttons expired after 10 minutes of inactivity. Run \`/dn ${dn}\` again for fresh links.`,
    );
  }
  await i
    .update({ components: [dnButtonRow(farm, guildId, Date.now() + DN_BUTTON_TTL_MS)].filter(Boolean) })
    .catch(() => {});
  return buttonNotice(i, `**${farm.dn} — ${label}**\n${url}`);
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || !i.guildId) return;
  const command = commands.find((c) => c.data.name === i.commandName);
  if (!command) return;
  try {
    await i.deferReply();
  } catch (e) {
    console.error("[interaction] failed to acknowledge command:", e);
    return;
  }
  logCommand(i.guildId, i.client, {
    command: `/${i.commandName}`,
    input: i.options.data
      .filter((o) => o.value !== undefined)
      .map((o) => {
        let value = o.value;
        if (o.type === 6) value = `<@${value}>`;
        else if (o.type === 7) value = `<#${value}>`;
        else if (o.type === 8) value = `<@&${value}>`;
        return `${o.name}: ${value}`;
      })
      .join(", "),
    user: i.user,
    channelName: i.channel?.name,
  }).catch(() => {});
  try {
    await command.execute(i);
  } catch (e) {
    logger.error(
      `[mihulish] someone ran /${i.commandName} in ${i.guildId} and got this error ${e.name}`,
      e,
    );
    await i.editReply({
      content: "Mihulish could not complete that request.",
    }).catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isAutocomplete()) return;
  const command = commands.find((c) => c.data.name === i.commandName);
  if (!command?.autocomplete) return i.respond([]).catch(() => {});
  try {
    await command.autocomplete(i);
  } catch (e) {
    console.error("[autocomplete]", i.commandName, e.message);
  }
});

// `/embed` opens a modal form instead of taking options, so its button and
// modal-submit interactions live outside the slash-command dispatcher.
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton() && !i.isModalSubmit()) return;
  if (!i.guildId) return;
  try {
    await handleEmbedButton(i);
    await handleEmbedModal(i);
  } catch (e) {
    console.error("[embed]", e.message);
    if (i.isRepliable() && !i.replied && !i.deferred) {
      await i
        .reply({ content: "Mihulish could not complete that embed request.", ephemeral: true })
        .catch(() => {});
    }
  }
});

const FARM_LIST_PER_PAGE = 10;
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isButton() || !i.customId.startsWith("farm_list_")) return;
  const [, , dir, token, typeRaw] = i.customId.split("_");
  const state = farmPages.get(token);
  if (!state) {
    await i.update({ content: "This farm list has expired — run `/farm list` again.", components: [], embeds: [] }).catch(() => {});
    return;
  }
  const farms = store.listFarms(state.guildId, state.type);
  const pages = Math.max(1, Math.ceil(farms.length / FARM_LIST_PER_PAGE));
  const next = dir === "next" ? state.page + 1 : state.page - 1;
  if (next < 0 || next >= pages) return i.deferUpdate().catch(() => {});
  state.page = next;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`farm_list_prev_${token}_${typeRaw}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(next === 0),
    new ButtonBuilder()
      .setCustomId(`farm_list_next_${token}_${typeRaw}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(next >= pages - 1),
  );
  await i
    .update({
      embeds: [farmListEmbed(state.guildId, farms, next, FARM_LIST_PER_PAGE, state.type, state.footer)],
      components: [row],
    })
    .catch(() => {});
});

client.on(Events.GuildMemberAdd, (member) => {
  logEvent(member.guild.id, member.client, {
    title: "📥 Member Joined",
    description: `${member} - ${member.user.username} joined the server.\n**Account created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
  }).catch(() => {});
});

client.on(Events.GuildMemberRemove, (member) => {
  logEvent(member.guild.id, member.client, {
    title: "📤 Member Left",
    description: `${member} - ${member.user.username} left the server.`,
  }).catch(() => {});
});

client.on(Events.GuildBanAdd, (ban) => {
  logEvent(ban.guild.id, ban.client, {
    title: "🔨 Member Banned",
    description: `${ban.user} - ${ban.user.username} was banned.\n**Reason:** ${ban.reason || "No reason provided"}`,
  }).catch(() => {});
});

client.on(Events.GuildBanRemove, (ban) => {
  logEvent(ban.guild.id, ban.client, {
    title: "🔓 Member Unbanned",
    description: `${ban.user} - ${ban.user.username} was unbanned.`,
  }).catch(() => {});
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  if (!oldMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp) {
    const until = newMember.communicationDisabledUntilTimestamp;
    logEvent(newMember.guild.id, newMember.client, {
      title: "🔇 Member Muted (Timeout)",
      description: `${newMember} - ${newMember.user.username} was muted.\n**Until:** <t:${Math.floor(until / 1000)}:F> (<t:${Math.floor(until / 1000)}:R>)`,
    }).catch(() => {});
  } else if (oldMember.communicationDisabledUntilTimestamp && !newMember.communicationDisabledUntilTimestamp) {
    logEvent(newMember.guild.id, newMember.client, {
      title: "🔊 Member Unmuted",
      description: `${newMember} - ${newMember.user.username} was unmuted.`,
    }).catch(() => {});
  }
});

client.on(Events.Error, (e) => console.error("[discord]", e));
process.on("unhandledRejection", (e) => console.error("[promise]", e));
if (require.main === module) {
  if (!process.env.DISCORD_TOKEN) console.error("DISCORD_TOKEN is missing.");
  else
    client
      .login(process.env.DISCORD_TOKEN)
      .catch((e) => console.error("[login]", e.message));
}
module.exports = { client, register };
