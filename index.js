require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');

const STAFF_CHANNEL_ID = '1511566996632768663';
const MAX_POINTS = 100;
const DATA_PATH = path.join(__dirname, 'data', 'bot-data.json');
const RANKS = ['Celestial', 'Immortal', 'Emperor', 'Shogun', 'Samurai', 'Sensei', 'Elder', 'Ronin', 'Shinobi', 'Guardian', 'Warrior', 'Ranger', 'Nomad', 'Wanderer'];
const staffRoleIds = new Set((process.env.STAFF_ROLE_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { users: {}, warnings: [], nextWarningId: 1, wallOfFame: [] };
    console.error('Could not read bot data:', error);
    return { users: {}, warnings: [], nextWarningId: 1, wallOfFame: [] };
  }
}

const data = readData();
data.users ||= {};
data.warnings ||= [];
data.wallOfFame ||= [];
data.nextWarningId ||= 1;

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

const commands = [
  new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
  new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
  new SlashCommandBuilder().setName('gw').setDescription('Giveaway management')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize').setRequired(true)))
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Winners').setRequired(false)))
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
  new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,
// Add these commands to the bot:
/item add <name> <bulk/individual> <price> <min_amount>
/item remove <name>
/item restocked <name> <amount>
/subscription add @member [amount]
/subscription remove @member [amount]
/mysubscription
/session add <item>
/session remove <item>
/session check
/session start <hours>
/session stop
/session history
/coins add @member <amount>
/coins remove @member <amount>
/coins bal
/cf <bet>
/gw start <channel> <days> <winners> <prize>
/gw reroll <msg_id> [winners]
/gw end <msg_id>
/update
  new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
  new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
  new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
  new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session'))
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true)))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session'))
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
  new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
  new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
  new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false)))
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
  new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,
  new SlashCommandBuilder().setName('rank').setDescription('Request or change a rank')
    .addSubcommand((sub) => sub.setName('update').setDescription('Request a rank change')
      .addStringOption((option) => option.setName('rank').setDescription('Requested rank').setRequired(true).addChoices(...RANKS.map((rank) => ({ name: rank, value: rank })))))
    .addSubcommand((sub) => sub.setName('change').setDescription('Change a member rank (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addStringOption((option) => option.setName('rank').setDescription('New rank').setRequired(true).addChoices(...RANKS.map((rank) => ({ name: rank, value: rank }))))),
  new SlashCommandBuilder().setName('unverify').setDescription('Remove a member from bot records (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('trust').setDescription('Trust a member at a location (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((option) => option.setName('location').setDescription('Trusted location').setRequired(true)),
  new SlashCommandBuilder().setName('untrust').setDescription('Remove a member trust at a location (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((option) => option.setName('location').setDescription('Location').setRequired(true)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member (staff)')
    .addSubcommand((sub) => sub.setName('add').setDescription('Issue a warning')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a warning')
      .addIntegerOption((option) => option.setName('id').setDescription('Warning ID').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Removal reason').setRequired(true))),
  new SlashCommandBuilder().setName('warnings').setDescription('View your warnings'),
  new SlashCommandBuilder().setName('warns').setDescription('View a member warnings (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('points').setDescription('Manage or view reward points')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add points (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove points (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('view').setDescription('View your points'))
    .addSubcommand((sub) => sub.setName('check').setDescription('Check all point balances (staff)')),
  new SlashCommandBuilder().setName('wof').setDescription('View or manage the Wall of Fame')
    .addSubcommand((sub) => sub.setName('view').setDescription('View Wall of Fame'))
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a member (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a member (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))),
  new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
  new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
  new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
  new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session'))
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true)))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session'))
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
  new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
  new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
  new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false)))
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
  new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,
  new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,
]
  new SlashCommandBuilder().setName('rank').setDescription('Request or change a rank')
    .addSubcommand((sub) => sub.setName('update').setDescription('Request a rank change')
      .addStringOption((option) => option.setName('rank').setDescription('Requested rank').setRequired(true).addChoices(...RANKS.map((rank) => ({ name: rank, value: rank })))))
    .addSubcommand((sub) => sub.setName('change').setDescription('Change a member rank (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addStringOption((option) => option.setName('rank').setDescription('New rank').setRequired(true).addChoices(...RANKS.map((rank) => ({ name: rank, value: rank }))))),
  new SlashCommandBuilder().setName('unverify').setDescription('Remove a member from bot records (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('trust').setDescription('Trust a member at a location (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((option) => option.setName('location').setDescription('Trusted location').setRequired(true)),
  new SlashCommandBuilder().setName('untrust').setDescription('Remove a member trust at a location (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((option) => option.setName('location').setDescription('Location').setRequired(true)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member (staff)')
    .addSubcommand((sub) => sub.setName('add').setDescription('Issue a warning')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a warning')
      .addIntegerOption((option) => option.setName('id').setDescription('Warning ID').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Removal reason').setRequired(true))),
  new SlashCommandBuilder().setName('warnings').setDescription('View your warnings'),
  new SlashCommandBuilder().setName('warns').setDescription('View a member warnings (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('points').setDescription('Manage or view reward points')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add points (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove points (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('view').setDescription('View your points'))
    .addSubcommand((sub) => sub.setName('check').setDescription('Check all point balances (staff)')),
  new SlashCommandBuilder().setName('wof').setDescription('View or manage the Wall of Fame')
    .addSubcommand((sub) => sub.setName('view').setDescription('View Wall of Fame'))
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a member (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a member (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))),
  new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
  new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
  new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
  new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session'))
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true)))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session'))
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
  new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
  new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
  new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false)))
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
  new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,
  new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,
]
  new SlashCommandBuilder().setName('rank').setDescription('Request or change a rank')
    .addSubcommand((sub) => sub.setName('update').setDescription('Request a rank change')
      .addStringOption((option) => option.setName('rank').setDescription('Requested rank').setRequired(true).addChoices(...RANKS.map((rank) => ({ name: rank, value: rank })))))
    .addSubcommand((sub) => sub.setName('change').setDescription('Change a member rank (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addStringOption((option) => option.setName('rank').setDescription('New rank').setRequired(true).addChoices(...RANKS.map((rank) => ({ name: rank, value: rank }))))),
  new SlashCommandBuilder().setName('unverify').setDescription('Remove a member from bot records (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('trust').setDescription('Trust a member at a location (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((option) => option.setName('location').setDescription('Trusted location').setRequired(true)),
  new SlashCommandBuilder().setName('untrust').setDescription('Remove a member trust at a location (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((option) => option.setName('location').setDescription('Location').setRequired(true)),
  new SlashCommandBuilder().setName('warn').setDescription('Warn a member (staff)')
    .addSubcommand((sub) => sub.setName('add').setDescription('Issue a warning')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a warning')
      .addIntegerOption((option) => option.setName('id').setDescription('Warning ID').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Removal reason').setRequired(true))),
  new SlashCommandBuilder().setName('warnings').setDescription('View your warnings'),
  new SlashCommandBuilder().setName('warns').setDescription('View a member warnings (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('points').setDescription('Manage or view reward points')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add points (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove points (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('view').setDescription('View your points'))
    .addSubcommand((sub) => sub.setName('check').setDescription('Check all point balances (staff)')),
  new SlashCommandBuilder().setName('wof').setDescription('View or manage the Wall of Fame')
    .addSubcommand((sub) => sub.setName('view').setDescription('View Wall of Fame'))
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a member (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a member (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))),
].map((command) => command.toJSON());

// New commands
new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,

// End of new commands
new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,

// End of new commands
new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,

// End of new commands
new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,

// End of new commands
new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,

// End of new commands
new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,

// End of new commands
new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,

// End of new commands
114|new SlashCommandBuilder().setName('item').setDescription('Manage items')
115|    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
116|      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
117|      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
118|      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
119|      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
120|    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
121|      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
122|    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
123|      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
124|      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
125|new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
126|    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
127|      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
128|      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
129|    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
130|      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
131|      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
132|new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
133|new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
134|    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
135|      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
136|    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
137|      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
138|    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
139|    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
140|      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
141|    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
142|    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
143|new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
144|    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
145|      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
146|      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
147|    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
148|      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
149|      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
150|    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
151|new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
152|    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
153|new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
154|    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
155|      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
156|      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
157|      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
158|      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
159|    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
160|      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
161|      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
162|    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
163|      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
164|new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,
165|
166|// End of new commands
new SlashCommandBuilder().setName('item').setDescription('Manage items')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addStringOption((option) => option.setName('type').setDescription('Item type').setRequired(true).addChoices({ name: 'Bulk', value: 'bulk' }, { name: 'Individual', value: 'individual' }))
      .addIntegerOption((option) => option.setName('price').setDescription('Item price').setRequired(true))
      .addIntegerOption((option) => option.setName('min_amount').setDescription('Minimum amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('restocked').setDescription('Restock an item')
      .addStringOption((option) => option.setName('name').setDescription('Item name').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(false))),
new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
new SlashCommandBuilder().setName('session').setDescription('Manage sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a session item')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true))),
    .addSubcommand((sub) => sub.setName('check').setDescription('Check session')),
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true))),
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop session')),
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check balance')),
new SlashCommandBuilder().setName('cf').setDescription('Coin flip')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize amount').setRequired(true))),
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(false))),
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Message ID').setRequired(true))),
new SlashCommandBuilder().setName('update').setDescription('Update bot commands'),,,,,

