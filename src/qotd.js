const fs = require("node:fs");
const path = require("node:path");
const {
  EmbedBuilder,
  ChannelType,
} = require("discord.js");
const store = require("./database");

const CSV_PATH = path.resolve(__dirname, "../qotd_bank(1).csv");
const COLOR = 0xe91e63;
const DAYS_IN_BANK = 365;
const CHECK_INTERVAL_MS = 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1000;
const POST_DELAY_MS = 5 * 1000;
const LOCK_AFTER_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_AFTER_MS = 48 * 60 * 60 * 1000;

let QOTD_BANK = [];
let schedulerStarted = false;

function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  let cur = "";
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  fields.push(cur);
  return fields;
}

function loadQotdBank(filePath = CSV_PATH) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const bank = [];
  let first = true;
  for (const line of lines) {
    if (first) {
      first = false;
      continue;
    }
    const fields = parseCsvLine(line);
    const day = Number(fields[0]);
    const question = (fields[1] || "").trim();
    if (Number.isFinite(day) && question) {
      bank[day - 1] = question;
    }
  }
  return bank;
}

try {
  QOTD_BANK = loadQotdBank();
} catch (error) {
  console.error("[qotd] failed to load question bank:", error.message);
}

function qotdQuestionCount() {
  return QOTD_BANK.length;
}

function qotdQuestionForDay(day) {
  const index = ((day - 1) % QOTD_BANK.length + QOTD_BANK.length) % QOTD_BANK.length;
  return QOTD_BANK[index] || null;
}

function utcTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatDisplayDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

async function apiWithBackoff(fn, { maxRetries = 6 } = {}) {
  let delay = 1000;
  let last;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const status = e.httpStatus ?? e.status ?? e.code;
      const headers = e.headers || {};
      const retryAfter =
        e.retryAfter ?? headers["retry-after"] ?? headers["Retry-After"];
      const isRateLimit = status === 429 || e.code === 429;
      const isServerError = Number.isFinite(status) && status >= 500 && status < 600;
      if ((isRateLimit || isServerError) && attempt < maxRetries) {
        const wait = Math.min(Number(retryAfter) || delay, 30000);
        await new Promise((r) => setTimeout(r, wait));
        delay = Math.min(delay * 2, 30000);
        continue;
      }
      throw e;
    }
  }
  throw last;
}

async function postQotd(client, guild) {
  const s = store.settings(guild.id);
  const channelId = s && s.qotd_channel_id ? s.qotd_channel_id : null;
  if (!channelId) return null;

  const state = store.getQotdState(guild.id) || { current_index: 0 };
  const day = (state.current_index % QOTD_BANK.length) + 1 || 1;
  const question = qotdQuestionForDay(day);
  if (!question) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;

  const today = utcTodayKey();
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Question of the Day")
    .setDescription(question)
    .addFields(
      { name: "Ziua", value: String(day), inline: true },
      { name: "Dată", value: today, inline: true },
    )
    .setFooter({ text: "Mihulish QOTD · postat la 00:00 GMT+0" })
    .setTimestamp();

  const message = await apiWithBackoff(() =>
    channel.send({ embeds: [embed] }),
  );

  const thread = await apiWithBackoff(() =>
    channel.threads.create({
      name: `💬 QOTD - ${formatDisplayDate()}`,
      type: ChannelType.PublicThread,
      startMessageId: message.id,
      reason: "QOTD daily discussion thread",
    }),
  );

  store.addQotdThread(guild.id, message.id, thread.id, channel.id, Date.now());
  store.setQotdState(guild.id, day, today);

  try {
    await guild.channels.fetch().catch(() => {});
  } catch {}

  return { guildId: guild.id, messageId: message.id, threadId: thread.id, day, date: today };
}

async function maintainThreads(client) {
  const now = Date.now();

  for (const row of store.getQotdThreadsDueForLock(now)) {
    try {
      const thread = await client.guilds.cache
        .get(row.guild_id)
        ?.threads.fetch(row.thread_id)
        .catch(() => null);
      if (!thread) {
        store.markQotdThreadLocked(row.thread_id);
        store.markQotdThreadArchived(row.thread_id);
        continue;
      }
      await apiWithBackoff(() => thread.setLocked(true));
      await apiWithBackoff(() => thread.setArchived(true));
      store.markQotdThreadLocked(row.thread_id);
      store.markQotdThreadArchived(row.thread_id);
    } catch (error) {
      console.error(`[qotd] lock/archive failed for ${row.thread_id}:`, error.message);
    }
  }

  for (const row of store.getQotdThreadsDueForArchive(now)) {
    try {
      const thread = await client.guilds.cache
        .get(row.guild_id)
        ?.threads.fetch(row.thread_id)
        .catch(() => null);
      if (!thread) {
        store.markQotdThreadArchived(row.thread_id);
        continue;
      }
      await apiWithBackoff(() => thread.setArchived(true));
      store.markQotdThreadArchived(row.thread_id);
    } catch (error) {
      console.error(`[qotd] archive failed for ${row.thread_id}:`, error.message);
    }
  }
}

async function tick(client) {
  const today = utcTodayKey();
  for (const guild of client.guilds.cache.values()) {
    try {
      const s = store.settings(guild.id);
      if (!s?.qotd_channel_id) continue;
      const state = store.getQotdState(guild.id);
      if (!state || state.last_post_date !== today) {
        await postQotd(client, guild).catch((error) =>
          console.error(`[qotd] post failed for ${guild.id}:`, error.message),
        );
      }
    } catch (error) {
      console.error(`[qotd] tick error for ${guild.id}:`, error.message);
    }
  }
  try {
    await maintainThreads(client);
  } catch (error) {
    console.error("[qotd] maintenance error:", error.message);
  }
}

function startQotdScheduler(client) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setTimeout(() => tick(client), POST_DELAY_MS);
  setInterval(() => tick(client), CHECK_INTERVAL_MS);
  setInterval(
    () => maintainThreads(client).catch((e) => console.error("[qotd] maintenance interval:", e.message)),
    MAINTENANCE_INTERVAL_MS,
  );
}

module.exports = {
  QOTD_BANK,
  qotdQuestionCount,
  qotdQuestionForDay,
  loadQotdBank,
  postQotd,
  maintainThreads,
  startQotdScheduler,
};
