require('dotenv').config();
const path = require('node:path');
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const { data, makeEmbed, logoFile, logEvent, EMBED_COLOR } = require('./utils');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Command log configuration ──────────────────────────────────────────────
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const LOG_EMBED_COLOR = EMBED_COLOR;
const LOG_LOGO_PATH = path.join(__dirname, 'logo.png');
const LOG_EMBED_URL = 'attachment://logo.png';

// ─── Load command modules ───────────────────────────────────────────────────
const commandModules = [
  require('./commands/verification'),
  require('./commands/moderation'),
  require('./commands/rewards'),
  require('./commands/shop'),
  require('./commands/subscription'),
  require('./commands/fun'),
  require('./commands/utility'),
  require('./commands/cmd'),
];

const slashCommands = commandModules.flatMap((mod) => mod.commandDefinitions.map((cmd) => cmd.toJSON()));

// ─── Help embed ─────────────────────────────────────────────────────────────
function buildHelpEmbed() {
  const embed = makeEmbed()
    .setTitle('📖 Mihu Bot Commands')
    .setThumbnail(LOG_EMBED_URL)
    .setDescription('Use `[staff]` commands only if you have a staff role or the **Manage Server** permission. Prefix commands work with `.`, slash commands with `/`.');

  const categories = [
    {
      name: '📋 Verification',
      value:
        '`.rank update <rank>` — request a rank change\n' +
        '`.rank change @member <rank>` — [staff] change rank\n' +
        '`.unverify @member` — [staff] remove from bot records\n' +
        '`.trust @member <location>` — [staff] trust member\n' +
        '`.untrust @member <location>` — [staff] remove trust\n' +
        '*(presets: mihu-farm, mihu-rentals, mihu-shop, mihu-casino, mihu-money, dungeon)*'
    },
    {
      name: '🛡️ Moderation',
      value:
        '`.warn @member <reason>` — [staff] issue a warning\n' +
        '`.warn remove <id> <reason>` — [staff] remove a warning\n' +
        '`.warnings` — view your warnings\n' +
        '`.warns @member` — [staff] view member warnings\n' +
        '`.ban <member> <reason>` — [staff] ban (mention, username, or user ID)\n' +
        '`.kick <member> <reason>` — [staff] kick (mention, username, or user ID)\n' +
        '`.mute <member> <duration> <reason>` — [staff] timeout member\n' +
        '`.unmute <member>` — [staff] remove timeout'
    },
    {
      name: '⭐ Rewards',
      value:
        '`.points add|remove @member <amount>` — [staff] manage points\n' +
        '`.points view` — view your points\n' +
        '`.points check` — [staff] check all balances\n' +
        '`.wof` — view Wall of Fame\n' +
        '`.wof add|remove @member` — [staff] manage Wall of Fame'
    },
    {
      name: '🛒 Shop',
      value:
        '`.item add <name> <bulk/individual> <price> <min_amount>` — [staff] add item\n' +
        '`.item remove <name>` — [staff] remove item\n' +
        '`.item restocked <name> <amount>` — [staff] restock item'
    },
    {
      name: '📅 Subscriptions / Rentals',
      value:
        '`.subscription add @member [amount]` — [staff] add rental tokens\n' +
        '`.subscription remove @member [amount]` — [staff] remove tokens\n' +
        '`.mysubscription` — check your tokens\n' +
        '`.session add|remove <item>` — [staff] manage session gear\n' +
        '`.session check` — check session\n' +
        '`.session start <hours>` — [staff] start session\n' +
        '`.session stop` — [staff] stop session\n' +
        '`.session history` — view session history'
    },
    {
      name: '🎉 Fun',
      value:
        '`.coins add|remove @member <amount>` — [staff] manage coins\n' +
        '`.coins bal` — check your coins\n' +
        '`.cf <heads|tails> <bet>` — 50/50 coin flip (pick a side, or leave it random)\n' +
        '`.daily` — claim 50 coins every 24h\n' +
        '`.weekly` — claim 250 coins every 7 days\n' +
        '`.monthly` — claim 1000 coins every 30 days'
    },
    {
      name: '🎁 Giveaways',
      value:
        '`.gw start <#channel> <days> <winners> <prize>` — [staff] start giveaway\n' +
        '`.gw reroll <msg_id> [winners]` — [staff] reroll giveaway\n' +
        '`.gw end <msg_id>` — [staff] end giveaway'
    },
    {
      name: '🔧 Utility',
      value:
        '`.update` — [staff] update dashboards'
    },
    {
      name: '🏷️ Custom Commands',
      value:
        '`.cmd add <name> <content>` — [staff] add a custom command (tag)\n' +
        '`.cmd remove <name>` — [staff] remove a custom command\n' +
        '`.cmd list` — list custom commands\n' +
        'Trigger any saved tag with `.<name>`.'
    },
  ];

  for (const category of categories) {
    embed.addFields({ name: category.name, value: category.value, inline: false });
  }

  embed.addFields({
    name: '🔗 Links',
    value: 'Full documentation: https://bot.ro-mihaiu.xyz/commands',
    inline: false
  });

  return embed;
}

