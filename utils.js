const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const DATA_PATH = path.join(__dirname, 'data', 'bot-data.json');
const MAX_POINTS = 100;
const RANKS = ['Celestial', 'Immortal', 'Emperor', 'Shogun', 'Samurai', 'Sensei', 'Elder', 'Ronin', 'Shinobi', 'Guardian', 'Warrior', 'Ranger', 'Nomad', 'Wanderer'];
const staffRoleIds = new Set((process.env.STAFF_ROLE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { users: {}, warnings: [], nextWarningId: 1, wallOfFame: [], items: {}, subscriptions: {}, sessions: {}, coins: {}, giveaways: [], customCommands: {} };
    }
    console.error('Could not read bot data:', error);
    return { users: {}, warnings: [], nextWarningId: 1, wallOfFame: [], items: {}, subscriptions: {}, sessions: {}, coins: {}, giveaways: [], customCommands: {} };
  }
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

function saveData() {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function userRecord(userId) {
  return (data.users[userId] ||= { points: 0, rank: null, trustedLocations: [] });
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
  try { await user.send({ embeds: [embed] }); } catch (error) { console.error('Failed to send DM:', error); }
}

async function setRankRole(member, rank) {
  const role = member.guild.roles.cache.find((candidate) => candidate.name.toLowerCase() === rank.toLowerCase());
  if (!role) return false;
  const oldRankRoles = member.roles.cache.filter((candidate) => candidate.id !== role.id && RANKS.some((name) => name.toLowerCase() === candidate.name.toLowerCase()));
  if (oldRankRoles.size) await member.roles.remove(oldRankRoles, 'MIHU bot rank update');
  await member.roles.add(role, 'MIHU bot rank update');
  return true;
}

module.exports = { data, saveData, userRecord, isStaff, requireStaff, safeDm, setRankRole, MAX_POINTS, RANKS, readData };