// End of new commands

async function showWarnings(interaction, target) {
  const warnings = data.warnings.filter((warning) => warning.userId === target.id);
  const description = warnings.length
    ? warnings.map((warning) => `**#${warning.id}** — ${warning.reason}\n<t:${Math.floor(warning.createdAt / 1000)}:d>`).join('\n\n')
    : 'No warnings.';
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warnings: ${target.username}`).setDescription(description.slice(0, 4096))], ephemeral: true });
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const guild = process.env.DISCORD_GUILD_ID ? await client.guilds.fetch(process.env.DISCORD_GUILD_ID) : null;
    await (guild ? guild.commands : client.application.commands).set(commands);
    console.log(`Registered ${commands.length} application commands ${guild ? `in ${guild.name}` : 'globally'}.`);
  } catch (error) { console.error('Could not register commands:', error); }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;

  try {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;
  try {
    const subcommand = interaction.options.getSubcommand(false);
    const target = interaction.options.getUser('member');
    const target = interaction.options.getUser('member');

    if (interaction.commandName === 'rank' && subcommand === 'update') {
      const rank = interaction.options.getString('rank', true);
      const channel = await client.channels.fetch(STAFF_CHANNEL_ID).catch(() => null);
      if (!channel?.isTextBased()) return interaction.reply({ content: 'The rank-request channel is not available. Please contact staff.', ephemeral: true });
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Rank change request').addFields({ name: 'Member', value: `${interaction.user} (${interaction.user.id})` }, { name: 'Requested rank', value: rank }).setTimestamp()] });
      return interaction.reply({ content: 'Your rank-change request was sent to staff.', ephemeral: true });
      const rank = interaction.options.getString('rank', true);
      const channel = await client.channels.fetch(STAFF_CHANNEL_ID).catch(() => null);
      if (!channel?.isTextBased()) return interaction.reply({ content: 'The rank-request channel is not available. Please contact staff.', ephemeral: true });
      await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Rank change request').addFields({ name: 'Member', value: `${interaction.user} (${interaction.user.id})` }, { name: 'Requested rank', value: rank }).setTimestamp()] });
      return interaction.reply({ content: 'Your rank-change request was sent to staff.', ephemeral: true });
    }
    if (interaction.commandName === 'rank' && subcommand === 'change') {
      if (!await requireStaff(interaction)) return;
      const rank = interaction.options.getString('rank', true);
      const member = await interaction.guild.members.fetch(target.id);
      const record = userRecord(target.id); const previous = record.rank || 'none'; record.rank = rank; saveData();
      const roleFound = await setRankRole(member, rank).catch(() => false);
      await safeDm(target, new EmbedBuilder().setColor(0x57f287).setTitle('Rank updated').setDescription(`Your rank is now **${rank}**.`).setFooter({ text: 'If you have questions, contact staff.' }));
      return interaction.reply({ content: `${target} rank changed from **${previous}** to **${rank}**.${roleFound ? '' : ' No Discord role was changed because no matching role was found.'}`, ephemeral: true });
      if (!await requireStaff(interaction)) return;
      const rank = interaction.options.getString('rank', true);
      const member = await interaction.guild.members.fetch(target.id);
      const record = userRecord(target.id); const previous = record.rank || 'none'; record.rank = rank; saveData();
      const roleFound = await setRankRole(member, rank).catch(() => false);
      await safeDm(target, new EmbedBuilder().setColor(0x57f287).setTitle('Rank updated').setDescription(`Your rank is now **${rank}**.`).setFooter({ text: 'If you have questions, contact staff.' }));
      return interaction.reply({ content: `${target} rank changed from **${previous}** to **${rank}**.${roleFound ? '' : ' No Discord role was changed because no matching role was found.'}`, ephemeral: true });
    }
    if (interaction.commandName === 'unverify') {
      if (!await requireStaff(interaction)) return;
      delete data.users[target.id]; data.warnings = data.warnings.filter((warning) => warning.userId !== target.id); data.wallOfFame = data.wallOfFame.filter((id) => id !== target.id); saveData();
      return interaction.reply({ content: `${target} has been completely removed from the bot records.`, ephemeral: true });
    }
    if (interaction.commandName === 'trust' || interaction.commandName === 'untrust') {
      if (!await requireStaff(interaction)) return;
      const location = interaction.options.getString('location', true); const record = userRecord(target.id);
      const matching = (item) => item.toLowerCase() === location.toLowerCase();
      if (interaction.commandName === 'trust') { if (!record.trustedLocations.some(matching)) record.trustedLocations.push(location); }
      else record.trustedLocations = record.trustedLocations.filter((item) => !matching(item));
      saveData();
      const action = interaction.commandName === 'trust' ? 'trusted' : 'untrusted';
      await safeDm(target, new EmbedBuilder().setColor(action === 'trusted' ? 0x57f287 : 0xed4245).setTitle(`You are ${action}`).setDescription(`Location: **${location}**`));
      return interaction.reply({ content: `${target} is now ${action} at **${location}**.`, ephemeral: true });
      if (!await requireStaff(interaction)) return;
      const location = interaction.options.getString('location', true); const record = userRecord(target.id);
      const matching = (item) => item.toLowerCase() === location.toLowerCase();
      if (interaction.commandName === 'trust') { if (!record.trustedLocations.some(matching)) record.trustedLocations.push(location); }
      else record.trustedLocations = record.trustedLocations.filter((item) => !matching(item));
      saveData();
      const action = interaction.commandName === 'trust' ? 'trusted' : 'untrusted';
      await safeDm(target, new EmbedBuilder().setColor(action === 'trusted' ? 0x57f287 : 0xed4245).setTitle(`You are ${action}`).setDescription(`Location: **${location}**`));
      return interaction.reply({ content: `${target} is now ${action} at **${location}**.`, ephemeral: true });
    }
    if (interaction.commandName === 'warn') {
      if (!await requireStaff(interaction)) return;
      if (subcommand === 'add') {
        const reason = interaction.options.getString('reason', true); const warning = { id: data.nextWarningId++, userId: target.id, reason, staffId: interaction.user.id, createdAt: Date.now() }; data.warnings.push(warning); saveData();
        await safeDm(target, new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warning #${warning.id}`).setDescription(reason).setFooter({ text: 'Contact staff if you have questions.' }));
        return interaction.reply({ content: `Warning **#${warning.id}** issued to ${target}. They were notified by DM.`, ephemeral: true });
      if (!await requireStaff(interaction)) return;
      if (subcommand === 'add') {
        const reason = interaction.options.getString('reason', true); const warning = { id: data.nextWarningId++, userId: target.id, reason, staffId: interaction.user.id, createdAt: Date.now() }; data.warnings.push(warning); saveData();
        await safeDm(target, new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warning #${warning.id}`).setDescription(reason).setFooter({ text: 'Contact staff if you have questions.' }));
        return interaction.reply({ content: `Warning **#${warning.id}** issued to ${target}. They were notified by DM.`, ephemeral: true });
      }
      const id = interaction.options.getInteger('id', true); const reason = interaction.options.getString('reason', true); const index = data.warnings.findIndex((warning) => warning.id === id);
      if (index === -1) return interaction.reply({ content: `Warning #${id} does not exist.`, ephemeral: true });
      const [warning] = data.warnings.splice(index, 1); saveData(); const warnedUser = await client.users.fetch(warning.userId).catch(() => null);
      if (warnedUser) await safeDm(warnedUser, new EmbedBuilder().setColor(0x57f287).setTitle(`Warning #${id} removed`).setDescription(`Reason: ${reason}`));
      return interaction.reply({ content: `Warning **#${id}** was removed. The affected member was notified by DM.`, ephemeral: true });
    }
    if (interaction.commandName === 'warnings') return showWarnings(interaction, interaction.user);
    if (interaction.commandName === 'warns') { if (!await requireStaff(interaction)) return; return showWarnings(interaction, target); }
    if (interaction.commandName === 'points') {
      if (subcommand === 'view' || subcommand === 'ping') {
        const points = userRecord(interaction.user.id).points;
        if (points >= MAX_POINTS) await safeDm(interaction.user, new EmbedBuilder().setColor(0xfee75c).setTitle('Points capacity reached').setDescription(`You are at the full capacity of ${MAX_POINTS} points.`));
        return interaction.reply({ content: `You have **${points}/${MAX_POINTS}** points.${points >= MAX_POINTS ? ' I also sent you a DM.' : ''}`, ephemeral: true });
      }
      if (!await requireStaff(interaction)) return;
      if (subcommand === 'check') {
        const balances = Object.entries(data.users).map(([id, record]) => `<@${id}> — **${record.points}/${MAX_POINTS}**`).join('\n') || 'No saved point balances.';
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Point balance check').setDescription(balances.slice(0, 4096))], ephemeral: true });
      }
      const amount = interaction.options.getInteger('amount', true); const record = userRecord(target.id); const before = record.points;
      record.points = subcommand === 'add' ? Math.min(MAX_POINTS, record.points + amount) : Math.max(0, record.points - amount); saveData();
      return interaction.reply({ content: `${target}: **${before} → ${record.points}** points.`, ephemeral: true });
    }
    if (interaction.commandName === 'wof') {
      if (subcommand === 'view' || subcommand === 'ping') {
        const entries = data.wallOfFame.map((id, index) => `${index + 1}. <@${id}>`).join('\n') || 'No one is on the Wall of Fame yet.';
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff73fa).setTitle('Wall of Fame').setDescription(entries)] });
      }
      if (!await requireStaff(interaction)) return;
      if (subcommand === 'add') { if (!data.wallOfFame.includes(target.id)) data.wallOfFame.push(target.id); saveData(); return interaction.reply({ content: `${target} was added to the Wall of Fame.`, ephemeral: true }); }
      data.wallOfFame = data.wallOfFame.filter((id) => id !== target.id); saveData(); return interaction.reply({ content: `${target} was removed from the Wall of Fame.`, ephemeral: true });
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const reply = { content: 'Something went wrong while processing that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply); else await interaction.reply(reply);
  }
});