// ─── Command logging ────────────────────────────────────────────────────────
function buildSlashInput(interaction) {
  const parts = [];
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  if (group) parts.push(group);
  if (sub) parts.push(sub);
  for (const option of interaction.options.data) {
    if (option.type === 1 || option.type === 2) continue; // subcommand / group
    if (option.value === undefined) continue;
    let value = option.value;
    if (option.type === 6) value = `<@${option.value}>`;       // user
    else if (option.type === 7) value = `<#${option.value}>`;  // channel
    else if (option.type === 8) value = `<@&${option.value}>`; // role
    parts.push(`${option.name}: ${value}`);
  }
  return parts.join(', ');
}

async function logCommand({ command, input = '', user, channelName = 'Unknown', client }) {
  if (!LOG_CHANNEL_ID) return;
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!logChannel?.isTextBased()) return;

    const description = [
      `**Command:** \`${command}\`${input ? ` [${input}]` : ''}`,
      `**User:** ${user} - ${user.username}`,
      `**Channel:** ${channelName}`,
      `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`,
    ].join('\n');

    const embed = makeEmbed()
      .setTitle('📜 Command Log')
      .setDescription(description)
      .setThumbnail(LOG_EMBED_URL)
      .setTimestamp();

    await logChannel.send({
      embeds: [embed],
      files: logoFile(),
    });
  } catch (error) {
    console.error('Failed to log command:', error);
  }
}

// ─── Ready event: register commands + status ───────────────────────────────
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: 'Mihu\'s community', type: ActivityType.Watching }],
    status: 'online',
  });
  try {
    const guild = process.env.DISCORD_GUILD_ID ? await client.guilds.fetch(process.env.DISCORD_GUILD_ID) : null;
    await (guild ? guild.commands : client.application.commands).set(slashCommands);
    console.log(`Registered ${slashCommands.length} application commands ${guild ? `in ${guild.name}` : 'globally'}.`);
  } catch (error) {
    console.error('Could not register commands:', error);
  }
});

