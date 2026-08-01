const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { data, saveData, requireStaff } = require('../utils');

// ─── Claim cooldowns (milliseconds) ─────────────────────────────────────────
const CLAIMS = {
  daily: { amount: 50, cooldown: 24 * 60 * 60 * 1000, label: 'daily' },
  weekly: { amount: 250, cooldown: 7 * 24 * 60 * 60 * 1000, label: 'weekly' },
  monthly: { amount: 1000, cooldown: 30 * 24 * 60 * 60 * 1000, label: 'monthly' },
};

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
    .addIntegerOption((option) => option.setName('bet').setDescription('Bet amount').setRequired(true))
    .addStringOption((option) => option.setName('choice').setDescription('Heads or Tails')
      .addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' })),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins'),
  new SlashCommandBuilder().setName('weekly').setDescription('Claim your weekly coins'),
  new SlashCommandBuilder().setName('monthly').setDescription('Claim your monthly coins'),
];

// ─── Coin flip helper ───────────────────────────────────────────────────────
function flipCoin(choice, authorId, bet) {
  const userCoins = data.coins[authorId] || 0;
  if (bet < 1) return { error: 'Bet must be at least 1.' };
  if (bet > userCoins) return { error: `You only have **${userCoins}** coin(s). You cannot bet ${bet}.` };

  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  // If the user picked a side, win only when it matches; otherwise it's a random 50/50.
  const win = choice ? choice === result : Math.random() < 0.5;

  data.coins[authorId] = win ? userCoins + bet : userCoins - bet;
  saveData();

  const sideEmoji = result === 'heads' ? '🪙 **Heads!**' : '🪙 **Tails!**';
  if (win) {
    return { content: `${sideEmoji} You won **${bet}** coin(s)! Balance: ${data.coins[authorId]}.` };
  }
  return { content: `${sideEmoji} You lost **${bet}** coin(s). Balance: ${data.coins[authorId]}.` };
}

// ─── Claim helper ───────────────────────────────────────────────────────────
async function claimCoins(interaction, period) {
  const cfg = CLAIMS[period];
  const userId = interaction.user.id;
  data.claims ||= {};
  data.claims[userId] ||= {};

  const last = data.claims[userId][period] || 0;
  const now = Date.now();
  const elapsed = now - last;

  if (elapsed < cfg.cooldown) {
    const remaining = cfg.cooldown - elapsed;
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const timeLeft = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    return interaction.reply({
      content: `You already claimed your ${cfg.label} coins. Come back in **${timeLeft}**.`,
      ephemeral: true
    });
  }

  data.claims[userId][period] = now;
  data.coins[userId] = (data.coins[userId] || 0) + cfg.amount;
  saveData();

  return interaction.reply({
    content: `💰 You claimed **${cfg.amount}** ${cfg.label} coin(s)! Balance: **${data.coins[userId]}**.`,
    ephemeral: true
  });
}

async function handleFun(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  const target = interaction.options.getUser('member');

  // /daily, /weekly, /monthly
  if (interaction.commandName === 'daily' || interaction.commandName === 'weekly' || interaction.commandName === 'monthly') {
    return claimCoins(interaction, interaction.commandName);
  }

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
    const choice = interaction.options.getString('choice')?.toLowerCase();
    const userCoins = data.coins[interaction.user.id] || 0;

    if (bet < 1) return interaction.reply({ content: 'Bet must be at least 1.', ephemeral: true });
    if (bet > userCoins) return interaction.reply({ content: `You only have **${userCoins}** coin(s). You cannot bet ${bet}.`, ephemeral: true });

    const result = flipCoin(choice, interaction.user.id, bet);
    return interaction.reply({ content: result.content, ephemeral: true });
  }
}

async function handleFunPrefix(message, args) {
  const [command, subcommand, ...rest] = args;
  const mentioned = message.mentions.users.first();

  // .daily / .weekly / .monthly
  if (command === 'daily' || command === 'weekly' || command === 'monthly') {
    const cfg = CLAIMS[command];
    const userId = message.author.id;
    data.claims ||= {};
    data.claims[userId] ||= {};

    const last = data.claims[userId][command] || 0;
    const now = Date.now();
    const elapsed = now - last;

    if (elapsed < cfg.cooldown) {
      const remaining = cfg.cooldown - elapsed;
      const hours = Math.floor(remaining / 3600000);
      const minutes = Math.floor((remaining % 3600000) / 60000);
      const timeLeft = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
      return message.reply(`You already claimed your ${cfg.label} coins. Come back in **${timeLeft}**.`);
    }

    data.claims[userId][command] = now;
    data.coins[userId] = (data.coins[userId] || 0) + cfg.amount;
    saveData();
    return message.reply(`💰 You claimed **${cfg.amount}** ${cfg.label} coin(s)! Balance: **${data.coins[userId]}**.`);
  }

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
    // Supports `.cf heads 25`, `.cf tails 25`, and `.cf 25` (random pick)
    let choice = null;
    let betArg = rest[0];
    if (rest.length > 1 && ['heads', 'tails'].includes(rest[0]?.toLowerCase())) {
      choice = rest[0].toLowerCase();
      betArg = rest[1];
    }
    const bet = Number(betArg);
    if (!Number.isInteger(bet) || bet < 1) return message.reply('Usage: `.cf <heads|tails> <bet>` or `.cf <bet>`');
    const userCoins = data.coins[message.author.id] || 0;
    if (bet > userCoins) return message.reply(`You only have **${userCoins}** coin(s).`);

    const result = flipCoin(choice, message.author.id, bet);
    return message.reply(result.content);
  }
}

module.exports = { commandDefinitions, handleFun, handleFunPrefix };

