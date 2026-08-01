const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { data, saveData, requireStaff } = require('../utils');

const commandDefinitions = [
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
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount to add to stock').setRequired(true))),
];

async function handleShop(interaction) {
  if (!await requireStaff(interaction)) return;
  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === 'add') {
    const name = interaction.options.getString('name', true).toLowerCase();
    const type = interaction.options.getString('type', true);
    const price = interaction.options.getInteger('price', true);
    const minAmount = interaction.options.getInteger('min_amount', true);

    if (data.items[name]) {
      return interaction.reply({ content: `Item **${name}** already exists. Use \`/item remove\` first or choose a different name.`, ephemeral: true });
    }

    data.items[name] = {
      name,
      type,
      price,
      minAmount,
      stock: 0,
      createdAt: Date.now()
    };
    saveData();
    return interaction.reply({ content: `Item **${name}** added (${type}, price: ${price}, min stock: ${minAmount}).`, ephemeral: true });
  }

  if (subcommand === 'remove') {
    const name = interaction.options.getString('name', true).toLowerCase();
    if (!data.items[name]) {
      return interaction.reply({ content: `Item **${name}** does not exist.`, ephemeral: true });
    }
    delete data.items[name];
    saveData();
    return interaction.reply({ content: `Item **${name}** removed.`, ephemeral: true });
  }

  if (subcommand === 'restocked') {
    const name = interaction.options.getString('name', true).toLowerCase();
    const amount = interaction.options.getInteger('amount', true);
    if (!data.items[name]) {
      return interaction.reply({ content: `Item **${name}** does not exist.`, ephemeral: true });
    }
    if (amount < 1) {
      return interaction.reply({ content: 'Amount must be at least 1.', ephemeral: true });
    }
    data.items[name].stock += amount;
    saveData();
    return interaction.reply({ content: `**${name}** restocked (+${amount}). Current stock: ${data.items[name].stock}.`, ephemeral: true });
  }
}

async function handleShopPrefix(message, args) {
  const [command, subcommand, ...rest] = args;

  if (command === 'item') {
    if (subcommand === 'add') {
      const [name, type, price, minAmount] = rest;
      if (!name || !type || !price || !minAmount) return message.reply('Usage: `.item add <name> <bulk/individual> <price> <min_amount>`');
      const itemName = name.toLowerCase();
      if (data.items[itemName]) return message.reply(`Item **${itemName}** already exists.`);
      if (!['bulk', 'individual'].includes(type)) return message.reply('Type must be `bulk` or `individual`.');
      data.items[itemName] = { name: itemName, type, price: Number(price), minAmount: Number(minAmount), stock: 0, createdAt: Date.now() };
      saveData();
      return message.reply(`Item **${itemName}** added (${type}, price: ${price}, min stock: ${minAmount}).`);
    }

    if (subcommand === 'remove') {
      const name = rest[0];
      if (!name) return message.reply('Usage: `.item remove <name>`');
      const itemName = name.toLowerCase();
      if (!data.items[itemName]) return message.reply(`Item **${itemName}** does not exist.`);
      delete data.items[itemName];
      saveData();
      return message.reply(`Item **${itemName}** removed.`);
    }

    if (subcommand === 'restocked') {
      const [name, amount] = rest;
      if (!name || !amount) return message.reply('Usage: `.item restocked <name> <amount>`');
      const itemName = name.toLowerCase();
      if (!data.items[itemName]) return message.reply(`Item **${itemName}** does not exist.`);
      const amt = Number(amount);
      if (!Number.isInteger(amt) || amt < 1) return message.reply('Amount must be a positive integer.');
      data.items[itemName].stock += amt;
      saveData();
      return message.reply(`**${itemName}** restocked (+${amt}). Current stock: ${data.items[itemName].stock}.`);
    }
  }
}

module.exports = { commandDefinitions, handleShop, handleShopPrefix };