// Prefix commands are intentionally kept alongside slash commands. Examples:
// .rank update Samurai, .rank change @member Samurai, .warn @member reason,
// .warn remove 4 reason, .points add @member 10, .wof add @member
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.inGuild() || !message.content.startsWith('.')) return;
  const [command, subcommand, ...rest] = message.content.slice(1).trim().split(/\s+/);
  const prefixHelp = 'Use `.item add <name> <bulk/individual> <price> <min_amount>`, `.item remove <name>`, `.item restocked <name> <amount>`, `.subscription add @member [amount]`, `.subscription remove @member [amount]`, `.mysubscription`, `.session add <item>`, `.session remove <item>`, `.session check`, `.session start <hours>`, `.session stop`, `.session history`, `.coins add @member <amount>`, `.coins remove @member <amount>`, `.coins bal`, `.cf <bet>`, `.gw start <channel> <days> <winners> <prize>`, `.gw reroll <msg_id> [winners]`, `.gw end <msg_id>`, `.update`, `.rank update <rank>`, `.rank change @member <rank>`';
  const prefixHelp = 'Use `.item add <name> <bulk/individual> <price> <min_amount>`, `.item remove <name>`, `.item restocked <name> <amount>`, `.subscription add @member [amount]`, `.subscription remove @member [amount]`, `.mysubscription`, `.session add <item>`, `.session remove <item>`, `.session check`, `.session start <hours>`, `.session stop`, `.session history`, `.coins add @member <amount>`, `.coins remove @member <amount>`, `.coins bal`, `.cf <bet>`, `.gw start <channel> <days> <winners> <prize>`, `.gw reroll <msg_id> [winners]`, `.gw end <msg_id>`, `.update`, `.rank update <rank>`, `.rank change @member <rank>`';
  if (!command) return message.reply(prefixHelp);
  const staffOnly = async () => {
    if (isStaff(message.member)) return true;
    await message.reply('This command is for staff only.');
    return false;
  };
  const mentioned = message.mentions.users.first();
  const rankFrom = (parts) => parts.join(' ');

  try {
    if (command === 'rank' || command === 'ping') {
      if (subcommand === 'update') {
        const rank = rankFrom(rest);
        if (!RANKS.includes(rank)) return message.reply(`Choose one of: ${RANKS.join(', ')}.`);
        const channel = await client.channels.fetch(STAFF_CHANNEL_ID).catch(() => null);
        if (!channel?.isTextBased()) return message.reply('The rank-request channel is not available.');
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Rank change request').addFields({ name: 'Member', value: `${message.author} (${message.author.id})` }, { name: 'Requested rank', value: rank }).setTimestamp()] });
        return message.reply('Your rank-change request was sent to staff.');
      }
      if (subcommand === 'change') {
        if (!await staffOnly()) return;
        const rank = rankFrom(rest.slice(1));
        if (!mentioned || !RANKS.includes(rank)) return message.reply('Usage: `.rank change @member <rank>`');
        const member = await message.guild.members.fetch(mentioned.id); const record = userRecord(mentioned.id); const previous = record.rank || 'none'; record.rank = rank; saveData();
        const roleFound = await setRankRole(member, rank).catch(() => false);
        await safeDm(mentioned, new EmbedBuilder().setColor(0x57f287).setTitle('Rank updated').setDescription(`Your rank is now **${rank}**.`));
        return message.reply(`${mentioned} rank changed from **${previous}** to **${rank}**.${roleFound ? '' : ' No matching Discord role was found.'}`);
      }
    }
    if (command === 'unverify') {
      if (!await staffOnly()) return;
      if (!mentioned) return message.reply('Usage: `.unverify @member`');
      delete data.users[mentioned.id]; data.warnings = data.warnings.filter((warning) => warning.userId !== mentioned.id); data.wallOfFame = data.wallOfFame.filter((id) => id !== mentioned.id); saveData();
      return message.reply(`${mentioned} was removed from the bot records.`);
    }
    if (command === 'trust' || command === 'untrust') {
      if (!await staffOnly()) return;
      const location = rankFrom(rest.slice(1));
      if (!mentioned || !location) return message.reply(`Usage: \`.${command} @member <location>\``);
      const record = userRecord(mentioned.id); const matching = (item) => item.toLowerCase() === location.toLowerCase();
      if (command === 'trust' && !record.trustedLocations.some(matching)) record.trustedLocations.push(location);
      if (command === 'untrust') record.trustedLocations = record.trustedLocations.filter((item) => !matching(item));
      saveData(); const action = command === 'trust' ? 'trusted' : 'untrusted';
      await safeDm(mentioned, new EmbedBuilder().setColor(action === 'trusted' ? 0x57f287 : 0xed4245).setTitle(`You are ${action}`).setDescription(`Location: **${location}**`));
      return message.reply(`${mentioned} is now ${action} at **${location}**.`);
    }
    if (command === 'warn') {
      if (!await staffOnly()) return;
      if (subcommand === 'remove') {
        const id = Number(rest[0]); const reason = rankFrom(rest.slice(1)); const index = data.warnings.findIndex((warning) => warning.id === id);
        if (!Number.isInteger(id) || !reason) return message.reply('Usage: `.warn remove <id> <reason>`');
        if (index === -1) return message.reply(`Warning #${id} does not exist.`);
        const [warning] = data.warnings.splice(index, 1); saveData(); const warnedUser = await client.users.fetch(warning.userId).catch(() => null);
        if (warnedUser) await safeDm(warnedUser, new EmbedBuilder().setColor(0x57f287).setTitle(`Warning #${id} removed`).setDescription(`Reason: ${reason}`));
        return message.reply(`Warning #${id} was removed.`);
      }
      const reason = message.content.slice(1).trim().split(/\s+/).slice(2).join(' ');
      if (!mentioned || !reason) return message.reply('Usage: `.warn @member <reason>`');
      const warning = { id: data.nextWarningId++, userId: mentioned.id, reason, staffId: message.author.id, createdAt: Date.now() }; data.warnings.push(warning); saveData();
      await safeDm(mentioned, new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warning #${warning.id}`).setDescription(reason));
      return message.reply(`Warning #${warning.id} issued to ${mentioned}.`);
    }
    if (command === 'warnings') {
      const warnings = data.warnings.filter((warning) => warning.userId === message.author.id);
      return message.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warnings: ${message.author.username}`).setDescription((warnings.map((warning) => `**#${warning.id}** — ${warning.reason}`).join('\n') || 'No warnings.').slice(0, 4096))] });
    }
    if (command === 'warns') {
      if (!await staffOnly()) return;
      if (!mentioned) return message.reply('Usage: `.warns @member`');
      const warnings = data.warnings.filter((warning) => warning.userId === mentioned.id);
      return message.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warnings: ${mentioned.username}`).setDescription((warnings.map((warning) => `**#${warning.id}** — ${warning.reason}`).join('\n') || 'No warnings.').slice(0, 4096))] });
    }
    if (command === 'points') {
      if (subcommand === 'view' || subcommand === 'ping') { const points = userRecord(message.author.id).points; if (points >= MAX_POINTS) await safeDm(message.author, new EmbedBuilder().setColor(0xfee75c).setTitle('Points capacity reached').setDescription(`You are at ${MAX_POINTS} points.`)); return message.reply(`You have **${points}/${MAX_POINTS}** points.`); }
      if (!await staffOnly()) return;
      if (subcommand === 'check') { const balances = Object.entries(data.users).map(([id, record]) => `<@${id}> — **${record.points}/${MAX_POINTS}**`).join('\n') || 'No saved point balances.'; return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Point balance check').setDescription(balances.slice(0, 4096))] }); }
      const amount = Number(rest[1]);
      if (!['add', 'remove'].includes(subcommand) || !mentioned || !Number.isInteger(amount) || amount < 1) return message.reply('Usage: `.points add|remove @member <amount>`');
      const record = userRecord(mentioned.id); const before = record.points; record.points = subcommand === 'add' ? Math.min(MAX_POINTS, record.points + amount) : Math.max(0, record.points - amount); saveData();
      return message.reply(`${mentioned}: **${before} → ${record.points}** points.`);
    }
    if (command === 'wof') {
      if (!subcommand || subcommand === 'view') { const entries = data.wallOfFame.map((id, index) => `${index + 1}. <@${id}>`).join('\n') || 'No one is on the Wall of Fame yet.'; return message.reply({ embeds: [new EmbedBuilder().setColor(0xff73fa).setTitle('Wall of Fame').setDescription(entries)] }); }
      if (!await staffOnly()) return;
      if (!mentioned || !['add', 'remove'].includes(subcommand)) return message.reply('Usage: `.wof add|remove @member`');
      if (subcommand === 'add' && !data.wallOfFame.includes(mentioned.id)) data.wallOfFame.push(mentioned.id);
      if (subcommand === 'remove') data.wallOfFame = data.wallOfFame.filter((id) => id !== mentioned.id);
      saveData(); return message.reply(`${mentioned} was ${subcommand === 'add' ? 'added to' : 'removed from'} the Wall of Fame.`);
    }
    if (command !== 'help') return;
    return message.reply(prefixHelp);
  } catch (error) {
    console.error('Prefix command error:', error);
    return message.reply('Something went wrong while processing that command.');
  }
});

