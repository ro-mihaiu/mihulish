const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { data, saveData, requireStaff, safeDm } = require('../utils');

const commandDefinitions = [
  new SlashCommandBuilder().setName('subscription').setDescription('Manage subscriptions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Number of tokens (default 1 = 30 days)').setRequired(false)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a subscription')
      .addUserOption((option) => option.setName('member').setDescription('Member').setRequired(true))
      .addIntegerOption((option) => option.setName('amount').setDescription('Number of tokens to remove').setRequired(false))),
  new SlashCommandBuilder().setName('mysubscription').setDescription('View your subscription'),
  new SlashCommandBuilder().setName('session').setDescription('Manage rental sessions')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add gear to session')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove gear from session')
      .addStringOption((option) => option.setName('item').setDescription('Item name').setRequired(true)))
    .addSubcommand((sub) => sub.setName('check').setDescription('Check current session'))
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a session')
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setRequired(true)))
    .addSubcommand((sub) => sub.setName('stop').setDescription('Stop current session'))
    .addSubcommand((sub) => sub.setName('history').setDescription('View session history')),
];

async function handleSubscription(interaction) {
  const subcommand = interaction.options.getSubcommand(false);
  const target = interaction.options.getUser('member');
  const amount = interaction.options.getInteger('amount') ?? 1;

  if (interaction.commandName === 'subscription') {
    if (!await requireStaff(interaction)) return;

    if (subcommand === 'add') {
      const now = Date.now();
      if (!data.subscriptions[target.id]) {
        data.subscriptions[target.id] = { tokens: 0, history: [] };
      }
      data.subscriptions[target.id].tokens += amount;
      data.subscriptions[target.id].history.push({
        type: 'add',
        amount,
        staffId: interaction.user.id,
        timestamp: now
      });
      saveData();
      await safeDm(target, new EmbedBuilder().setColor(0x57f287).setTitle('Subscription updated').setDescription(`You received **${amount}** rental token(s). Total: ${data.subscriptions[target.id].tokens}.`));
      return interaction.reply({ content: `Added **${amount}** token(s) to ${target}. They have ${data.subscriptions[target.id].tokens} token(s) total.`, ephemeral: true });
    }

    if (subcommand === 'remove') {
      if (!data.subscriptions[target.id] || data.subscriptions[target.id].tokens < amount) {
        return interaction.reply({ content: `${target} does not have enough tokens. They have ${data.subscriptions[target.id]?.tokens ?? 0}.`, ephemeral: true });
      }
      data.subscriptions[target.id].tokens -= amount;
      data.subscriptions[target.id].history.push({
        type: 'remove',
        amount,
        staffId: interaction.user.id,
        timestamp: Date.now()
      });
      saveData();
      await safeDm(target, new EmbedBuilder().setColor(0xed4245).setTitle('Subscription updated').setDescription(`${amount} rental token(s) were removed. Remaining: ${data.subscriptions[target.id].tokens}.`));
      return interaction.reply({ content: `Removed **${amount}** token(s) from ${target}. They have ${data.subscriptions[target.id].tokens} token(s) left.`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'mysubscription') {
    const sub = data.subscriptions[interaction.user.id];
    if (!sub || sub.tokens <= 0) {
      return interaction.reply({ content: 'You have no active subscription tokens.', ephemeral: true });
    }
    return interaction.reply({ content: `You have **${sub.tokens}** rental token(s). Each token = ~30 days.`, ephemeral: true });
  }
}

async function handleSession(interaction) {
  const subcommand = interaction.options.getSubcommand(true);
  const userId = interaction.user.id;

  if (!data.sessions[userId]) {
    data.sessions[userId] = { gear: [], active: false, startTime: null, endTime: null, hours: 0, history: [] };
  }

  if (subcommand === 'add') {
    if (!await requireStaff(interaction)) return;
    const item = interaction.options.getString('item', true).toLowerCase();
    const session = data.sessions[userId];
    if (session.gear.includes(item)) {
      return interaction.reply({ content: `**${item}** is already in the session gear.`, ephemeral: true });
    }
    session.gear.push(item);
    saveData();
    return interaction.reply({ content: `**${item}** added to session gear.`, ephemeral: true });
  }

  if (subcommand === 'remove') {
    if (!await requireStaff(interaction)) return;
    const item = interaction.options.getString('item', true).toLowerCase();
    const session = data.sessions[userId];
    const index = session.gear.indexOf(item);
    if (index === -1) {
      return interaction.reply({ content: `**${item}** is not in the session gear.`, ephemeral: true });
    }
    session.gear.splice(index, 1);
    saveData();
    return interaction.reply({ content: `**${item}** removed from session gear.`, ephemeral: true });
  }

  if (subcommand === 'check') {
    const session = data.sessions[userId];
    if (session.active) {
      const elapsed = Math.floor((Date.now() - session.startTime) / 3600000);
      const remaining = session.hours - elapsed;
      return interaction.reply({
        content: `Session is **active**. Gear: ${session.gear.length ? session.gear.join(', ') : 'none'} | ${elapsed}h elapsed / ${session.hours}h total | ${remaining > 0 ? `${remaining}h remaining` : 'time expired'}.`,
        ephemeral: true
      });
    }
    return interaction.reply({ content: `No active session. Gear prepared: ${session.gear.length ? session.gear.join(', ') : 'none'}.`, ephemeral: true });
  }

  if (subcommand === 'start') {
    if (!await requireStaff(interaction)) return;
    const hours = interaction.options.getInteger('hours', true);
    const session = data.sessions[userId];
    if (session.active) {
      return interaction.reply({ content: 'A session is already active. Stop it first with `/session stop`.', ephemeral: true });
    }
    session.active = true;
    session.startTime = Date.now();
    session.hours = hours;
    session.endTime = null;
    saveData();
    return interaction.reply({ content: `Session started for **${hours}** hour(s).`, ephemeral: true });
  }

  if (subcommand === 'stop') {
    if (!await requireStaff(interaction)) return;
    const session = data.sessions[userId];
    if (!session.active) {
      return interaction.reply({ content: 'No active session to stop.', ephemeral: true });
    }
    const elapsed = Math.floor((Date.now() - session.startTime) / 3600000);
    session.active = false;
    session.endTime = Date.now();
    session.history.push({
      startTime: session.startTime,
      endTime: session.endTime,
      hours: session.hours,
      elapsed
    });
    session.startTime = null;
    session.hours = 0;
    saveData();
    return interaction.reply({ content: `Session stopped after ~${elapsed} hour(s).`, ephemeral: true });
  }

  if (subcommand === 'history') {
    const session = data.sessions[userId];
    if (!session.history.length) {
      return interaction.reply({ content: 'No session history yet.', ephemeral: true });
    }
    const entries = session.history.slice(-10).reverse().map((h, i) =>
      `**#${session.history.length - i}** — ${h.hours}h planned, ${h.elapsed}h used — <t:${Math.floor(h.startTime / 1000)}:d>`
    ).join('\n');
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Session History').setDescription(entries.slice(0, 4096))], ephemeral: true });
  }
}

async function handleSubscriptionPrefix(message, args) {
  const [command, subcommand, ...rest] = args;
  const mentioned = message.mentions.users.first();
  const amount = Number(rest[rest.length - 1]) || 1;

  if (command === 'subscription') {
    if (!mentioned) return message.reply(`Usage: \`.subscription ${subcommand} @member [amount]\``);

    if (subcommand === 'add') {
      if (!data.subscriptions[mentioned.id]) {
        data.subscriptions[mentioned.id] = { tokens: 0, history: [] };
      }
      data.subscriptions[mentioned.id].tokens += amount;
      data.subscriptions[mentioned.id].history.push({ type: 'add', amount, staffId: message.author.id, timestamp: Date.now() });
      saveData();
      await safeDm(mentioned, new EmbedBuilder().setColor(0x57f287).setTitle('Subscription updated').setDescription(`You received **${amount}** rental token(s). Total: ${data.subscriptions[mentioned.id].tokens}.`));
      return message.reply(`Added **${amount}** token(s) to ${mentioned}. Total: ${data.subscriptions[mentioned.id].tokens}.`);
    }

    if (subcommand === 'remove') {
      if (!data.subscriptions[mentioned.id] || data.subscriptions[mentioned.id].tokens < amount) {
        return message.reply(`${mentioned} has only ${data.subscriptions[mentioned.id]?.tokens ?? 0} token(s).`);
      }
      data.subscriptions[mentioned.id].tokens -= amount;
      data.subscriptions[mentioned.id].history.push({ type: 'remove', amount, staffId: message.author.id, timestamp: Date.now() });
      saveData();
      await safeDm(mentioned, new EmbedBuilder().setColor(0xed4245).setTitle('Subscription updated').setDescription(`${amount} rental token(s) were removed. Remaining: ${data.subscriptions[mentioned.id].tokens}.`));
      return message.reply(`Removed **${amount}** token(s) from ${mentioned}. Remaining: ${data.subscriptions[mentioned.id].tokens}.`);
    }
  }

  if (command === 'mysubscription') {
    const sub = data.subscriptions[message.author.id];
    if (!sub || sub.tokens <= 0) return message.reply('You have no active subscription tokens.');
    return message.reply(`You have **${sub.tokens}** rental token(s). Each token = ~30 days.`);
  }

  if (command === 'session') {
    const userId = message.author.id;
    if (!data.sessions[userId]) {
      data.sessions[userId] = { gear: [], active: false, startTime: null, endTime: null, hours: 0, history: [] };
    }

    if (subcommand === 'add') {
      const item = rest[0]?.toLowerCase();
      if (!item) return message.reply('Usage: `.session add <item>`');
      if (data.sessions[userId].gear.includes(item)) return message.reply(`**${item}** is already in the gear.`);
      data.sessions[userId].gear.push(item);
      saveData();
      return message.reply(`**${item}** added to session gear.`);
    }

    if (subcommand === 'remove') {
      const item = rest[0]?.toLowerCase();
      if (!item) return message.reply('Usage: `.session remove <item>`');
      const idx = data.sessions[userId].gear.indexOf(item);
      if (idx === -1) return message.reply(`**${item}** is not in the gear.`);
      data.sessions[userId].gear.splice(idx, 1);
      saveData();
      return message.reply(`**${item}** removed from session gear.`);
    }

    if (subcommand === 'check') {
      const s = data.sessions[userId];
      if (s.active) {
        const elapsed = Math.floor((Date.now() - s.startTime) / 3600000);
        return message.reply(`Session **active**. Gear: ${s.gear.join(', ') || 'none'} | ${elapsed}h / ${s.hours}h`);
      }
      return message.reply(`No active session. Gear: ${s.gear.join(', ') || 'none'}.`);
    }

    if (subcommand === 'start') {
      const hours = Number(rest[0]);
      if (!hours || hours < 1) return message.reply('Usage: `.session start <hours>`');
      if (data.sessions[userId].active) return message.reply('A session is already active.');
      data.sessions[userId].active = true;
      data.sessions[userId].startTime = Date.now();
      data.sessions[userId].hours = hours;
      saveData();
      return message.reply(`Session started for **${hours}** hour(s).`);
    }

    if (subcommand === 'stop') {
      if (!data.sessions[userId].active) return message.reply('No active session.');
      const elapsed = Math.floor((Date.now() - data.sessions[userId].startTime) / 3600000);
      data.sessions[userId].active = false;
      data.sessions[userId].endTime = Date.now();
      data.sessions[userId].history.push({
        startTime: data.sessions[userId].startTime,
        endTime: data.sessions[userId].endTime,
        hours: data.sessions[userId].hours,
        elapsed
      });
      data.sessions[userId].startTime = null;
      data.sessions[userId].hours = 0;
      saveData();
      return message.reply(`Session stopped after ~${elapsed} hour(s).`);
    }

    if (subcommand === 'history') {
      const history = data.sessions[userId].history;
      if (!history.length) return message.reply('No session history yet.');
      const entries = history.slice(-10).reverse().map((h, i) =>
        `**#${history.length - i}** — ${h.hours}h planned, ${h.elapsed}h used`
      ).join('\n');
      return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Session History').setDescription(entries.slice(0, 4096))] });
    }
  }
}

module.exports = { commandDefinitions, handleSubscription, handleSession, handleSubscriptionPrefix };

