// Ticket Learning Module — extracts useful Q&A from closed tickets
// and creates wiki entries for helpers to reference later.
const { EmbedBuilder } = require("discord.js");
const store = require("./database");
const { extractTicketKnowledge, addTicketLearning, listTicketLearning, getTicketLearning, updateTicketLearningStatus, setTicketLearningWikiArticle, deleteTicketLearning, isStaff, SOLUTION_INDICATORS } = require("./database");

function embed(title, description, color = 0xe91e63) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
}

// ---------------- Transcript import helpers ----------------

function slugify(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapPanelToPlatform(panel) {
  const mapping = {
    java: "java",
    bedrock: "bedrock",
    br: "bedrock",
    bug: "java",
    report: "discord",
    partnership: "discord",
  };
  return mapping[panel?.toLowerCase()] || "java";
}

function unescapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"');
}

// Minimum time a ticket must be open before we consider it for learning (15 min)
const MIN_TICKET_DURATION_MS = 15 * 60 * 1000;
// Only learn from tickets that were actually resolved (not just abandoned)
const MIN_MESSAGES_FOR_LEARNING = 5;

/**
 * Called when a ticket is closed. Analyzes the conversation and extracts
 * potential knowledge. Stores as pending entries for staff review.
 */
async function learnFromClosedTicket(guild, channel, ticketRow) {
  const duration = Date.now() - ticketRow.created_at;
  if (duration < MIN_TICKET_DURATION_MS) return { learned: 0, reason: "too short" };

  // Fetch messages — we already have them from the transcript generation
  let messages = [];
  try {
    let lastId;
    for (let round = 0; round < 20; round++) {
      const batch = await channel.messages.fetch({
        limit: 100,
        before: lastId,
        cache: false,
      });
      if (!batch.size) break;
      messages.push(...batch.values());
      lastId = batch.last().id;
      if (batch.size < 100) break;
    }
  } catch {
    // Use whatever we got
  }
  messages.reverse();

  if (messages.length < MIN_MESSAGES_FOR_LEARNING) return { learned: 0, reason: "too few messages" };

  const knowledge = extractTicketKnowledge(messages, ticketRow.panel, guild.id);
  if (!knowledge.length) return { learned: 0, reason: "no extractable knowledge" };

  let learned = 0;
  for (const k of knowledge) {
    const id = addTicketLearning(guild.id, ticketRow.id, channel.id, ticketRow.panel, k.question, k.answer, k.keywords);
    if (id) learned++;
  }
  return { learned };
}

/**
 * Review a pending learning entry and approve/reject it.
 * If approved, creates a wiki article.
 */
async function reviewTicketLearning(guild, interaction, learningId, action, customName = null) {
  const entry = getTicketLearning(guild.id, learningId);
  if (!entry) return { error: "Learning entry not found" };
  if (entry.status !== "pending") return { error: `Already ${entry.status}` };

  if (action === "reject") {
    updateTicketLearningStatus(guild.id, learningId, "rejected", interaction.user.id);
    return { success: true, message: "Entry rejected and removed from pending" };
  }

  if (action === "approve") {
    // Create wiki entry
    const articleName = customName || generateArticleName(entry);
    const platform = mapPanelToPlatform(entry.panel);
    const slug = slugify(articleName);
    const wikiLink = `https://wiki-theysix.ro-mihaiu.xyz/w/${platform}/${slug}`;
    try {
      const wiki = store.addWikiEntry(guild.id, articleName, wikiLink, interaction.user.id);
      setTicketLearningWikiArticle(guild.id, learningId, wiki.article_name);
      return { success: true, message: `Created wiki article **${wiki.article_name}**`, wiki };
    } catch (e) {
      return { error: `Could not create wiki: ${e.message}` };
    }
  }

  return { error: "Invalid action" };
}

function generateArticleName(entry) {
  const base = entry.question.slice(0, 60).replace(/[^\w\s-]/g, "").trim();
  const suffix = entry.panel ? ` (${entry.panel})` : "";
  let name = (base + suffix).slice(0, 100);
  // Ensure uniqueness
  let attempt = 1;
  while (store.getWikiByName(entry.guild_id, name)) {
    name = `${base} ${attempt++}${suffix}`.slice(0, 100);
  }
  return name;
}

/**
 * Build an embed showing pending learning entries for staff to review.
 */
