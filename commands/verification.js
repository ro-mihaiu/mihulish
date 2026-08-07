const { SlashCommandBuilder } = require('discord.js');
const { data, saveData, userRecord, requireStaff, isStaff, safeDm, setRankRole, RANKS, makeEmbed, logoFile } = require('../utils');
const { resolveMember } = require('./moderation');

const STAFF_CHANNEL_ID = '1511566996632768663';
const TRUST_LOCATIONS = ['mihu-farm', 'mihu-rentals', 'mihu-shop', 'mihu-casino', 'mihu-money', 'dungeon'];
const TRUST_CHOICES = TRUST_LOCATIONS.map((loc) => ({ name: loc, value: loc }));

const commandDefinitions = [
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
    .addStringOption((option) => option.setName('location').setDescription('Trusted location').setRequired(true).addChoices(...TRUST_CHOICES)),
  new SlashCommandBuilder().setName('untrust').setDescription('Remove a member trust at a location (staff)')
    .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
    .addStringOption((option) => option.setName('location').setDescription('Location').setRequired(true).addChoices(...TRUST_CHOICES)),
  new SlashCommandBuilder().setName('verify').setDescription('Verify yourself with your in-game user and rank')
    .addStringOption((option) => option.setName('in_game_user').setDescription('Your in-game username').setRequired(true))
    .addStringOption((option) => option.setName('rank').setDescription('Your rank').setRequired(true).addChoices(...RANKS.map((rank) => ({ name: rank, value: rank })))),
  new SlashCommandBuilder().setName('setverify').setDescription('Force-verify a member with their in-game user and rank (staff)')
    .addStringOption((option) => option.setName('member').setDescription('Member mention, username, or user ID').setRequired(true))
    .addStringOption((option) => option.setName('in_game_user').setDescription('Target in-game username').setRequired(true))
    .addStringOption((option) => option.setName('rank').setDescription('Target rank').setRequired(true).addChoices(...RANKS.map((rank) => ({ name: rank, value: rank })))),
];

async function handleVerification(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  const target = interaction.options.getUser('member');

  if (interaction.commandName === 'rank' && subcommand === 'update') {
    const rank = interaction.options.getString('rank', true);
    const channel = await interaction.client.channels.fetch(STAFF_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) return interaction.reply({ content: 'The rank-request channel is not available. Please contact staff.', ephemeral: true });
    await channel.send({ embeds: [makeEmbed().setTitle('Rank change request').addFields({ name: 'Member', value: `${interaction.user} (${interaction.user.id})` }, { name: 'Requested rank', value: rank }).setTimestamp()], files: logoFile() });
    return interaction.reply({ content: 'Your rank-change request was sent to staff.', ephemeral: true });
  }

  if (!await requireStaff(interaction)) return;

  if (interaction.commandName === 'rank' && subcommand === 'change') {
    const rank = interaction.options.getString('rank', true);
    const member = await interaction.guild.members.fetch(target.id);
    const record = userRecord(target.id);
    const previous = record.rank || 'none';
    record.rank = rank;
    saveData();
    const roleFound = await setRankRole(member, rank).catch(() => false);
    await safeDm(target, makeEmbed().setTitle('Rank updated').setDescription(`Your rank is now **${rank}**.`));
    return interaction.reply({ content: `${target} rank changed from **${previous}** to **${rank}**.${roleFound ? '' : ' No Discord role was changed because no matching role was found.'}`, ephemeral: true });
  }

  if (interaction.commandName === 'unverify') {
    delete data.users[target.id];
    data.warnings = data.warnings.filter((w) => w.userId !== target.id);
    data.wallOfFame = data.wallOfFame.filter((id) => id !== target.id);
    delete data.coins[target.id];
    delete data.subscriptions[target.id];
    delete data.sessions[target.id];
    saveData();
    return interaction.reply({ content: `${target} has been completely removed from the bot records.`, ephemeral: true });
  }

  if (interaction.commandName === 'trust' || interaction.commandName === 'untrust') {
    const location = interaction.options.getString('location', true);
    const record = userRecord(target.id);
    const matching = (item) => item.toLowerCase() === location.toLowerCase();
    if (interaction.commandName === 'trust') {
      if (!record.trustedLocations.some(matching)) record.trustedLocations.push(location);
    } else {
      record.trustedLocations = record.trustedLocations.filter((item) => !matching(item));
    }
    saveData();
    await updateTrustDashboard(interaction.guild, location);
    const action = interaction.commandName === 'trust' ? 'trusted' : 'untrusted';
    await safeDm(target, makeEmbed().setTitle(`You are ${action}`).setDescription(`Location: **${location}**`));
    return interaction.reply({ content: `${target} is now ${action} at **${location}**.`, ephemeral: true });
  }
}

