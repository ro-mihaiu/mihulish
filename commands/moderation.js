const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { data, saveData, requireStaff, safeDm, isStaff, makeEmbed, logoFile, logEvent } = require('../utils');

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
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member (staff)')
    .addStringOption((option) => option.setName('member').setDescription('Member mention, username, or user ID').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Ban reason').setRequired(false))
    .addIntegerOption((option) => option.setName('delete_days').setDescription('Days of messages to delete (0-7)').setRequired(false)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member (staff)')
    .addStringOption((option) => option.setName('member').setDescription('Member mention, username, or user ID').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Kick reason').setRequired(false)),
  new SlashCommandBuilder().setName('mute').setDescription('Mute/timeout a member (staff)')
    .addStringOption((option) => option.setName('member').setDescription('Member mention, username, or user ID').setRequired(true))
    .addStringOption((option) => option.setName('duration').setDescription('Duration, e.g. 10m, 2h, 3d').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Mute reason').setRequired(false)),
  new SlashCommandBuilder().setName('unmute').setDescription('Unmute/remove timeout from a member (staff)')
    .addStringOption((option) => option.setName('member').setDescription('Member mention, username, or user ID').setRequired(true)),
];

// ─── Resolve a member from mention, username, or user ID ───────────────────
async function resolveMember(guild, input) {
  if (!input) return null;
  const trimmed = input.trim();

  // Mention format: <@123...> or <@!123...>
  const mentionMatch = trimmed.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    return guild.members.fetch(mentionMatch[1]).catch(() => null);
  }

  // Plain user ID
  if (/^\d{15,21}$/.test(trimmed)) {
    return guild.members.fetch(trimmed).catch(() => null);
  }

  // Username (exact, case-insensitive) or global display name / nickname
  const normalized = trimmed.toLowerCase();
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return null;
  return members.find(
    (m) => m.user.username.toLowerCase() === normalized
      || m.user.globalName?.toLowerCase() === normalized
      || (m.nickname && m.nickname.toLowerCase() === normalized)
  ) || null;
}

function parseDuration(input) {
  if (!input) return null;
  const match = String(input).trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d|w)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2] || 'm';
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const ms = value * multipliers[unit];
  // Discord timeouts are capped at 28 days.
  return Math.min(ms, 28 * 24 * 60 * 60 * 1000);
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ') || `${seconds}s`;
}

async function showWarnings(target, replyOrMessage) {
  const warnings = data.warnings.filter((warning) => warning.userId === target.id);
  const description = warnings.length
    ? warnings.map((warning) => `**#${warning.id}** — ${warning.reason}\n<t:${Math.floor(warning.createdAt / 1000)}:d>`).join('\n\n')
    : 'No warnings.';
  const embed = makeEmbed().setTitle(`Warnings: ${target.username}`).setThumbnail(target.displayAvatarURL()).setDescription(description.slice(0, 4096));
  if (replyOrMessage.reply) {
    await replyOrMessage.reply({ embeds: [embed], files: logoFile(), ephemeral: true });
  } else {
    await replyOrMessage.channel.send({ embeds: [embed], files: logoFile() });
  }
}

