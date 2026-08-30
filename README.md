# Mihulish

Mihulish is a multi-guild Discord utility and staff bot with a dark terminal-inspired identity and `#e91e63` accent.

## Status

The fresh implementation currently includes the foundation, guild-scoped SQLite storage, slash-command metadata, `/help`, LOA, SLOA, warnings, moderation actions, staff registration, expertise tag commands, and ticket claim command surface. Full prefix command support is available alongside slash commands.

Ticket channels are intended to be recognized only inside each guild's configured Support category. Initial panel prefixes are `java`, `br`, `bug`, `report`, and `partnership`. Assignment is deliberately command-driven: staff use `/claim`, `/transfer`, or `/unclaim`. The final channel parsing and assignment persistence should be completed before production deployment.

## Setup

Requires Node.js 22.5 or newer. Copy `.env.example` to `.env` and set `DISCORD_TOKEN` and `CLIENT_ID`. Use `DISCORD_GUILD_ID` only as an optional development shortcut for registering commands in one guild; leave it empty for global command registration when running on multiple servers. Run `npm install`, then `npm start`.

The database is SQLite at `DATABASE_URL` (default `data/mihulish.db`) and is created automatically. Never commit `.env` or the `data` directory.

## Per-guild settings

Server administrators configure each guild independently with `/settings`:

```text
/settings mute_role:@Muted support_category:#Support manager_role:@Managers log_channel:#mod-logs
```

Run `/settings` without options to view the current guild settings. These values are stored by guild ID in SQLite, so the same bot process can serve unrelated servers with different roles, channels, and ticket categories. The matching environment variables are deployment defaults only; guild settings take precedence.

## Discord Developer Portal intents

Enable **Server Members Intent** under the bot's privileged gateway intents. Mihulish uses member data for staff management, role checks, moderation target checks, and ticket-user resolution.

Do **not** enable **Presence Intent**. Mihulish does not read member presence or online status.

Enable **Message Content Intent** if you want to use the optional text-command interface. Mihulish uses `m.` by default, and each server can change its prefix with `/settings prefix:<prefix>`.

Prefix commands require both **Message Content Intent** and the normal `GuildMessages` intent. The code ignores bot messages, direct messages, and messages that do not start with the current guild prefix. If you prefer slash commands only, disable Message Content Intent and remove `GatewayIntentBits.MessageContent` from the client configuration.

The bot requests these gateway intents in code:

- `Guilds` — guild, command, channel, and interaction events
- `GuildMembers` — member and role-related events/lookups
- `GuildModeration` — moderation-related events
- `GuildMessages` — delivers message-create events for the optional prefix interface
- `MessageContent` — allows the bot to read prefixed message content for command parsing
  For the moderation features, invite Mihulish with the Discord permissions it needs, including `View Channel`, `Send Messages`, `Manage Roles` for role-based staff/mute features, `Kick Members`, `Ban Members`, and `Moderate Members` as applicable.

## Permissions

Discord permissions are declared on moderation commands and checked again at execution. Staff and manager access is guild-specific. `/settings` is administrator-only. `MUTE_ROLE_ID`, `SUPPORT_CATEGORY_ID`, and `MANAGER_ROLE_ID` remain optional deployment defaults for initial configuration; they are not shared guild configuration.

## Ticket policy

`/claim` and `/transfer` will notify the ticket creator and the claiming/receiving staff member using direct mentions, not an embed. TT.BOT API access is not required for channel recognition. No undocumented TT.BOT behavior is used.