async function handleVerificationPrefix(message, args) {
  const [command, subcommand, ...rest] = args;
  const mentioned = message.mentions.users.first();
  const rankFrom = (parts) => parts.join(' ');

  if (command === 'rank') {
    if (subcommand === 'update') {
      const rank = rankFrom(rest);
      if (!RANKS.includes(rank)) return message.reply(`Choose one of: ${RANKS.join(', ')}.`);
      const channel = await message.client.channels.fetch(STAFF_CHANNEL_ID).catch(() => null);
      if (!channel?.isTextBased()) return message.reply('The rank-request channel is not available.');
      await channel.send({ embeds: [makeEmbed().setTitle('Rank change request').addFields({ name: 'Member', value: `${message.author} (${message.author.id})` }, { name: 'Requested rank', value: rank }).setTimestamp()], files: logoFile() });
      return message.reply('Your rank-change request was sent to staff.');
    }
    if (subcommand === 'change') {
      if (!mentioned) return message.reply('Usage: `.rank change @member <rank>`');
      const rank = rankFrom(rest.slice(1));
      if (!RANKS.includes(rank)) return message.reply(`Choose one of: ${RANKS.join(', ')}.`);
      const member = await message.guild.members.fetch(mentioned.id);
      const record = userRecord(mentioned.id);
      const previous = record.rank || 'none';
      record.rank = rank;
      saveData();
      const roleFound = await setRankRole(member, rank).catch(() => false);
      await safeDm(mentioned, makeEmbed().setTitle('Rank updated').setDescription(`Your rank is now **${rank}**.`));
      return message.reply(`${mentioned} rank changed from **${previous}** to **${rank}**.${roleFound ? '' : ' No matching Discord role was found.'}`);
    }
  }

  if (command === 'unverify') {
    if (!mentioned) return message.reply('Usage: `.unverify @member`');
    delete data.users[mentioned.id];
    data.warnings = data.warnings.filter((w) => w.userId !== mentioned.id);
    data.wallOfFame = data.wallOfFame.filter((id) => id !== mentioned.id);
    delete data.coins[mentioned.id];
    delete data.subscriptions[mentioned.id];
    delete data.sessions[mentioned.id];
    saveData();
    return message.reply(`${mentioned} was removed from the bot records.`);
  }

  if (command === 'trust' || command === 'untrust') {
    const location = rankFrom(rest);
    if (!mentioned || !location) return message.reply(`Usage: \`.${command} @member <location>\`\nAvailable locations: ${TRUST_LOCATIONS.join(', ')}`);
    if (!TRUST_LOCATIONS.includes(location.toLowerCase())) return message.reply(`Invalid location. Available locations: ${TRUST_LOCATIONS.join(', ')}`);
    const record = userRecord(mentioned.id);
    const matching = (item) => item.toLowerCase() === location.toLowerCase();
    if (command === 'trust' && !record.trustedLocations.some(matching)) record.trustedLocations.push(location);
    if (command === 'untrust') record.trustedLocations = record.trustedLocations.filter((item) => !matching(item));
    saveData();
    await updateTrustDashboard(message.guild, location);
    const action = command === 'trust' ? 'trusted' : 'untrusted';
    await safeDm(mentioned, makeEmbed().setTitle(`You are ${action}`).setDescription(`Location: **${location}**`));
    return message.reply(`${mentioned} is now ${action} at **${location}**.`);
  }
}

