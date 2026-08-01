const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { data, saveData, requireStaff } = require('../utils');

const commandDefinitions = [
  new SlashCommandBuilder().setName('coins').setDescription('Manage coins')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add coins (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove coins (staff)')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('bal').setDescription('Check your coin balance')),
  new SlashCommandBuilder().setName('cf').setDescription('Coin flip — bet your coins')
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true)),
];

async function handleFun(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  const target = interaction.options.getUser('member');

  if (interaction.commandName === 'coins') {
    if (subcommand === 'bal') {
      const bal = data.coins[interaction.user.id] || 0;
      return interaction.reply({ content: `You have **${bal}** coin(s).`, ephemeral: true });
    }

    if (!await requireStaff(interaction)) return;

    const amount = interaction.options.getInteger('amount', true);
    if (amount < 1) return interaction.reply({ content: 'Amount must be positive.', ephemeral: true });

    if (subcommand === 'add') {
      data.coins[target.id] = (data.coins[target.id] || 0) + amount;
      saveData();
      return interaction.reply({ content: `Added **${amount}** coin(s) to ${target}. Their balance: ${data.coins[target.id]}.`, ephemeral: true });
    }

    if (subcommand === 'remove') {
      const current = data.coins[target.id] || 0;
      if (current < amount) {
        return interaction.reply({ content: `${target} only has ${current} coin(s). Cannot remove ${amount}.`, ephemeral: true });
      }
      data.coins[target.id] = current - amount;
      saveData();
      return interaction.reply({ content: `Removed **${amount}** coin(s) from ${target}. Their balance: ${data.coins[target.id]}.`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'cf') {
    const bet = interaction.options.getInteger('bet', true);
    const userCoins = data.coins[interaction.user.id] || 0;

    if (bet < 1) return interaction.reply({ content: 'Bet must be at least 1.', ephemeral: true });
    if (bet > userCoins) return interaction.reply({ content: `You only have **${userCoins}** coin(s). You cannot bet ${bet}.`, ephemeral: true });

    const win = Math.random() < 0.5;
    if (win) {
      data.coins[interaction.user.id] = userCoins + bet;
      saveData();
      return interaction.reply({ content: `🎉 **Heads!** You won **${bet}** coin(s)! Balance: ${data.coins[interaction.user.id]}.`, ephemeral: true });
    } else {
      data.coins[interaction.user.id] = userCoins - bet;
      saveData();
      return interaction.reply({ content: `😞 **Tails!** You lost **${bet}** coin(s). Balance: ${data.coins[interaction.user.id]}.`, ephemeral: true });
    }
  }
}

async function handleFunPrefix(message, args) {
  const [command, subcommand, ...rest] = args;
  const mentioned = message.mentions.users.first();

  if (command === 'coins') {
    if (subcommand === 'bal') {
      return message.reply(`You have **${data.coins[message.author.id] || 0}** coin(s).`);
    }

    if (!mentioned) return message.reply(`Usage: \`.coins ${subcommand} @member <amount>\``);
    const amount = Number(rest[1]);
    if (!Number.isInteger(amount) || amount < 1) return message.reply('Amount must be a positive integer.');

    if (subcommand === 'add') {
      data.coins[mentioned.id] = (data.coins[mentioned.id] || 0) + amount;
      saveData();
      return message.reply(`Added **${amount}** coin(s) to ${mentioned}. Balance: ${data.coins[mentioned.id]}.`);
    }

    if (subcommand === 'remove') {
      const current = data.coins[mentioned.id] || 0;
      if (current < amount) return message.reply(`${mentioned} only has ${current} coin(s).`);
      data.coins[mentioned.id] = current - amount;
      saveData();
      return message.reply(`Removed **${amount}** coin(s) from ${mentioned}. Balance: ${data.coins[mentioned.id]}.`);
    }
  }

  if (command === 'cf') {
    const bet = Number(rest[0]);
    if (!Number.isInteger(bet) || bet < 1) return message.reply('Usage: `.cf <bet>`');
    const userCoins = data.coins[message.author.id] || 0;
    if (bet > userCoins) return message.reply(`You only have **${userCoins}** coin(s).`);
    const win = Math.random() < 0.5;
    if (win) {
      data.coins[message.author.id] = userCoins + bet;
      saveData();
      return message.reply(`🎉 **Heads!** You won **${bet}** coin(s)! Balance: ${data.coins[message.author.id]}.`);
    } else {
      data.coins[message.author.id] = userCoins - bet;
      saveData();
      return message.reply(`😞 **Tails!** You lost **${bet}** coin(s). Balance: ${data.coins[message.author.id]}.`);
    }
  }
}

module.exports = { commandDefinitions, handleFun, handleFunPrefix };

