const { SlashCommandBuilder } = require('discord.js');
const { data, saveData, requireStaff, isStaff, makeEmbed, logoFile } = require('../utils');

const commandDefinitions = [
  new SlashCommandBuilder().setName('cmd').setDescription('Manage custom commands (tags)')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a custom command (staff)')
      .addStringOption((option) => option.setName('name').setDescription('Command name (use without the dot, e.g. website)').setRequired(true))
      .addStringOption((option) => option.setName('content').setDescription('Message that the command replies with').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a custom command (staff)')
      .addStringOption((option) => option.setName('name').setDescription('Command name (use without the dot, e.g. website)').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('List all custom commands')),
];

const MAX_CONTENT_LENGTH = 2000;

async function handleCmd(interaction) {
  const subcommand = interaction.options.getSubcommand(true);
  const name = interaction.options.getString('name', true)?.toLowerCase();

  if (subcommand === 'list') {
    const names = Object.keys(data.customCommands || {});
    if (!names.length) {
      return interaction.reply({ content: 'No custom commands have been created yet.', ephemeral: true });
    }
    const description = names.map((cmdName) => `• \`.${cmdName}\` — ${(data.customCommands[cmdName].content || '').slice(0, 60)}`).join('\n');
    return interaction.reply({ embeds: [makeEmbed().setTitle('Custom commands').setDescription(description.slice(0, 4096))], files: logoFile() });
  }

  if (!await requireStaff(interaction)) return;

  if (subcommand === 'add') {
    const content = interaction.options.getString('content', true);
    if (!name) return interaction.reply({ content: 'Please provide a command name.', ephemeral: true });
    if (content.length > MAX_CONTENT_LENGTH) {
      return interaction.reply({ content: `Content is too long (max ${MAX_CONTENT_LENGTH} characters).`, ephemeral: true });
    }
    data.customCommands ||= {};
    if (data.customCommands[name]) {
      return interaction.reply({ content: `A custom command named **${name}** already exists. Use \`/cmd remove ${name}\` first to overwrite it.`, ephemeral: true });
    }
    data.customCommands[name] = { content, staffId: interaction.user.id, createdAt: Date.now() };
    saveData();
    return interaction.reply({ content: `Custom command **${name}** added. Use \`.${name}\` to trigger it.`, ephemeral: true });
  }

  if (subcommand === 'remove') {
    data.customCommands ||= {};
    if (!data.customCommands[name]) {
      return interaction.reply({ content: `No custom command named **${name}** exists.`, ephemeral: true });
    }
    delete data.customCommands[name];
    saveData();
    return interaction.reply({ content: `Custom command **${name}** removed.`, ephemeral: true });
  }
}

async function handleCmdPrefix(message, args) {
  const [command, subcommand, ...rest] = args;

  if (command !== 'cmd') return;

  if (subcommand === 'list') {
    const names = Object.keys(data.customCommands || {});
    if (!names.length) return message.reply('No custom commands have been created yet.');
    const description = names.map((cmdName) => `• \`.${cmdName}\` — ${(data.customCommands[cmdName].content || '').slice(0, 60)}`).join('\n');
    return message.reply({ embeds: [makeEmbed().setTitle('Custom commands').setDescription(description.slice(0, 4096))], files: logoFile() });
  }

  if (subcommand === 'add') {
    if (!isStaff(message.member)) return message.reply('This command is for staff only.');
    const name = rest[0]?.toLowerCase();
    const content = rest.slice(1).join(' ');
    if (!name || !content) return message.reply('Usage: `.cmd add <name> <content>`');
    if (content.length > MAX_CONTENT_LENGTH) return message.reply(`Content is too long (max ${MAX_CONTENT_LENGTH} characters).`);
    data.customCommands ||= {};
    if (data.customCommands[name]) return message.reply(`A custom command named **${name}** already exists.`);
    data.customCommands[name] = { content, staffId: message.author.id, createdAt: Date.now() };
    saveData();
    return message.reply(`Custom command **${name}** added. Use \`.${name}\` to trigger it.`);
  }

  if (subcommand === 'remove') {
    if (!isStaff(message.member)) return message.reply('This command is for staff only.');
    const name = rest[0]?.toLowerCase();
    if (!name) return message.reply('Usage: `.cmd remove <name>`');
    data.customCommands ||= {};
    if (!data.customCommands[name]) return message.reply(`No custom command named **${name}** exists.`);
    delete data.customCommands[name];
    saveData();
    return message.reply(`Custom command **${name}** removed.`);
  }

  return message.reply('Usage: `.cmd add <name> <content>` | `.cmd remove <name>` | `.cmd list`');
}

module.exports = { commandDefinitions, handleCmd, handleCmdPrefix };