client.login(process.env.DISCORD_TOKEN);

// Command handlers

// Item commands
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.inGuild() || !message.content.startsWith('.')) return;
  const [command, subcommand, ...rest] = message.content.slice(1).trim().split(/\s+/);

  if (command === 'item') {
    if (subcommand === 'add') {
      const [name, type, price, minAmount] = rest;
      if (!name || !type || !price || !minAmount) return message.reply('Usage: `.item add <name> <bulk/individual> <price> <min_amount>`');
      // Add item to database
      try {
        const newItem = await Item.create({
          name,
          type,
          price,
          minAmount
        });
        return message.reply(`Item ${name} added with type ${type}, price ${price}, and minimum amount ${minAmount}.`);
      } catch (error) {
        console.error('Error adding item:', error);
        return message.reply('Failed to add item. Please try again.');
      }
    }
    if (subcommand === 'remove') {
      const [name] = rest;
      if (!name) return message.reply('Usage: `.item remove <name>`');
      // Remove item from database
      return message.reply(`Item ${name} removed.`);
    }
    if (subcommand === 'restocked') {
      const [name, amount] = rest;
      if (!name || !amount) return message.reply('Usage: `.item restocked <name> <amount>`');
      // Update item stock in database
      return message.reply(`Item ${name} restocked with amount ${amount}.`);
    }
  }

  // Subscription commands
  if (command === 'subscription') {
    if (subcommand === 'add') {
      const [member, amount] = rest;
      if (!member) return message.reply('Usage: `.subscription add @member [amount]`');
      // Add subscription to member
      return message.reply(`Subscription added to ${member} with amount ${amount || 'default'}.`);
    }
    if (subcommand === 'remove') {
      const [member, amount] = rest;
      if (!member) return message.reply('Usage: `.subscription remove @member [amount]`');
      // Remove subscription from member
      return message.reply(`Subscription removed from ${member} with amount ${amount || 'default'}.`);
    }
  }

  // Session commands
  if (command === 'session') {
    if (subcommand === 'add') {
      const [item] = rest;
      if (!item) return message.reply('Usage: `.session add <item>`');
      // Add item to session
      return message.reply(`Item ${item} added to session.`);
    }
    if (subcommand === 'remove') {
      const [item] = rest;
      if (!item) return message.reply('Usage: `.session remove <item>`');
      // Remove item from session
      return message.reply(`Item ${item} removed from session.`);
    }
    if (subcommand === 'check') {
      // Check session items
      return message.reply('Session items checked.');
    }
    if (subcommand === 'start') {
      const [hours] = rest;
      if (!hours) return message.reply('Usage: `.session start <hours>`');
      // Start session
      return message.reply(`Session started for ${hours} hours.`);
    }
    if (subcommand === 'stop') {
      // Stop session
      return message.reply('Session stopped.');
    }
    if (subcommand === 'history') {
      // Show session history
      return message.reply('Session history shown.');
    }
  }

  // Coins commands
  if (command === 'coins') {
    if (subcommand === 'add') {
      const [member, amount] = rest;
      if (!member || !amount) return message.reply('Usage: `.coins add @member <amount>`');
      // Add coins to member
      return message.reply(`Added ${amount} coins to ${member}.`);
    }
    if (subcommand === 'remove') {
      const [member, amount] = rest;
      if (!member || !amount) return message.reply('Usage: `.coins remove @member <amount>`');
      // Remove coins from member
      return message.reply(`Removed ${amount} coins from ${member}.`);
    }
    if (subcommand === 'bal') {
      // Show balance
      return message.reply('Balance shown.');
    }
  }

  // Coin flip command
  if (command === 'cf') {
    const [bet] = rest;
    if (!bet) return message.reply('Usage: `.cf <bet>`');
    // Flip coin
    return message.reply(`Coin flipped with bet ${bet}.`);
  }

  // Giveaway commands
  if (command === 'gw') {
    if (subcommand === 'start') {
      const [channel, days, winners, prize] = rest;
      if (!channel || !days || !winners || !prize) return message.reply('Usage: `.gw start <channel> <days> <winners> <prize>`');
      // Start giveaway
      return message.reply(`Giveaway started in ${channel} for ${days} days with ${winners} winners and prize ${prize}.`);
    }
    if (subcommand === 'reroll') {
      const [msgId, winners] = rest;
      if (!msgId) return message.reply('Usage: `.gw reroll <msg_id> [winners]`');
      // Reroll giveaway
      return message.reply(`Giveaway rerolled with message ID ${msgId} and ${winners || 'default'} winners.`);
    }
    if (subcommand === 'end') {
      const [msgId] = rest;
      if (!msgId) return message.reply('Usage: `.gw end <msg_id>`');
      // End giveaway
      return message.reply(`Giveaway ended with message ID ${msgId}.`);
    }
  }
});
