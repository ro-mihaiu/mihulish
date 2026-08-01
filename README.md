# mihulish

Discord bot for MIHU player-warps. Stores all bot records in `data/bot-data.json`, which is created automatically and should be kept on a persistent disk/volume when hosted on Oracle.

## Setup

1. Create a Discord application and bot, then enable the **Server Members Intent** in the Developer Portal.
2. Invite it with the `bot` and `applications.commands` scopes. Give it **Manage Roles** if `/rank change` should assign matching Discord roles.
3. Create `.env` from this configuration:

```env
DISCORD_TOKEN=your_bot_token
# Recommended while developing: commands appear immediately in this server.
DISCORD_GUILD_ID=your_server_id
# Comma-separated staff role IDs. Members with Manage Server also count as staff.
STAFF_ROLE_IDS=role_id_one,role_id_two
```

Run locally with `npm start`. The bot registers commands at start-up.

## File Structure

```
mihulish/
├── index.js                    # Client setup, event routing, command loader
├── utils.js                    # Shared helpers (data, permissions, DM, ranks)
├── data/
│   └── bot-data.json           # Persistent data store (auto-created)
└── commands/
    ├── verification.js         # /rank, /unverify, /trust, /untrust
    ├── moderation.js           # /warn, /warnings, /warns
    ├── rewards.js              # /points, /wof
    ├── shop.js                 # /item add, /remove, /restocked
    ├── subscription.js         # /subscription, /mysubscription, /session
    ├── fun.js                  # /coins, /cf
    ├── utility.js              # /gw, /update
    └── cmd.js                  # /cmd add, /remove, /list (custom tags)
```

## Commands

Both Discord slash commands (`/`) and prefix (`.`) commands work.

### Verification
- `/rank update <rank>` — sends a rank change request to staff channel
- `/rank change @member <rank>` — [staff] change a member's rank
- `/unverify @member` — [staff] completely remove from bot records
- `/trust @member <location>` — [staff] mark as trusted (DMs the member). Preset locations: `mihu-farm`, `mihu-rentals`, `mihu-shop`, `mihu-casino`, `mihu-money`, `dungeon`
- `/untrust @member <location>` — [staff] remove trust (DMs the member). Preset locations: `mihu-farm`, `mihu-rentals`, `mihu-shop`, `mihu-casino`, `mihu-money`, `dungeon`

### Moderation
- `/warn add @member <reason>` — [staff] issue a warning (DMs the member)
- `/warn remove <id> <reason>` — [staff] remove a warning (DMs the member)
- `/warnings` — view your own warnings
- `/warns @member` — [staff] view a member's warnings

### Rewards
- `/points add @member <amount>` — [staff] add reward points (max 100)
- `/points remove @member <amount>` — [staff] remove reward points
- `/points view` — view your points (DMs at full capacity)
- `/points check` — [staff] check all point balances
- `/wof` — view the Wall of Fame
- `/wof add @member` — [staff] add to Wall of Fame
- `/wof remove @member` — [staff] remove from Wall of Fame

### Shop
- `/item add <name> <bulk/individual> <price> <min_amount>` — [staff] add a shop item
- `/item remove <name>` — [staff] remove a shop item
- `/item restocked <name> <amount>` — [staff] increase item stock

### Subscriptions / Rentals
- `/subscription add @member [amount]` — [staff] add rental tokens (default 1 = ~30 days)
- `/subscription remove @member [amount]` — [staff] remove rental tokens
- `/mysubscription` — check your rental token count
- `/session add <item>` — [staff] add gear to session
- `/session remove <item>` — [staff] remove gear from session
- `/session check` — check current session status
- `/session start <hours>` — [staff] start a timed session
- `/session stop` — [staff] stop the active session
- `/session history` — view past session history

### Fun
- `/coins add @member <amount>` — [staff] add Discord coins
- `/coins remove @member <amount>` — [staff] remove Discord coins
- `/coins bal` — check your coin balance
- `/cf <bet>` — 50/50 coin flip (winnings are doubled)

### Giveaways
- `/gw start <channel> <days> <winners> <prize>` — [staff] start a giveaway
- `/gw reroll <msg_id> [winners]` — [staff] reroll giveaway winners
- `/gw end <msg_id>` — [staff] end a giveaway early

### Utility
- `/update` — [staff] force update dashboard channels

### Custom Commands
- `/cmd add <name> <content>` — [staff] add a custom command (tag). Reply with `.name` to trigger it.
- `/cmd remove <name>` — [staff] remove a custom command
- `/cmd list` — list all custom commands

## Prefix Examples

```
.rank update Samurai
.rank change @member Samurai
.unverify @member
.trust @member mihu-farm (presets: mihu-farm, mihu-rentals, mihu-shop, mihu-casino, mihu-money, dungeon)
.untrust @member mihu-farm (presets: mihu-farm, mihu-rentals, mihu-shop, mihu-casino, mihu-money, dungeon)
.warn @member broke the rules
.warn remove 4 resolved
.warnings
.warns @member
.points add @member 10
.points view
.points check
.wof
.wof add @member
.item add Diamonds bulk 100 5
.item remove Diamonds
.item restocked Diamonds 50
.subscription add @member 2
.subscription remove @member 1
.mysubscription
.session add sword
.session remove sword
.session check
.session start 3
.session stop
.session history
.coins add @member 50
.coins bal
.cf 25
.gw start #giveaways 3 1 100
.gw reroll 123456789 2
.gw end 123456789
.cmd add website Check Mihu's website at https://www.ro-mihaiu.xyz/
.cmd remove website
.cmd list
.update
.help
```

## Permissions

All [staff] commands require a configured staff role (via `STAFF_ROLE_IDS`) or the **Manage Server** permission. Warning IDs are global and never reused. Punishments and trust changes notify the affected member by DM when DMs are open.

