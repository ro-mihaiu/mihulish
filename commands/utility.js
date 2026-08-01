const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { data, saveData, requireStaff } = require('../utils');

const commandDefinitions = [
  new SlashCommandBuilder().setName('gw').setDescription('Manage giveaways')
    .addSubcommand((sub) => sub.setName('start').setDescription('Start a giveaway')
      .addChannelOption((option) => option.setName('channel').setDescription('Channel').setRequired(true))
      .addIntegerOption((option) => option.setName('days').setDescription('Duration in days').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1))
      .addIntegerOption((option) => option.setName('prize').setDescription('Prize coin amount').setRequired(true)))
    .addSubcommand((sub) => sub.setName('reroll').setDescription('Reroll a giveaway')
      .addStringOption((option) => option.setName('msg_id').setDescription('Giveaway message ID').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners to reroll').setRequired(false).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('end').setDescription('End a giveaway early')
      .addStringOption((option) => option.setName('msg_id').setDescription('Giveaway message ID').setRequired(true))),
  new SlashCommandBuilder().setName('update').setDescription('Force update dashboard channels (staff)'),
];

async function handleGiveaway(interaction) {
  if (!await requireStaff(interaction)) return;
  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === 'start') {
    const channel = interaction.options.getChannel('channel', true);
    const days = interaction.options.getInteger('days', true);
    const winners = interaction.options.getInteger('winners', true);
    const prize = interaction.options.getInteger('prize', true);
    const endTime = Date.now() + (days * 24 * 60 * 60 * 1000);

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🎉 Giveaway!')
      .setDescription(`React with 🎉 to enter!\n**Prize:** ${prize} coins\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>`)
      .setFooter({ text: `Hosted by ${interaction.user.tag}` })
      .setTimestamp(endTime);

    const msg = await channel.send({ embeds: [embed] });
    await msg.react('🎉');

    const giveaway = {
      messageId: msg.id,
      channelId: channel.id,
      guildId: interaction.guild.id,
      hostId: interaction.user.id,
      prize,
      winners,
      endTime,
      ended: false
    };
    data.giveaways ||= [];
    data.giveaways.push(giveaway);
    saveData();

    return interaction.reply({ content: `Giveaway started in ${channel}! Ends <t:${Math.floor(endTime / 1000)}:R>.`, ephemeral: true });
  }

  if (subcommand === 'reroll') {
    const msgId = interaction.options.getString('msg_id', true);
    const rerollWinners = interaction.options.getInteger('winners') || 1;

    const gw = (data.giveaways || []).find((g) => g.messageId === msgId);
    if (!gw) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });

    try {
      const channel = await interaction.client.channels.fetch(gw.channelId);
      const msg = await channel.messages.fetch(msgId);
      const reaction = msg.reactions.cache.get('🎉');
      if (!reaction) return interaction.reply({ content: 'No 🎉 reactions found on that message.', ephemeral: true });

      const users = await reaction.users.fetch();
      const entrants = users.filter((u) => !u.bot).map((u) => u);
      if (entrants.length === 0) return interaction.reply({ content: 'No entrants to reroll.', ephemeral: true });

      const maxWinners = Math.min(rerollWinners, entrants.length, gw.winners);
      const shuffled = [...entrants].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, maxWinners);

      await channel.send(`🎉 **Reroll!** New winner(s): ${selected.join(', ')} won **${gw.prize}** coin(s)!`);
      return interaction.reply({ content: `Rerolled **${maxWinners}** winner(s).`, ephemeral: true });
    } catch (error) {
      console.error('Reroll error:', error);
      return interaction.reply({ content: 'Could not reroll. Check the message ID or permissions.', ephemeral: true });
    }
  }

  if (subcommand === 'end') {
    const msgId = interaction.options.getString('msg_id', true);
    const gw = (data.giveaways || []).find((g) => g.messageId === msgId);
    if (!gw) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });

    if (gw.ended) return interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
    gw.ended = true;
    saveData();

    try {
      const channel = await interaction.client.channels.fetch(gw.channelId);
      const msg = await channel.messages.fetch(msgId);
      const reaction = msg.reactions.cache.get('🎉');
      const users = reaction ? await reaction.users.fetch() : [];
      const entrants = users.filter((u) => !u.bot).map((u) => u);

      if (entrants.length === 0) {
        await channel.send('Giveaway ended — no one entered.');
      } else {
        const shuffled = [...entrants].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, gw.winners);
        await channel.send(`🎉 **Giveaway ended!** Winner(s): ${selected.join(', ')} won **${gw.prize}** coin(s)!`);
      }

      const endedEmbed = EmbedBuilder.from(msg.embeds[0]).setColor(0x808080).setFooter({ text: 'Ended' });
      await msg.edit({ embeds: [endedEmbed] });
    } catch (error) {
      console.error('End giveaway error:', error);
    }

    return interaction.reply({ content: 'Giveaway ended.', ephemeral: true });
  }
}

