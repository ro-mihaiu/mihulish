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
// Fetch the page title of a video URL via oEmbed (YouTube etc.) with an
// OpenGraph meta-tag fallback. Returns null when neither path yields a title.
async function fetchVideoTitle(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  // Known oEmbed endpoints embed the video URL as a query parameter.
  let oembedUrl = null;
  if (/youtube\.com|youtu\.be/i.test(url))
    oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  else if (/vimeo\.com/i.test(url))
    oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
  if (oembedUrl) {
    try {
      const res = await fetch(oembedUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.title) return String(data.title);
      }
    } catch {
      // fall through to OpenGraph
    }
  }
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Mihulish bot)" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const html = (await res.text()).slice(0, 300_000);
      const m =
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html) ||
        /<title[^>]*>([^<]+)<\/title>/i.exec(html);
      if (m) return m[1].trim();
    }
  } catch {
    // network error — give up
  }
  return null;
}

function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/i,
    /youtube\.com\/shorts\/([^&\n?#]+)/i,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function getYouTubeThumbnail(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) return null;
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
}

module.exports = { makeEmbed, logCommand, logEvent, logModeration, sendDM, fetchVideoTitle, extractYouTubeId, getYouTubeThumbnail };