function buildLearningReviewEmbed(guildId) {
  const pending = listTicketLearning(guildId, "pending");
  if (!pending.length) return embed("Auto-learned knowledge", "No pending entries to review.");

  const lines = pending.map((e, i) => {
    const q = e.question.length > 80 ? e.question.slice(0, 80) + "…" : e.question;
    const a = e.answer.length > 80 ? e.answer.slice(0, 80) + "…" : e.answer;
    const kw = e.keywords.length ? ` • ${e.keywords.join(", ")}` : "";
    return `${i + 1}. **${e.panel || "general"}** • <t:${Math.floor(e.created_at / 1000)}:R>\n   Q: ${q}\n   A: ${a}${kw}`;
  });

  return embed(
    `Auto-learned knowledge (${pending.length} pending)`,
    lines.join("\n\n"),
  ).setFooter({ text: "Use /learn review <id> approve|reject to curate" });
}

/**
 * Configuration: guilds can toggle auto-learning on/off.
 */
function isLearningEnabled(guildId) {
  const s = store.settings(guildId);
  return s?.ticket_learning_enabled !== false; // default on
}

function setLearningEnabled(guildId, enabled) {
  store.updateSettings(guildId, { ticket_learning_enabled: enabled });
}

// ---------------- Transcript import ----------------

function parseBotTranscriptHtml(html) {
  const metaMatch = html.match(/<div class="meta">(.*?)<\/div>/s);
  if (!metaMatch) return null;

  const meta = metaMatch[1];
  const panelMatch = meta.match(/Panel:\s*([^·<]+)/);
  const ownerMatch = meta.match(/Owner:\s*<span class="author">([^<]+)<\/span>/);
  const panel = panelMatch ? panelMatch[1].trim() : "unknown";
  const owner = ownerMatch ? ownerMatch[1].trim() : "";

  const messages = [];
  const parts = html.split(/<div class="msg/);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const endMatch = part.match(/<div class="msg|<\/body>/);
    const msgHtml = endMatch ? part.slice(0, endMatch.index) : part;

    const authorMatch = msgHtml.match(/<span class="author">([^<]+)<\/span>/);
    if (!authorMatch) continue;

    const author = authorMatch[1].trim();
    const contentMatch = msgHtml.match(/<div class="text">(.*?)<\/div>/s);
    let content = contentMatch ? contentMatch[1].trim() : "";

    content = unescapeHtml(content);
    if (content === "<em>(no content)</em>") content = "";
    if (content.startsWith("<em>[embed]")) continue;

    messages.push({ author, content });
  }

  return { panel, owner, messages };
}

function parseTicketToolTranscriptHtml(html) {
  const messagesMatch = html.match(/let\s+messages\s*=\s*"([^"]+)"/);
  if (!messagesMatch) return null;

  let messages = [];
  try {
    const decoded = Buffer.from(messagesMatch[1], "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return null;
    messages = parsed
      .map((m) => ({
        author: m.author?.tag || m.author?.username || m.author?.id || "Unknown",
        content: m.content || "",
      }))
      .filter((m) => m.author !== "Unknown" || m.content);
  } catch {
    return null;
  }

  if (messages.length === 0) return null;

  let panel = "unknown";
  const knownPanels = ["java", "bedrock", "bug", "report", "partnership", "br"];

  // Try to extract panel from <Server-Info> content
  const serverMatch = html.match(/<Server-Info[^>]*>([\s\S]*?)<\/Server-Info>/i);
  if (serverMatch) {
    const serverText = serverMatch[1].toLowerCase();
    for (const p of knownPanels) {
      if (serverText.includes(p)) {
        panel = p;
        break;
      }
    }
    if (panel === "unknown") {
      const channelMatch = serverText.match(/closed-([a-z]+)/i);
      if (channelMatch) panel = channelMatch[1].toLowerCase();
    }
  }

  // Fallback: extract from filename in HTML
  if (panel === "unknown") {
    const fileMatch = html.match(/transcript-([a-z]+)-/i);
    if (fileMatch) panel = fileMatch[1].toLowerCase();
  }

  // Fallback: extract from title
  if (panel === "unknown") {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      const title = titleMatch[1].toLowerCase();
      for (const p of knownPanels) {
        if (title.includes(p)) {
          panel = p;
          break;
        }
      }
    }
  }

  let owner = "";
  // Try <User-Info> section
  const userMatch = html.match(/<User-Info[^>]*>([\s\S]*?)<\/User-Info>/i);
  if (userMatch) {
    const userText = userMatch[1];
    // Look for Discord tag pattern: Username#1234
    const tagMatch = userText.match(/([^\s<]+#\d{4})/);
    if (tagMatch) owner = tagMatch[1].trim();
  }

  // Fallback: use first message author as owner
  if (!owner && messages.length > 0) {
    owner = messages[0].author;
  }

  return { panel, owner, messages };
}

function parseTranscriptHtml(html) {
  const ttResult = parseTicketToolTranscriptHtml(html);
  if (ttResult) return ttResult;
  return parseBotTranscriptHtml(html);
}

function extractKnowledgeFromTranscript(transcript) {
  const { panel, owner, messages } = transcript;
  if (messages.length < 3) return [];

  const ownerAuthor = owner || messages[0].author;
  const userMessages = messages.filter((m) => m.author === ownerAuthor);
  const staffMessages = messages.filter((m) => m.author !== ownerAuthor);

  if (userMessages.length === 0 || staffMessages.length === 0) return [];

  const question = userMessages[0].content?.slice(0, 500) || "";
  if (!question.trim()) return [];

  let bestAnswer = "";
  let bestScore = 0;
  for (const msg of staffMessages) {
    const content = msg.content || "";
    if (content.length < 20) continue;
    let score = 0;
    for (const kw of SOLUTION_INDICATORS) {
      if (content.toLowerCase().includes(kw)) score++;
    }
    if (content.includes("```") || content.includes("http")) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestAnswer = content.slice(0, 1000);
    }
  }

  if (!bestAnswer || bestScore === 0) return [];

  const allText = (question + " " + bestAnswer).toLowerCase();
  const keywords = SOLUTION_INDICATORS.filter((kw) => allText.includes(kw)).slice(0, 10);

  return [{ question, answer: bestAnswer, keywords, panel }];
}

