const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { data, saveData, requireStaff, safeDm } = require('../utils');

const commandDefinitions = [
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
];

async function showWarnings(target, replyOrMessage) {
  const warnings = data.warnings.filter((warning) => warning.userId === target.id);
  const description = warnings.length
    ? warnings.map((warning) => `**#${warning.id}** — ${warning.reason}\n<t:${Math.floor(warning.createdAt / 1000)}:d>`).join('\n\n')
    : 'No warnings.';
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warnings: ${target.username}`).setDescription(description.slice(0, 4096));
  if (replyOrMessage.reply) {
    await replyOrMessage.reply({ embeds: [embed], ephemeral: true });
  } else {
    await replyOrMessage.channel.send({ embeds: [embed] });
  }
}

async function handleModeration(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  const target = interaction.options.getUser('member');

  if (interaction.commandName === 'warnings') {
    return showWarnings(interaction.user, interaction);
  }

  if (interaction.commandName === 'warns') {
    if (!await requireStaff(interaction)) return;
    return showWarnings(target, interaction);
  }

  if (interaction.commandName === 'warn') {
    if (!await requireStaff(interaction)) return;

    if (subcommand === 'add') {
      const reason = interaction.options.getString('reason', true);
      const warning = {
        id: data.nextWarningId++,
        userId: target.id,
        reason,
        staffId: interaction.user.id,
        createdAt: Date.now()
      };
      data.warnings.push(warning);
      saveData();
      await safeDm(target, new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warning #${warning.id}`).setDescription(reason).setFooter({ text: 'Contact staff if you have questions.' }));
      return interaction.reply({ content: `Warning **#${warning.id}** issued to ${target}. They were notified by DM.`, ephemeral: true });
    }

    if (subcommand === 'remove') {
      const id = interaction.options.getInteger('id', true);
      const reason = interaction.options.getString('reason', true);
      const index = data.warnings.findIndex((warning) => warning.id === id);
      if (index === -1) return interaction.reply({ content: `Warning #${id} does not exist.`, ephemeral: true });
      const [warning] = data.warnings.splice(index, 1);
      saveData();
      const warnedUser = await interaction.client.users.fetch(warning.userId).catch(() => null);
      if (warnedUser) {
        await safeDm(warnedUser, new EmbedBuilder().setColor(0x57f287).setTitle(`Warning #${id} removed`).setDescription(`Reason: ${reason}`));
      }
      return interaction.reply({ content: `Warning **#${id}** was removed. The affected member was notified by DM.`, ephemeral: true });
    }
  }
}

async function handleModerationPrefix(message, args) {
  const [command, subcommand, ...rest] = args;
  const mentioned = message.mentions.users.first();

  if (command === 'warnings') {
    return showWarnings(message.author, message);
  }

  if (command === 'warns') {
    if (!mentioned) return message.reply('Usage: `.warns @member`');
    const target = mentioned;
    const warnings = data.warnings.filter((warning) => warning.userId === target.id);
    const description = warnings.length
      ? warnings.map((warning) => `**#${warning.id}** — ${warning.reason}`).join('\n')
      : 'No warnings.';
    return message.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warnings: ${target.username}`).setDescription(description.slice(0, 4096))] });
  }

  if (command === 'warn') {
    if (subcommand === 'remove') {
      const id = Number(rest[0]);
      const reason = rest.slice(1).join(' ');
      if (!Number.isInteger(id) || !reason) return message.reply('Usage: `.warn remove <id> <reason>`');
      const index = data.warnings.findIndex((warning) => warning.id === id);
      if (index === -1) return message.reply(`Warning #${id} does not exist.`);
      const [warning] = data.warnings.splice(index, 1);
      saveData();
      const warnedUser = await message.client.users.fetch(warning.userId).catch(() => null);
      if (warnedUser) {
        await safeDm(warnedUser, new EmbedBuilder().setColor(0x57f287).setTitle(`Warning #${id} removed`).setDescription(`Reason: ${reason}`));
      }
      return message.reply(`Warning #${id} was removed.`);
    }

    // warn add
    if (!mentioned) return message.reply('Usage: `.warn @member <reason>`');
    const reason = rest.slice(1).join(' ');
    if (!reason) return message.reply('Usage: `.warn @member <reason>`');
    const warning = {
      id: data.nextWarningId++,
      userId: mentioned.id,
      reason,
      staffId: message.author.id,
      createdAt: Date.now()
    };
    data.warnings.push(warning);
    saveData();
    await safeDm(mentioned, new EmbedBuilder().setColor(0xf1c40f).setTitle(`Warning #${warning.id}`).setDescription(reason));
    return message.reply(`Warning #${warning.id} issued to ${mentioned}.`);
  }
}

module.exports = { commandDefinitions, handleModeration, handleModerationPrefix };