async function handleVerify(interaction) {
  const inGameUser = interaction.options.getString('in_game_user', true).trim();
  const rank = interaction.options.getString('rank', true);
  const canonicalRank = RANKS.find((candidate) => candidate.toLowerCase() === rank.toLowerCase());
  if (!canonicalRank) {
    return interaction.reply({ content: `Invalid rank. Choose one of: ${RANKS.join(', ')}.`, ephemeral: true });
  }
  const record = userRecord(interaction.user.id);
  record.inGameUser = inGameUser;
  record.rank = canonicalRank;
  saveData();
  const nickname = `🌸 ${inGameUser}`;
  try {
    await interaction.member.setNickname(nickname, 'MIHU bot verification');
    return interaction.reply({ content: `You are verified as **${nickname}** with rank **${canonicalRank}**.`, ephemeral: true });
  } catch (error) {
    console.error('Nickname change failed:', error);
    return interaction.reply({ content: `Your records were saved, but I could not change your nickname (${nickname}). Make sure the bot has the **Manage Nicknames** permission and that your highest role is below the bot's role.`, ephemeral: true });
  }
}

async function handleVerifyPrefix(message, args) {
  const [, ...rest] = args;
  const inGameUser = rest[0];
  const rank = rest.slice(1).join(' ').trim();
  if (!inGameUser || !rank) return message.reply('Usage: `.verify <in-game-user> <rank>`\nExample: `.verify Mihaitzuuu Celestial`');
  const canonicalRank = RANKS.find((candidate) => candidate.toLowerCase() === rank.toLowerCase());
  if (!canonicalRank) return message.reply(`Invalid rank. Choose one of: ${RANKS.join(', ')}.`);
  const record = userRecord(message.author.id);
  record.inGameUser = inGameUser;
  record.rank = canonicalRank;
  saveData();
  const nickname = `🌸 ${inGameUser}`;
  try {
    await message.member.setNickname(nickname, 'MIHU bot verification');
    return message.reply(`You are verified as **${nickname}** with rank **${canonicalRank}**.`);
  } catch (error) {
    console.error('Nickname change failed:', error);
    return message.reply(`Your records were saved, but I could not change your nickname (${nickname}). Make sure the bot has the **Manage Nicknames** permission and that your highest role is below the bot's role.`);
  }
}

async function applySetVerify(member, inGameUser, canonicalRank) {
  const record = userRecord(member.id);
  record.inGameUser = inGameUser;
  record.rank = canonicalRank;
  saveData();
  const nickname = `🌸 ${inGameUser}`;
  await member.setNickname(nickname, 'MIHU bot force verification');
  return nickname;
}

async function handleSetVerify(interaction) {
  if (!await requireStaff(interaction)) return;
  const memberInput = interaction.options.getString('member', true);
  const inGameUser = interaction.options.getString('in_game_user', true).trim();
  const rank = interaction.options.getString('rank', true);
  const canonicalRank = RANKS.find((candidate) => candidate.toLowerCase() === rank.toLowerCase());
  if (!canonicalRank) {
    return interaction.reply({ content: `Invalid rank. Choose one of: ${RANKS.join(', ')}.`, ephemeral: true });
  }
  const member = await resolveMember(interaction.guild, memberInput);
  if (!member) {
    return interaction.reply({ content: `Could not find a member matching **${memberInput}**. Try mentioning them, using their username, or their user ID.`, ephemeral: true });
  }
  const target = member.user;
  try {
    const nickname = await applySetVerify(member, inGameUser, canonicalRank);
    return interaction.reply({ content: `${target} has been force-verified as **${nickname}** with rank **${canonicalRank}**.`, ephemeral: true });
  } catch (error) {
    console.error('Nickname change failed:', error);
    return interaction.reply({ content: `Records saved, but I could not change ${target}'s nickname (🌸 ${inGameUser}). Make sure the bot has the **Manage Nicknames** permission and that the target's highest role is below the bot's role.`, ephemeral: true });
  }
}

