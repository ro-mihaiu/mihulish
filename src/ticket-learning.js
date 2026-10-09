// Ticket Learning Module — extracts useful Q&A from closed tickets
// and creates wiki entries for helpers to reference later.
const { EmbedBuilder } = require("discord.js");
const store = require("./database");
const { extractTicketKnowledge, addTicketLearning, listTicketLearning, getTicketLearning, updateTicketLearningStatus, setTicketLearningWikiArticle, deleteTicketLearning, isStaff } = require("./database");

function embed(title, description, color = 0xe91e63) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
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
    try {
      const wiki = store.addWikiEntry(guild.id, articleName, `Learned from ticket #${entry.ticket_id} (${entry.panel})`, interaction.user.id);
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

module.exports = {
  learnFromClosedTicket,
  reviewTicketLearning,
  buildLearningReviewEmbed,
  isLearningEnabled,
  setLearningEnabled,
  generateArticleName,
};