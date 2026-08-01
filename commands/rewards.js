const { SlashCommandBuilder } = require('discord.js');
const { data, saveData, userRecord, requireStaff, safeDm, MAX_POINTS, makeEmbed, logoFile } = require('../utils');

const commandDefinitions = [
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
];

async function handleRewards(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  const target = interaction.options.getUser('member');

  if (interaction.commandName === 'points') {
    if (subcommand === 'view') {
      const points = userRecord(interaction.user.id).points;
      if (points >= MAX_POINTS) {
        await safeDm(interaction.user, makeEmbed().setTitle('Points capacity reached').setDescription(`You are at the full capacity of ${MAX_POINTS} points.`));
      }
      return interaction.reply({ content: `You have **${points}/${MAX_POINTS}** points.${points >= MAX_POINTS ? ' I also sent you a DM.' : ''}`, ephemeral: true });
    }

    if (!await requireStaff(interaction)) return;

    if (subcommand === 'check') {
      const balances = Object.entries(data.users).map(([id, record]) => `<@${id}> — **${record.points}/${MAX_POINTS}**`).join('\n') || 'No saved point balances.';
      return interaction.reply({ embeds: [makeEmbed().setTitle('Point balance check').setDescription(balances.slice(0, 4096))], files: logoFile(), ephemeral: true });
    }

    const amount = interaction.options.getInteger('amount', true);
    const record = userRecord(target.id);
    const before = record.points;
    record.points = subcommand === 'add' ? Math.min(MAX_POINTS, record.points + amount) : Math.max(0, record.points - amount);
    saveData();
    return interaction.reply({ content: `${target}: **${before} → ${record.points}** points.`, ephemeral: true });
  }

  if (interaction.commandName === 'wof') {
    if (subcommand === 'view') {
      const entries = data.wallOfFame.map((id, index) => `${index + 1}. <@${id}>`).join('\n') || 'No one is on the Wall of Fame yet.';
      return interaction.reply({ embeds: [makeEmbed().setTitle('Wall of Fame').setDescription(entries)], files: logoFile() });
    }

    if (!await requireStaff(interaction)) return;

    if (subcommand === 'add') {
      if (!data.wallOfFame.includes(target.id)) data.wallOfFame.push(target.id);
      saveData();
      return interaction.reply({ content: `${target} was added to the Wall of Fame.`, ephemeral: true });
    }

    if (subcommand === 'remove') {
      data.wallOfFame = data.wallOfFame.filter((id) => id !== target.id);
      saveData();
      return interaction.reply({ content: `${target} was removed from the Wall of Fame.`, ephemeral: true });
    }
  }
}

async function handleRewardsPrefix(message, args) {
  const [command, subcommand, ...rest] = args;
  const mentioned = message.mentions.users.first();
  const amount = Number(rest[1]);

  if (command === 'points') {
    if (subcommand === 'view' || subcommand === 'ping') {
      const points = userRecord(message.author.id).points;
      if (points >= MAX_POINTS) {
        await safeDm(message.author, makeEmbed().setTitle('Points capacity reached').setDescription(`You are at ${MAX_POINTS} points.`));
      }
      return message.reply(`You have **${points}/${MAX_POINTS}** points.`);
    }

    if (subcommand === 'check') {
      const balances = Object.entries(data.users).map(([id, record]) => `<@${id}> — **${record.points}/${MAX_POINTS}**`).join('\n') || 'No saved point balances.';
      return message.reply({ embeds: [makeEmbed().setTitle('Point balance check').setDescription(balances.slice(0, 4096))], files: logoFile() });
    }

    if (!['add', 'remove'].includes(subcommand) || !mentioned || !Number.isInteger(amount) || amount < 1) {
      return message.reply('Usage: `.points add|remove @member <amount>`');
    }
    const record = userRecord(mentioned.id);
    const before = record.points;
    record.points = subcommand === 'add' ? Math.min(MAX_POINTS, record.points + amount) : Math.max(0, record.points - amount);
    saveData();
    return message.reply(`${mentioned}: **${before} → ${record.points}** points.`);
  }

  if (command === 'wof') {
    if (!subcommand || subcommand === 'view') {
      const entries = data.wallOfFame.map((id, index) => `${index + 1}. <@${id}>`).join('\n') || 'No one is on the Wall of Fame yet.';
      return message.reply({ embeds: [makeEmbed().setTitle('Wall of Fame').setDescription(entries)], files: logoFile() });
    }
    if (!mentioned || !['add', 'remove'].includes(subcommand)) return message.reply('Usage: `.wof add|remove @member`');
    if (subcommand === 'add' && !data.wallOfFame.includes(mentioned.id)) data.wallOfFame.push(mentioned.id);
    if (subcommand === 'remove') data.wallOfFame = data.wallOfFame.filter((id) => id !== mentioned.id);
    saveData();
    return message.reply(`${mentioned} was ${subcommand === 'add' ? 'added to' : 'removed from'} the Wall of Fame.`);
  }
}

module.exports = { commandDefinitions, handleRewards, handleRewardsPrefix };