async function handleSetVerifyPrefix(message, args) {
  if (!isStaff(message.member)) return message.reply('This command is for staff only.');
  const memberInput = args[1];
  const inGameUser = args[2];
  const rank = args.slice(3).join(' ').trim();
  if (!memberInput || !inGameUser || !rank) {
    return message.reply('Usage: `.setverify <member> <in-game-user> <rank>`\nExample: `.setverify @member Mihaitzuuu Celestial`');
  }
  const canonicalRank = RANKS.find((candidate) => candidate.toLowerCase() === rank.toLowerCase());
  if (!canonicalRank) return message.reply(`Invalid rank. Choose one of: ${RANKS.join(', ')}.`);
  const member = await resolveMember(message.guild, memberInput);
  if (!member) {
    return message.reply(`Could not find a member matching **${memberInput}**. Try mentioning them, using their username, or their user ID.`);
  }
  const target = member.user;
  try {
    const nickname = await applySetVerify(member, inGameUser, canonicalRank);
    return message.reply(`${target} has been force-verified as **${nickname}** with rank **${canonicalRank}**.`);
  } catch (error) {
    console.error('Nickname change failed:', error);
    return message.reply(`Records saved, but I could not change ${target}'s nickname (🌸 ${inGameUser}). Make sure the bot has the **Manage Nicknames** permission and that the target's highest role is below the bot's role.`);
  }
}

// ─── Trust dashboards ───────────────────────────────────────────────────────
// Keeps a single embed in each `<location>-users` channel up to date with the
// list of members trusted there. data.trustDashboards[location] stores the
// channel id + message id so edits replace the old message instead of spamming.
async function updateTrustDashboard(guild, location) {
  try {
    const canonical = location.toLowerCase();
    const channel = guild.channels.cache.find((c) => c.name.toLowerCase() === `${canonical}-users`);
    if (!channel?.isTextBased()) return;

    const trustedIds = Object.entries(data.users)
      .filter(([, record]) => record.trustedLocations?.some((item) => item.toLowerCase() === canonical))
      .map(([id]) => id);

    const lines = trustedIds.length
      ? trustedIds.map((id) => `<@${id}>`).join('\n')
      : 'No trusted members yet.';

    const embed = makeEmbed()
      .setTitle(`${canonical} — Trusted Members`)
      .setDescription(`**${trustedIds.length}** member(s) trusted:\n\n${lines.slice(0, 4000)}`)
      .setTimestamp();

    const saved = data.trustDashboards[canonical] || {};
    if (saved.channelId === channel.id && saved.messageId) {
      const msg = await channel.messages.fetch(saved.messageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], files: logoFile() });
        return;
      }
    }

    const sent = await channel.send({ embeds: [embed], files: logoFile() });
    data.trustDashboards[canonical] = { channelId: channel.id, messageId: sent.id };
    saveData();
  } catch (error) {
    console.error(`Failed to update trust dashboard for ${location}:`, error);
  }
}

async function rebuildAllTrustDashboards(guild) {
  for (const location of TRUST_LOCATIONS) {
    await updateTrustDashboard(guild, location);
  }
}

module.exports = { commandDefinitions, handleVerification, handleVerificationPrefix, handleVerify, handleVerifyPrefix, handleSetVerify, handleSetVerifyPrefix, updateTrustDashboard, rebuildAllTrustDashboards };
