const path = require('node:path');
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { loadData, saveData: saveDataToDb } = require('./database');

const MAX_POINTS = 100;
const RANKS = ['Celestial', 'Immortal', 'Emperor', 'Shogun', 'Samurai', 'Sensei', 'Elder', 'Ronin', 'Shinobi', 'Guardian', 'Warrior', 'Ranger', 'Nomad', 'Wanderer'];
const staffRoleIds = new Set((process.env.STAFF_ROLE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));

// ─── Shared embed styling (used by every embed in the bot) ─────────────────
const EMBED_COLOR = 0xe91e63;
const EMBED_URL = 'attachment://logo.png';
const LOGO_PATH = path.join(__dirname, 'logo.png');
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

function makeEmbed() {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setFooter({ text: 'Made by @ro_mihaiu', iconURL: EMBED_URL });
}

function logoFile() {
  return [{ attachment: LOGO_PATH, name: 'logo.png' }];
}

// Send a styled event embed (member join/leave/ban/mute/etc.) to the log channel.
async function logEvent(client, { title, description, user = null }) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) return;
    const embed = makeEmbed()
      .setTitle(title)
      .setDescription(description)
      .setThumbnail(user?.displayAvatarURL?.() ?? null)
      .setTimestamp();
    await channel.send({ embeds: [embed], files: logoFile() });
  } catch (error) {
    console.error('Failed to log event:', error);
  }
}

// Load bot records from the SQLite database (see database.js).
function readData() {
  return loadData();
}

const data = readData();
data.users ||= {};
data.warnings ||= [];
data.wallOfFame ||= [];
data.nextWarningId ||= 1;
data.items ||= {};
data.subscriptions ||= {};
data.sessions ||= {};
data.coins ||= {};
data.giveaways ||= [];
data.customCommands ||= {};
data.claims ||= {};

// Persist the in-memory data to SQLite (atomic, inside a single transaction).
function saveData() {
  saveDataToDb(data);
}

function userRecord(userId) {
  return (data.users[userId] ||= { points: 0, rank: null, inGameUser: null, trustedLocations: [] });
}

function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild)
    || member.roles.cache.some((role) => staffRoleIds.has(role.id));
}

async function requireStaff(interaction) {
  if (isStaff(interaction.member)) return true;
  await interaction.reply({ content: 'This command is for staff only.', ephemeral: true });
  return false;
}

async function safeDm(user, embed) {
  try { await user.send({ embeds: [embed], files: logoFile() }); } catch (error) { console.error('Failed to send DM:', error); }
}

async function setRankRole(member, rank) {
  const role = member.guild.roles.cache.find((candidate) => candidate.name.toLowerCase() === rank.toLowerCase());
  if (!role) return false;
  const oldRankRoles = member.roles.cache.filter((candidate) => candidate.id !== role.id && RANKS.some((name) => name.toLowerCase() === candidate.name.toLowerCase()));
  if (oldRankRoles.size) await member.roles.remove(oldRankRoles, 'MIHU bot rank update');
  await member.roles.add(role, 'MIHU bot rank update');
  return true;
}

module.exports = { data, saveData, userRecord, isStaff, requireStaff, safeDm, setRankRole, MAX_POINTS, RANKS, readData, makeEmbed, logoFile, logEvent, EMBED_COLOR, EMBED_URL };

