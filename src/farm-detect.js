// Passive farm detection: watches the video / world / schematic channels set
// with `/channels` and registers farms as their links are posted.
//
// Video posts (a YouTube embed carrying the title) create or refresh the farm
// row outright. World and schematic posts attach to an existing farm when the DN
// is known, and are staged as suggestions for a manager when it is not.
// A link that disagrees with a confirmed farm is never overwritten silently — it
// is logged as a conflict and staged instead.
const store = require("./database");
const { logEvent } = require("./utils");

// DNs are alphanumeric (`467`, `B105`, `C21`). Accept the canonical 📪 form
// first, then the plain variants people actually type.
const DN_TOKEN = "([A-Za-z]{0,3}[^A-Za-z0-9]{0,2}\\d{1,6}[A-Za-z0-9]{0,3})";
const DN_PATTERNS = [
  new RegExp(`\u{1F4EA}\\s*DN\\s*[:=\\-]?\\s*${DN_TOKEN}`, "giu"),
  new RegExp(`(?<![\\p{L}\\p{N}])dn\\s*[:=\\-]\\s*${DN_TOKEN}`, "giu"),
  new RegExp(`(?<![\\p{L}\\p{N}])dn\\s+${DN_TOKEN}`, "giu"),
];
// Last resort: a lone token shaped like a DN, when the message has exactly one.
const BARE_DN_PATTERN = /(?:^|[\s(])([A-Za-z]{0,3}\d{1,6}[A-Za-z0-9]{0,3})(?![\w/])/gu;
const URL_REGEX = /https?:\/\/\S+/g;

// Relay bots explicitly allowed to trigger detection (comma-separated IDs).
const RELAY_BOTS = (process.env.FARM_RELAY_BOT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Throttle for "ignored a bot message" notices so a busy relay channel cannot
// flood the log channel.
const skippedBotNotice = new Map();
function noticeSkippedBot(guildId, client, channelId, author) {
  if (RELAY_BOTS.includes(author.id)) return;
  const key = `${channelId}:${author.id}`;
  const last = skippedBotNotice.get(key) || 0;
  if (Date.now() - last < 60 * 60 * 1000) return;
  skippedBotNotice.set(key, Date.now());
  logEvent(guildId, client, {
    title: "🌱 Farm detection skipped a bot message",
    description:
      `A message from ${author} (\`${author.id}\`) in <#${channelId}> was ignored because only allow-listed relay bots trigger detection.\n` +
      `Add \`${author.id}\` to \`FARM_RELAY_BOT_IDS\` if this channel should be watched.`,
  }).catch(() => {});
}

function extractDn(text) {
  if (!text) return null;
  for (const pattern of DN_PATTERNS) {
    const m = [...text.matchAll(pattern)][0];
    if (m) return store.normalizeDn(m[1]);
  }
  // No explicit "DN" marker: accept a single bare token that looks like a DN,
  // as long as it isn't part of a URL, date or time.
  const scannable = text
    .replace(URL_REGEX, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const bare = [...scannable.matchAll(BARE_DN_PATTERN)]
    .map((m) => store.normalizeDn(m[1]))
    .filter(Boolean);
  const unique = [...new Set(bare)];
  return unique.length === 1 ? unique[0] : null;
}

function extractUrls(text) {
  if (!text) return [];
  return [...text.matchAll(URL_REGEX)].map((m) => m[0].replace(/[)>,]+$/, ""));
}

function collectUrls(message) {
  const urls = new Set(extractUrls(message.content));
  for (const embed of message.embeds || []) {
    if (embed.url) urls.add(embed.url);
    for (const u of extractUrls(embed.description)) urls.add(u);
  }
  return [...urls];
}

function collectText(message) {
  const parts = [message.content];
  for (const embed of message.embeds || []) {
    parts.push(embed.title, embed.description);
  }
  return parts.filter(Boolean).join("\n");
}

function stageSuggestion(guildId, message, kind, dn, url, extra = {}) {
  if (!dn && !url) return;
  const merged = store.upsertFarmSuggestion(guildId, {
    dn,
    kind,
    url,
    messageId: message.id,
    ...extra,
  });
  if (!merged) return;
  logEvent(guildId, message.client, {
    title: "🌱 New farm suggestion",
    description:
      `Staged a ${kind} link for DN \`${merged.dn ?? "(unknown)"}\` from <#${message.channel.id}>.\n` +
      `A manager can confirm it with \`/farm add\`.`,
  }).catch(() => {});
}

// Register (or top up) a farm from a detected link. Returns "added", "updated",
// "conflict" or null when there was nothing to record.
function recordFarm(guildId, message, kind, dn, url, extra = {}) {
  if (!dn || !url) {
    stageSuggestion(guildId, message, kind, dn, url, extra);
    return null;
  }
  const existing = store.getFarm(guildId, dn);
  // A brand-new DN is only registered outright from the video channel: the video
  // is what makes a farm findable. Bare world/schematic posts wait for a manager.
  if (!existing && kind !== "video") {
    stageSuggestion(guildId, message, kind, dn, url, extra);
    return null;
  }
  if (existing && existing[kind] && existing[kind] !== url) {
    // A confirmed farm already holds this dn: flag, never overwrite silently.
    logEvent(guildId, message.client, {
      title: "🌱 Farm suggestion conflict",
      description:
        `DN \`${dn}\` already exists in the farms table but a new ${kind} link was posted in <#${message.channel.id}> by ${message.author}.\n` +
        `Existing: ${existing[kind]}\nNew: ${url}\nA manager can reconcile this with \`/farm add\`.`,
    }).catch(() => {});
    stageSuggestion(guildId, message, kind, dn, url, extra);
    return "conflict";
  }
  const { farm, isNew } = store.upsertFarm(guildId, dn, { [kind]: url, ...extra }, message.author.id);
  // The link now lives on the farm row, so any staged suggestion is redundant.
  for (const s of store.listFarmSuggestions(guildId)) {
    if (store.normalizeDn(s.dn) === dn) store.deleteFarmSuggestion(guildId, s.id);
  }
  logEvent(guildId, message.client, {
    title: isNew ? "🌱 New farm detected" : "🌱 Farm updated",
    description:
      `${isNew ? "Registered" : "Updated"} DN \`${farm.dn}\` from the ${kind} channel <#${message.channel.id}>.\n` +
      (farm.video_title ? `Title: ${farm.video_title}\n` : "") +
      `Link: ${url}`,
  }).catch(() => {});
  return isNew ? "added" : "updated";
}

async function handleFarmMessage(message) {
  if (!message.guild) return;
  const guildId = message.guild.id;
  const kind = store.farmByChannel(guildId, message.channel.id);
  if (!kind) return;
  if (message.author.bot && !RELAY_BOTS.includes(message.author.id)) {
    noticeSkippedBot(guildId, message.client, message.channel.id, message.author);
    return;
  }

  const text = collectText(message);
  const dn = extractDn(text);
  const urls = collectUrls(message);

  if (kind === "video") {
    // Video links arrive as embeds whose title hyperlinks to embed.url.
    // The title text is stored verbatim so /dn can reproduce it byte-for-byte.
    for (const e of message.embeds || []) {
      if (!e.url) continue;
      recordFarm(guildId, message, "video", dn, e.url, { video_title: e.title ?? null });
    }
    // Some relays post the link as plain text instead of an embed.
    if (!message.embeds?.some((e) => e.url) && urls.length)
      recordFarm(guildId, message, "video", dn, urls[0]);
    return;
  }

  // world / schematic: dn + link expected in the same message
  recordFarm(guildId, message, kind, dn, urls[0] || null);
}

module.exports = { handleFarmMessage, extractDn, extractUrls, collectUrls, recordFarm };