async function handleModeration(interaction) {
  const subcommand = interaction.options.getSubcommand(false);

  if (interaction.commandName === 'warnings') {
    return showWarnings(interaction.user, interaction);
  }

  if (interaction.commandName === 'warns') {
    if (!await requireStaff(interaction)) return;
    const target = interaction.options.getUser('member');
    return showWarnings(target, interaction);
  }

  if (interaction.commandName === 'warn') {
    if (!await requireStaff(interaction)) return;
    const target = interaction.options.getUser('member');

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
      await safeDm(target, makeEmbed().setTitle(`Warning #${warning.id}`).setDescription(reason));
      await logEvent(interaction.client, {
        title: '⚠️ Member Warned',
        description: `${target} - ${target.username} was warned.\n**Warning #:** ${warning.id}\n**Reason:** ${reason}\n**By:** ${interaction.user}`,
        user: target,
        color: 0xf1c40f,
      });
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
        await safeDm(warnedUser, makeEmbed().setTitle(`Warning #${id} removed`).setDescription(`Reason: ${reason}`));
      }
      return interaction.reply({ content: `Warning **#${id}** was removed. The affected member was notified by DM.`, ephemeral: true });
    }
  }

  // ─── ban / kick / mute / unmute ──────────────────────────────────────────
  if (['ban', 'kick', 'mute', 'unmute'].includes(interaction.commandName)) {
    if (!await requireStaff(interaction)) return;

    const memberInput = interaction.options.getString('member', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const member = await resolveMember(interaction.guild, memberInput);
    if (!member) {
      return interaction.reply({ content: `Could not find a member matching **${memberInput}**. Try mentioning them, using their username, or their user ID.`, ephemeral: true });
    }
    const targetUser = member.user;

    if (interaction.commandName === 'ban') {
      const deleteDays = interaction.options.getInteger('delete_days') || 0;
      await member.ban({ reason: `Banned by ${interaction.user.tag}: ${reason}`, deleteMessageSeconds: deleteDays * 86400 });
      await safeDm(targetUser, makeEmbed().setTitle('You were banned').setDescription(`**Server:** ${interaction.guild.name}\n**Reason:** ${reason}`));
      await logEvent(interaction.client, {
        title: '🔨 Member Banned',
        description: `${targetUser} - ${targetUser.username} was banned.\n**Reason:** ${reason}\n**By:** ${interaction.user}`,
        user: targetUser,
        color: 0xed4245,
      });
      return interaction.reply({ content: `${targetUser} was banned. Reason: ${reason}`, ephemeral: true });
    }

    if (interaction.commandName === 'kick') {
      await member.kick(`Kicked by ${interaction.user.tag}: ${reason}`);
      await safeDm(targetUser, makeEmbed().setTitle('You were kicked').setDescription(`**Server:** ${interaction.guild.name}\n**Reason:** ${reason}`));
      await logEvent(interaction.client, {
        title: '👢 Member Kicked',
        description: `${targetUser} - ${targetUser.username} was kicked.\n**Reason:** ${reason}\n**By:** ${interaction.user}`,
        user: targetUser,
        color: 0xe67e22,
      });
      return interaction.reply({ content: `${targetUser} was kicked. Reason: ${reason}`, ephemeral: true });
    }

    if (interaction.commandName === 'mute') {
      const durationInput = interaction.options.getString('duration', true);
      const ms = parseDuration(durationInput);
      if (!ms) {
        return interaction.reply({ content: 'Invalid duration. Examples: `10m`, `2h`, `3d`, `1w`.', ephemeral: true });
      }
      await member.timeout(ms, `Muted by ${interaction.user.tag}: ${reason}`);
      const until = Date.now() + ms;
      await safeDm(targetUser, makeEmbed().setTitle('You were muted').setDescription(`**Server:** ${interaction.guild.name}\n**Duration:** ${formatDuration(ms)}\n**Reason:** ${reason}`));
      await logEvent(interaction.client, {
        title: '🔇 Member Muted',
        description: `${targetUser} - ${targetUser.username} was muted.\n**Duration:** ${formatDuration(ms)}\n**Until:** <t:${Math.floor(until / 1000)}:F>\n**Reason:** ${reason}\n**By:** ${interaction.user}`,
        user: targetUser,
        color: 0xed4245,
      });
      return interaction.reply({ content: `${targetUser} was muted for ${formatDuration(ms)}. Reason: ${reason}`, ephemeral: true });
    }

    if (interaction.commandName === 'unmute') {
      await member.timeout(null, `Unmuted by ${interaction.user.tag}`);
      await safeDm(targetUser, makeEmbed().setTitle('You were unmuted').setDescription(`**Server:** ${interaction.guild.name}`));
      await logEvent(interaction.client, {
        title: '🔊 Member Unmuted',
        description: `${targetUser} - ${targetUser.username} was unmuted.\n**By:** ${interaction.user}`,
        user: targetUser,
        color: 0x57f287,
      });
      return interaction.reply({ content: `${targetUser} was unmuted.`, ephemeral: true });
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
    return message.reply({ embeds: [makeEmbed().setTitle(`Warnings: ${target.username}`).setThumbnail(target.displayAvatarURL()).setDescription(description.slice(0, 4096))], files: logoFile() });
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
        await safeDm(warnedUser, makeEmbed().setTitle(`Warning #${id} removed`).setDescription(`Reason: ${reason}`));
      }
      return message.reply(`Warning #${id} was removed.`);
    }

    // warn add
    if (!mentioned) return message.reply('Usage: `.warn @member <reason>`');
    const reason = rest.join(' ');
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
    await safeDm(mentioned, makeEmbed().setTitle(`Warning #${warning.id}`).setDescription(reason));
    await logEvent(message.client, {
      title: '⚠️ Member Warned',
      description: `${mentioned} - ${mentioned.username} was warned.\n**Warning #:** ${warning.id}\n**Reason:** ${reason}\n**By:** ${message.author}`,
      user: mentioned,
      color: 0xf1c40f,
    });
    return message.reply(`Warning #${warning.id} issued to ${mentioned}.`);
  }

  // ─── ban / kick / mute / unmute (prefix) ────────────────────────────────
  if (['ban', 'kick', 'mute', 'unmute'].includes(command)) {
    if (!isStaff(message.member)) return message.reply('This command is for staff only.');
    const memberInput = args[1];
    if (!memberInput) {
      const usage = command === 'mute' ? '`.mute <member> <duration> [reason]`' : `\`.${command} <member> [reason]\``;
      return message.reply(`Usage: ${usage}`);
    }
    const member = await resolveMember(message.guild, memberInput);
    if (!member) {
      return message.reply(`Could not find a member matching **${memberInput}**. Try mentioning them, using their username, or their user ID.`);
    }
    const targetUser = member.user;
    const reason = args.slice(2).join(' ') || 'No reason provided';

    if (command === 'ban') {
      await member.ban({ reason: `Banned by ${message.author.tag}: ${reason}` });
      await safeDm(targetUser, makeEmbed().setTitle('You were banned').setDescription(`**Server:** ${message.guild.name}\n**Reason:** ${reason}`));
      await logEvent(message.client, {
        title: '🔨 Member Banned',
        description: `${targetUser} - ${targetUser.username} was banned.\n**Reason:** ${reason}\n**By:** ${message.author}`,
        user: targetUser,
        color: 0xed4245,
      });
      return message.reply(`${targetUser} was banned. Reason: ${reason}`);
    }

    if (command === 'kick') {
      await member.kick(`Kicked by ${message.author.tag}: ${reason}`);
      await safeDm(targetUser, makeEmbed().setTitle('You were kicked').setDescription(`**Server:** ${message.guild.name}\n**Reason:** ${reason}`));
      await logEvent(message.client, {
        title: '👢 Member Kicked',
        description: `${targetUser} - ${targetUser.username} was kicked.\n**Reason:** ${reason}\n**By:** ${message.author}`,
        user: targetUser,
        color: 0xe67e22,
      });
      return message.reply(`${targetUser} was kicked. Reason: ${reason}`);
    }

    if (command === 'mute') {
      const ms = parseDuration(args[2]);
      if (!ms) {
        return message.reply('Usage: `.mute <member> <duration> [reason]` — e.g. `.mute @member 2h spam`');
      }
      const muteReason = args.slice(3).join(' ') || 'No reason provided';
      await member.timeout(ms, `Muted by ${message.author.tag}: ${muteReason}`);
      const until = Date.now() + ms;
      await safeDm(targetUser, makeEmbed().setTitle('You were muted').setDescription(`**Server:** ${message.guild.name}\n**Duration:** ${formatDuration(ms)}\n**Reason:** ${muteReason}`));
      await logEvent(message.client, {
        title: '🔇 Member Muted',
        description: `${targetUser} - ${targetUser.username} was muted.\n**Duration:** ${formatDuration(ms)}\n**Until:** <t:${Math.floor(until / 1000)}:F>\n**Reason:** ${muteReason}\n**By:** ${message.author}`,
        user: targetUser,
        color: 0xed4245,
      });
      return message.reply(`${targetUser} was muted for ${formatDuration(ms)}. Reason: ${muteReason}`);
    }

    if (command === 'unmute') {
      await member.timeout(null, `Unmuted by ${message.author.tag}`);
      await safeDm(targetUser, makeEmbed().setTitle('You were unmuted').setDescription(`**Server:** ${message.guild.name}`));
      await logEvent(message.client, {
        title: '🔊 Member Unmuted',
        description: `${targetUser} - ${targetUser.username} was unmuted.\n**By:** ${message.author}`,
        user: targetUser,
        color: 0x57f287,
      });
      return message.reply(`${targetUser} was unmuted.`);
    }
  }
}

module.exports = { commandDefinitions, handleModeration, handleModerationPrefix, resolveMember };

