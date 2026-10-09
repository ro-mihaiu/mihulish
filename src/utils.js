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

// maxresdefault 404s on older/low-resolution uploads, which renders as a broken
// embed image. Probe once per video, remember the working size, and fall back to
// hqdefault (always present) so /dn embeds never show a dead image.
const thumbnailCache = new Map();
async function resolveThumbnail(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) return null;
  const cached = thumbnailCache.get(videoId);
  if (cached !== undefined) return cached;
  const candidates = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  ];
  let resolved = null;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        method: "HEAD",
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        resolved = candidate;
        break;
      }
    } catch {
      // network hiccup: stop probing and use whatever we have
      break;
    }
  }
  thumbnailCache.set(videoId, resolved);
  return resolved;
}

// ---------------- Wiki search ----------------
// `/wiki article:<keyword>` searches the TheySix wiki and minecraft.wiki.
// The TheySix wiki has no search API, so the article list comes from its
// sitemap.xml (cached for an hour) and matches on the URL slug.
const WIKI_SITEMAP_URL = "https://wiki-theysix.ro-mihaiu.xyz/sitemap.xml";
const WIKI_USER_AGENT = "Mozilla/5.0 (compatible; Mihulish bot)";
let wikiIndexCache = { at: 0, pages: [] };
async function theysixWikiIndex() {
  if (wikiIndexCache.pages.length && Date.now() - wikiIndexCache.at < 60 * 60 * 1000)
    return wikiIndexCache.pages;
  const res = await fetch(WIKI_SITEMAP_URL, {
    headers: { "user-agent": WIKI_USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`sitemap fetch failed (${res.status})`);
  const pages = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => u.includes("/w/"));
  if (pages.length) wikiIndexCache = { at: Date.now(), pages };
  return pages;
}
// Score every article slug against the keyword: exact slug match wins, then
// substring, then how many of the keyword's words appear in the slug.
function scoreWikiSlug(slug, words, joined) {
  if (slug === joined) return 100;
  if (slug.includes(joined)) return 60;
  const hits = words.filter((w) => w && slug.includes(w)).length;
  return hits ? 10 + hits * 5 : 0;
}
function fetchWikiMeta(url) {
  // Best-effort: fall back to a humanised slug when the page can't be read.
  const fallback = (url.split("/w/")[1] || "").split("-").join(" ");
  // The wiki lives on wiki-theysix.ro-mihaiu.xyz; article URLs in the sitemap
  // use the apex domain which 404s, so read the page from the wiki host.
  const metaUrl = url.replace("//theysix.ro-mihaiu.xyz/", "//wiki-theysix.ro-mihaiu.xyz/");
  return (async () => {
    const res = await fetch(metaUrl, {
      headers: { "user-agent": WIKI_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { title: fallback, description: null };
    const html = (await res.text()).slice(0, 200_000);
    const t = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    const d =
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i.exec(html);
    return {
      title: t ? t[1].replace(/\s*\|\s*TheySix Wiki\s*$/i, "").trim() : fallback,
      description: d ? d[1].trim() : null,
    };
  })().catch(() => ({ title: fallback, description: null }));
}
async function searchTheySixWiki(query, limit = 3) {
  const pages = await theysixWikiIndex();
  const words = query.toLowerCase().trim().split(/[\s_-]+/);
  const joined = words.join("-");
  const hits = pages
    .map((url) => ({
      url,
      score: scoreWikiSlug(url.split("/w/")[1] || "", words, joined),
    }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return Promise.all(
    hits.map(async (h) => {
      const { title, description } = await fetchWikiMeta(h.url);
      return { source: "TheySix Wiki", title, url: h.url, description };
    }),
  );
}
async function searchMinecraftWiki(query, limit = 3) {
  const url = `https://minecraft.wiki/api.php?action=opensearch&format=json&limit=${limit}&search=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "user-agent": WIKI_USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`minecraft.wiki search failed (${res.status})`);
  const data = await res.json();
  // opensearch returns [query, titles, descriptions, urls]; older shapes may
  // only include the titles.
  const titles = Array.isArray(data?.[1]) ? data[1] : [];
  const descs = Array.isArray(data?.[2]) ? data[2] : [];
  const links = Array.isArray(data?.[3]) ? data[3] : [];
  return titles.slice(0, limit).map((title, idx) => ({
    source: "Minecraft Wiki",
    title,
    description: descs[idx] || null,
    url: links[idx] || `https://minecraft.wiki/w/${encodeURIComponent(title.replace(/\s/g, "_"))}`,
  }));
}
// Combined search for `/wiki article:...` — TheySix results first (this is the
// community's own wiki), minecraft.wiki as the fallback. Either source failing
// alone still returns the other's results.
async function searchWikis(query) {
  const [theysix, minecraft] = await Promise.allSettled([
    searchTheySixWiki(query, 3),
    searchMinecraftWiki(query, 3),
  ]);
  return {
    results: [
      ...(theysix.status === "fulfilled" ? theysix.value : []),
      ...(minecraft.status === "fulfilled" ? minecraft.value : []),
    ],
    errors: [theysix, minecraft]
      .filter((r) => r.status === "rejected")
      .map((r) => r.reason?.message || "unknown error"),
  };
}

module.exports = { makeEmbed, logCommand, logEvent, logModeration, sendDM, fetchVideoTitle, extractYouTubeId, getYouTubeThumbnail, resolveThumbnail, searchWikis };
