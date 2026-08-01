require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { data, isStaff } = require('./utils');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

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

// ─── Prefix help text ───────────────────────────────────────────────────────
const PREFIX_HELP =
  'Available prefix commands:\n' +
  '• `.verify <in-game-user> <rank>` — verify yourself (sets nickname `🌸 in-game-user`)\n' +
  '• `.rank update <rank>` — request a rank change\n' +
  '• `.rank change @member <rank>` — [staff] change rank\n' +
  '• `.unverify @member` — [staff] remove from bot records\n' +
  '• `.trust @member <location>` / `.untrust @member <location>` — [staff] manage trust (presets: mihu-farm, mihu-rentals, mihu-shop, mihu-casino, mihu-money, dungeon)\n' +
  '• `.warn @member <reason>` — [staff] issue a warning\n' +
  '• `.warn remove <id> <reason>` — [staff] remove a warning\n' +
  '• `.warnings` — view your warnings\n' +
  '• `.warns @member` — [staff] view member warnings\n' +
  '• `.points add|remove @member <amount>` — [staff] manage points\n' +
  '• `.points view` — view your points\n' +
  '• `.points check` — [staff] check all balances\n' +
  '• `.wof` / `.wof add|remove @member` — Wall of Fame\n' +
  '• `.item add <name> <bulk/individual> <price> <min_amount>` — [staff] add item\n' +
  '• `.item remove <name>` — [staff] remove item\n' +
  '• `.item restocked <name> <amount>` — [staff] restock item\n' +
  '• `.subscription add @member [amount]` — [staff] add subscription tokens\n' +
  '• `.subscription remove @member [amount]` — [staff] remove tokens\n' +
  '• `.mysubscription` — check your tokens\n' +
  '• `.session add|remove <item>` — [staff] manage session gear\n' +
  '• `.session check` — check session\n' +
  '• `.session start <hours>` — [staff] start session\n' +
  '• `.session stop` — [staff] stop session\n' +
  '• `.session history` — view session history\n' +
  '• `.coins add|remove @member <amount>` — [staff] manage coins\n' +
  '• `.coins bal` — check your coins\n' +
  '• `.cf <bet>` — coin flip\n' +
  '• `.gw start <#channel> <days> <winners> <prize>` — [staff] start giveaway\n' +
  '• `.gw reroll <msg_id> [winners]` — [staff] reroll giveaway\n' +
  '• `.gw end <msg_id>` — [staff] end giveaway\n' +
  '• `.update` — [staff] update dashboards\n' +
  '• `.cmd add <name> <content>` — [staff] add a custom command (tag)\n' +
  '• `.cmd remove <name>` — [staff] remove a custom command\n' +
  '• `.cmd list` — list custom commands\n' +
  '• `.help` — show this message';

// ─── Ready event: register commands ─────────────────────────────────────────
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const guild = process.env.DISCORD_GUILD_ID ? await client.guilds.fetch(process.env.DISCORD_GUILD_ID) : null;
    await (guild ? guild.commands : client.application.commands).set(slashCommands);
    console.log(`Registered ${slashCommands.length} application commands ${guild ? `in ${guild.name}` : 'globally'}.`);
  } catch (error) {
    console.error('Could not register commands:', error);
  }
});

// ─── Slash command handler ──────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;

  try {
    const { commandName } = interaction;

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
      points: 'handleRewards',
      wof: 'handleRewards',
      item: 'handleShop',
      subscription: 'handleSubscription',
      mysubscription: 'handleSubscription',
      session: 'handleSession',
      coins: 'handleFun',
      cf: 'handleFun',
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

  // Help command
  if (command === 'help') return message.reply(PREFIX_HELP);

  // Staff-requiring prefix commands
  const staffRequired = ['rank', 'unverify', 'trust', 'untrust', 'warn', 'warns', 'points', 'wof', 'item', 'subscription', 'session', 'coins', 'gw', 'update'];
  if (staffRequired.includes(command) && !isStaff(message.member)) {
    // warn is an exception — warn add is staff, warn remove is staff, but warn by itself could be... no, all warn subcommands are staff
    // points view/check are special — view is self, check is staff. Let sub-handlers deal with it.
    // Actually, let's check: rank update is NOT staff, rank change IS staff. So we can't blanket block.
    // We'll let each handler deal with permissions internally and just route.
  }

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
      points: 'handleRewardsPrefix',
      wof: 'handleRewardsPrefix',
      item: 'handleShopPrefix',
      subscription: 'handleSubscriptionPrefix',
      mysubscription: 'handleSubscriptionPrefix',
      session: 'handleSubscriptionPrefix',
      coins: 'handleFunPrefix',
      cf: 'handleFunPrefix',
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