function saveTranscriptLearning(guild, channelId, panel, question, answer, keywords) {
  try {
    return store.addTicketLearning(guild.id, 0, channelId, panel, question, answer, keywords);
  } catch (e) {
    if (!e.message.includes("FOREIGN KEY") && !e.message.includes("foreign-key")) throw e;

    store.ensureGuild(guild.id);
    store.db.prepare(
      "INSERT OR IGNORE INTO tickets(guild_id, channel_id, panel, ticket_user_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(guild.id, channelId, panel, null, "CLOSED", Date.now());

    const ticketRow = store.db.prepare("SELECT id FROM tickets WHERE guild_id=? AND channel_id=?").get(guild.id, channelId);
    if (!ticketRow) return null;

    return store.addTicketLearning(guild.id, ticketRow.id, channelId, panel, question, answer, keywords);
  }
}

async function learnFromTranscriptChannel(guild, channel, limit = 50) {
  const results = { processed: 0, learned: 0, errors: [] };
  let fetched = 0;
  let lastId;

  for (let round = 0; round < 50 && fetched < limit; round++) {
    try {
      const batch = await channel.messages.fetch({
        limit: 100,
        before: lastId,
        cache: false,
      });
      if (!batch.size) break;

      for (const [_, msg] of batch) {
        if (fetched >= limit) break;
        const htmlAttachment = msg.attachments.find((a) => a.name?.endsWith(".html"));
        if (!htmlAttachment) continue;

        try {
          fetched++;
          const res = await fetch(htmlAttachment.url);
          if (!res.ok) {
            results.errors.push(`Could not download ${htmlAttachment.name}: HTTP ${res.status}`);
            continue;
          }
          const html = await res.text();
          const transcript = parseTranscriptHtml(html);
          if (!transcript) {
            results.errors.push(`Could not parse ${htmlAttachment.name}`);
            continue;
          }
          results.processed++;
          const knowledge = extractKnowledgeFromTranscript(transcript);
          for (const k of knowledge) {
            const id = saveTranscriptLearning(guild, msg.channel.id, k.panel, k.question, k.answer, k.keywords);
            if (id) results.learned++;
          }
        } catch (e) {
          results.errors.push(`Error processing ${htmlAttachment.name}: ${e.message}`);
        }
      }
      lastId = batch.last().id;
      if (batch.size < 100) break;
    } catch (e) {
      results.errors.push(`Error fetching messages: ${e.message}`);
      break;
    }
  }

  return results;
}

module.exports = {
  learnFromClosedTicket,
  reviewTicketLearning,
  buildLearningReviewEmbed,
  isLearningEnabled,
  setLearningEnabled,
  generateArticleName,
  slugify,
  mapPanelToPlatform,
  parseTranscriptHtml,
  extractKnowledgeFromTranscript,
  learnFromTranscriptChannel,
};