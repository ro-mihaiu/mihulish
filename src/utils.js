const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require("discord.js");
const store = require("./database");

const COLOR = 0xe91e63;

function makeEmbed(title, description) {
  return new ContainerBuilder()
    .setAccentColor(COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${title}`),
      new TextDisplayBuilder().setContent(description),
      new SeparatorBuilder().setDivider(true),
      new TextDisplayBuilder().setContent(`Logged <t:${Math.floor(Date.now() / 1000)}:F>`),
    );
}

function v2Payload(title, description) {
  return { components: [makeEmbed(title, description)], flags: 32768 };
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
    await ch.send(v2Payload("Command Log", description));
  } catch (error) {
    console.error("Failed to log command:", error);
  }
}

async function logEvent(guildId, client, { title, description }) {
  const ch = await getLogChannel(guildId, client);
  if (!ch) return;
  try {
    await ch.send(v2Payload(title, description));
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
    await ch.send(v2Payload("Moderation Log", desc));
  } catch (error) {
    console.error("Failed to log moderation:", error);
  }
}

module.exports = { makeEmbed, logCommand, logEvent, logModeration };
