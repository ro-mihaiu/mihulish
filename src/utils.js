const { EmbedBuilder } = require("discord.js");
const store = require("./database");

const COLOR = 0xe91e63;

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(String(title ?? "Mihulish Log"))
    .setDescription(String(description ?? "No details provided."))
    .setTimestamp();
}

function embedPayload(title, description) {
  return { embeds: [makeEmbed(title, description)] };
}

async function getLogChannel(guildId, client) {
  if (!guildId || !client) return null;
  const s = store.settings(guildId);
  if (!s?.log_channel_id) return null;
  try {
    const ch = await client.channels.fetch(s.log_channel_id).catch(() => null);
    return ch?.isTextBased() ? ch : null;
  } catch {
    return null;
  }
}

async function logCommand(guildId, client, { command, input = "", user, channelName = "Unknown" }) {
  const ch = await getLogChannel(guildId, client);
  if (!ch) return;
  try {
    const description = [
      `**Command:** \`${command}\`${input ? ` [${input}]` : ""}`,
      `**User:** ${user} - ${user?.username ?? user?.tag ?? "Unknown"}`,
      `**Channel:** ${channelName}`,
      `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`,
    ].join("\n");
    await ch.send(embedPayload("Command Log", description));
  } catch (error) {
    console.error("Failed to log command:", error);
  }
}

async function logEvent(guildId, client, { title = "Event Log", description = "No details provided." } = {}) {
  const ch = await getLogChannel(guildId, client);
  if (!ch) return;
  try {
    await ch.send(embedPayload(title, description));
  } catch (error) {
    console.error("Failed to log event:", error);
  }
}

async function logModeration(guildId, client, { action, targetId, moderatorId, reason }) {
  store.addModerationLog(guildId, action, targetId, moderatorId, reason);
  const ch = await getLogChannel(guildId, client);
  if (!ch) return;
  try {
    const desc = [
      `**Action:** ${action}`,
      `**Target:** <@${targetId}>`,
      `**Moderator:** <@${moderatorId}>`,
      `**Reason:** ${reason || "No reason provided"}`,
      `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`,
    ].join("\n");
    await ch.send(embedPayload("Moderation Log", desc));
  } catch (error) {
    console.error("Failed to log moderation:", error);
  }
}

async function sendDM(userId, client, title, description) {
  if (!userId || !client) return false;
  try {
    const user = await client.users.fetch(userId);
    if (!user) return false;
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(String(title ?? "Mihulish"))
          .setDescription(String(description ?? "No details provided."))
          .setTimestamp(),
      ],
    });
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { makeEmbed, logCommand, logEvent, logModeration, sendDM };