// ─── Member / moderation event logging ─────────────────────────────────────
client.on('guildMemberAdd', (member) => {
  logEvent(member.client, {
    title: '📥 Member Joined',
    description: `${member} - ${member.user.username} joined the server.\n**Account created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
    user: member.user,
  });
});

client.on('guildMemberRemove', (member) => {
  logEvent(member.client, {
    title: '📤 Member Left',
    description: `${member} - ${member.user.username} left the server.`,
    user: member.user,
  });
});

client.on('guildBanAdd', (ban) => {
  logEvent(ban.client, {
    title: '🔨 Member Banned',
    description: `${ban.user} - ${ban.user.username} was banned.\n**Reason:** ${ban.reason || 'No reason provided'}`,
    user: ban.user,
  });
});

client.on('guildBanRemove', (ban) => {
  logEvent(ban.client, {
    title: '🔓 Member Unbanned',
    description: `${ban.user} - ${ban.user.username} was unbanned.`,
    user: ban.user,
  });
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
  if (!oldMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp) {
    const until = newMember.communicationDisabledUntilTimestamp;
    logEvent(newMember.client, {
      title: '🔇 Member Muted (Timeout)',
      description: `${newMember} - ${newMember.user.username} was muted.\n**Until:** <t:${Math.floor(until / 1000)}:F> (<t:${Math.floor(until / 1000)}:R>)`,
      user: newMember.user,
    });
  } else if (oldMember.communicationDisabledUntilTimestamp && !newMember.communicationDisabledUntilTimestamp) {
    logEvent(newMember.client, {
      title: '🔊 Member Unmuted',
      description: `${newMember} - ${newMember.user.username} was unmuted.`,
      user: newMember.user,
    });
  }
});

// ─── Slash command handler ──────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;

  try {
    const { commandName } = interaction;

    // Log every slash command used
    await logCommand({
      command: `/${commandName}`,
      input: buildSlashInput(interaction),
      user: interaction.user,
      channelName: interaction.channel?.name,
      client: interaction.client,
    });

    // Route to the correct module handler
    const handlerMap = {
      verify: 'handleVerify',
      rank: 'handleVerification',
      unverify: 'handleVerification',
      trust: 'handleVerification',
      untrust: 'handleVerification',
      warn: 'handleModeration',
      warnings: 'handleModeration',
      warns: 'handleModeration',
      ban: 'handleModeration',
      kick: 'handleModeration',
      mute: 'handleModeration',
      unmute: 'handleModeration',
      points: 'handleRewards',
      wof: 'handleRewards',
      item: 'handleShop',
      subscription: 'handleSubscription',
      mysubscription: 'handleSubscription',
      session: 'handleSession',
      coins: 'handleFun',
      cf: 'handleFun',
      daily: 'handleFun',
      weekly: 'handleFun',
      monthly: 'handleFun',
      gw: 'handleGiveaway',
      update: 'handleUpdate',
      cmd: 'handleCmd',
    };

    const handlerName = handlerMap[commandName];
    if (!handlerName) {
      return interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }

    // Find the module that has this handler function
    for (const mod of commandModules) {
      if (typeof mod[handlerName] === 'function') {
        await mod[handlerName](interaction);
        return;
      }
    }

    return interaction.reply({ content: 'Command handler not found.', ephemeral: true });
  } catch (error) {
    console.error('Interaction error:', error);
    const reply = { content: 'Something went wrong while processing that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply);
    else await interaction.reply(reply);
  }
});

// ─── Prefix command handler ─────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.inGuild() || !message.content.startsWith('.')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args[0]?.toLowerCase();

  if (!command) return;

  // Log every prefix command used (including .help and custom tags)
  await logCommand({
    command: `.${command}`,
    input: args.slice(1).join(' '),
    user: message.author,
    channelName: message.channel?.name,
    client: message.client,
  });

  // Help command
  if (command === 'help') return message.reply({ embeds: [buildHelpEmbed()] });

  try {
    // Route to prefix handlers
    const prefixHandlerMap = {
      verify: 'handleVerifyPrefix',
      rank: 'handleVerificationPrefix',
      unverify: 'handleVerificationPrefix',
      trust: 'handleVerificationPrefix',
      untrust: 'handleVerificationPrefix',
      warn: 'handleModerationPrefix',
      warnings: 'handleModerationPrefix',
      warns: 'handleModerationPrefix',
      ban: 'handleModerationPrefix',
      kick: 'handleModerationPrefix',
      mute: 'handleModerationPrefix',
      unmute: 'handleModerationPrefix',
      points: 'handleRewardsPrefix',
      wof: 'handleRewardsPrefix',
      item: 'handleShopPrefix',
      subscription: 'handleSubscriptionPrefix',
      mysubscription: 'handleSubscriptionPrefix',
      session: 'handleSubscriptionPrefix',
      coins: 'handleFunPrefix',
      cf: 'handleFunPrefix',
      daily: 'handleFunPrefix',
      weekly: 'handleFunPrefix',
      monthly: 'handleFunPrefix',
      gw: 'handleGWPrefix',
      update: 'handleGWPrefix',
      cmd: 'handleCmdPrefix',
    };

    const handlerName = prefixHandlerMap[command];
    if (handlerName) {
      for (const mod of commandModules) {
        if (typeof mod[handlerName] === 'function') {
          await mod[handlerName](message, args);
          return;
        }
      }
    }

    // Custom command (tag) lookup — e.g. `.website` created via `.cmd add website ...`
    const custom = data.customCommands?.[command];
    if (custom) {
      return message.reply(custom.content);
    }
  } catch (error) {
    console.error('Prefix command error:', error);
    return message.reply('Something went wrong while processing that command.');
  }
});

// ─── Login ──────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);

