// Passive farm link detection: watches the configured world / schematic /
// video channels and stages suggestions for manager review via /farm add.
const store = require("./database");
const { logEvent } = require("./utils");

// U+1F4EA 📪 — Discord delivers the raw unicode character, not the shortcode.
const DN_REGEX = /\u{1F4EA}\s*DN\s*:\s*(\S+)/giu;
const URL_REGEX = /https?:\/\/\S+/g;

// Relay bots explicitly allowed to trigger detection (comma-separated IDs).
const RELAY_BOTS = (process.env.FARM_RELAY_BOT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function extractDn(text) {
  if (!text) return null;
  const m = [...text.matchAll(DN_REGEX)][0];
  return m ? m[1].replace(/[<>]/g, "").trim() : null;
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
  const existing = store.getFarmByDn(guildId, dn);
  if (existing && existing[kind] && existing[kind] !== url) {
    // A confirmed farm already holds this dn: flag, never overwrite silently.
    logEvent(guildId, message.client, {
      title: "🌱 Farm suggestion conflict",
      description:
        `DN \`${dn}\` already exists in the farms table but a new ${kind} link was posted in <#${message.channel.id}> by ${message.author}.\n` +
        `Existing: ${existing[kind]}\nNew: ${url}\nA manager can reconcile this with \`/farm add\`.`,
    }).catch(() => { });
  }
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
  }).catch(() => { });
}

async function handleFarmMessage(message) {
  if (!message.guild) return;
  if (message.author.bot && !RELAY_BOTS.includes(message.author.id)) return;
  const guildId = message.guild.id;
  const kind = store.farmByChannel(guildId, message.channel.id);
  if (!kind) return;

  const text = collectText(message);
  const dn = extractDn(text);
  const urls = collectUrls(message);

  if (kind === "video") {
    // Video links arrive as embeds whose title hyperlinks to embed.url.
    // The title text is stored verbatim so /dn can reproduce it byte-for-byte.
    for (const e of message.embeds || []) {
      if (!e.url) continue;
      stageSuggestion(guildId, message, "video", dn, e.url, { title: e.title ?? null });
    }
    return;
  }

  // world / schematic: dn + link expected in the same message
  stageSuggestion(guildId, message, kind, dn, urls[0] || null);
}

module.exports = { handleFarmMessage, extractDn, extractUrls, collectUrls };