async function handleUpdate(interaction) {
  if (!await requireStaff(interaction)) return;
  return interaction.reply({ content: 'Dashboard channels updated.', ephemeral: true });
}

async function handleGWPrefix(message, args) {
  const [command, subcommand, ...rest] = args;

  if (command === 'gw') {
    if (subcommand === 'start') {
      const [channelMention, days, winners, prize] = rest;
      if (!channelMention || !days || !winners || !prize) {
        return message.reply('Usage: `.gw start <#channel> <days> <winners> <prize>`');
      }
      const channel = message.mentions.channels.first();
      if (!channel) return message.reply('Please mention a valid channel.');
      const endTime = Date.now() + (Number(days) * 24 * 60 * 60 * 1000);

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('🎉 Giveaway!')
        .setDescription(`React with 🎉 to enter!\n**Prize:** ${prize} coins\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>`)
        .setFooter({ text: `Hosted by ${message.author.tag}` })
        .setTimestamp(endTime);

      const msg = await channel.send({ embeds: [embed] });
      await msg.react('🎉');

      data.giveaways ||= [];
      data.giveaways.push({
        messageId: msg.id,
        channelId: channel.id,
        guildId: message.guild.id,
        hostId: message.author.id,
        prize: Number(prize),
        winners: Number(winners),
        endTime,
        ended: false
      });
      saveData();
      return message.reply(`Giveaway started in ${channel}!`);
    }

    if (subcommand === 'reroll') {
      const [msgId, winners] = rest;
      if (!msgId) return message.reply('Usage: `.gw reroll <msg_id> [winners]`');

      const gw = (data.giveaways || []).find((g) => g.messageId === msgId);
      if (!gw) return message.reply('Giveaway not found.');
      const rerollWinners = Number(winners) || 1;

      try {
        const channel = await message.client.channels.fetch(gw.channelId);
        const msg = await channel.messages.fetch(msgId);
        const reaction = msg.reactions.cache.get('🎉');
        if (!reaction) return message.reply('No 🎉 reactions.');
        const users = await reaction.users.fetch();
        const entrants = users.filter((u) => !u.bot).map((u) => u);
        if (!entrants.length) return message.reply('No entrants.');
        const maxW = Math.min(rerollWinners, entrants.length, gw.winners);
        const selected = [...entrants].sort(() => Math.random() - 0.5).slice(0, maxW);
        await channel.send(`🎉 **Reroll!** New winner(s): ${selected.join(', ')} won **${gw.prize}** coin(s)!`);
        return message.reply(`Rerolled ${maxW} winner(s).`);
      } catch (error) {
        return message.reply('Could not reroll. Check the message ID.');
      }
    }

    if (subcommand === 'end') {
      const [msgId] = rest;
      if (!msgId) return message.reply('Usage: `.gw end <msg_id>`');
      const gw = (data.giveaways || []).find((g) => g.messageId === msgId);
      if (!gw) return message.reply('Giveaway not found.');
      if (gw.ended) return message.reply('Already ended.');
      gw.ended = true;
      saveData();

      try {
        const channel = await message.client.channels.fetch(gw.channelId);
        const msg = await channel.messages.fetch(msgId);
        const reaction = msg.reactions.cache.get('🎉');
        const users = reaction ? await reaction.users.fetch() : [];
        const entrants = users.filter((u) => !u.bot).map((u) => u);
        if (entrants.length) {
          const selected = [...entrants].sort(() => Math.random() - 0.5).slice(0, gw.winners);
          await channel.send(`🎉 **Giveaway ended!** Winner(s): ${selected.join(', ')} won **${gw.prize}** coin(s)!`);
        } else {
          await channel.send('Giveaway ended — no one entered.');
        }
        const endedEmbed = EmbedBuilder.from(msg.embeds[0]).setColor(0x808080).setFooter({ text: 'Ended' });
        await msg.edit({ embeds: [endedEmbed] });
      } catch (error) { console.error(error); }
      return message.reply('Giveaway ended.');
    }
  }

  if (command === 'update') {
    return message.reply('Dashboard channels updated.');
  }
}

module.exports = { commandDefinitions, handleGiveaway, handleUpdate, handleGWPrefix };

