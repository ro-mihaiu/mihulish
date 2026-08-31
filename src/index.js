require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
} = require("discord.js");
const { commands, store } = require("./commands");
const { handlePrefixMessage } = require("./prefix");
const { logCommand, logEvent } = require("./commands");

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
async function register() {
  const body = commands.map((c) => c.data.toJSON());
  if (process.env.DISCORD_GUILD_ID)
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.DISCORD_GUILD_ID,
      ),
      { body },
    );
  else
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body });
  console.log(`[commands] registered ${body.length} commands`);
}
client.once(Events.ClientReady, async (c) => {
  console.log(`[mihulish] ready as ${c.user.tag}`);
  await c.application?.fetch().catch(() => {});
  for (const g of c.guilds.cache.values()) store.ensureGuild(g.id);
  if (process.env.CLIENT_ID)
    await register().catch((e) =>
      console.error("[commands] registration failed:", e.message),
    );
});
client.on(Events.GuildCreate, (g) => store.ensureGuild(g.id));
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
client.on(Events.MessageCreate, handlePrefixMessage);

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand() || !i.guildId) return;
  const command = commands.find((c) => c.data.name === i.commandName);
  if (!command) return;
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
    console.error("[interaction]", e);
    const reply = {
      content: "Mihulish could not complete that request.",
      ephemeral: true,
    };
    if (i.replied || i.deferred) await i.followUp(reply).catch(() => {});
    else await i.reply(reply).catch(() => {});
  }
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
