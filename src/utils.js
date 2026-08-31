const { EmbedBuilder } = require("discord.js");
const store = require("./database");

const COLOR = 0xe91e63;

function makeEmbed() {
  return new EmbedBuilder().setColor(COLOR);
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
    await ch.send({
      embeds: [makeEmbed().setTitle("📜 Command Log").setDescription(description).setTimestamp()],
    });
  } catch (error) {
    console.error("Failed to log command:", error);
  }
}

async function logEvent(guildId, client, { title, description }) {
  const ch = await getLogChannel(guildId, client);
  if (!ch) return;
  try {
    await ch.send({
      embeds: [makeEmbed().setTitle(title).setDescription(description).setTimestamp()],
    });
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
    await ch.send({
      embeds: [makeEmbed().setTitle("🛡️ Moderation Log").setDescription(desc).setTimestamp()],
    });
  } catch (error) {
    console.error("Failed to log moderation:", error);
  }
}

module.exports = { makeEmbed, logCommand, logEvent, logModeration };
