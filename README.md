# mihulish

Discord bot for MIHU player-warps. It stores all bot records in `data/bot-data.json`, which is created automatically and should be kept on a persistent disk/volume when hosted on Oracle.

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

Run locally with `npm start`. The bot registers commands at start-up. With no `DISCORD_GUILD_ID`, commands are global and Discord may take up to an hour to show them. Rank choices follow the hierarchy from the supplied manual; when the bot has Manage Roles, a rank change removes the member's other rank roles and adds the selected matching role.

## Commands

Add these commands to the bot: /item add <name> <bulk/individual> <price> <min_amount>, /item remove <name>, /item restocked <name> <amount>, /subscription add @member [amount], /subscription remove @member [amount], /mysubscription, /session add <item>, /session remove <item>, /session check, /session start <hours>, /session stop, /session history, /coins add @member <amount>, /coins remove @member <amount>, /coins bal, /cf <bet>, /gw start <channel> <days> <winners> <prize>, /gw reroll <msg_id> [winners], /gw end <msg_id>, /update, /item list, /subscription list, /coins leaderboard, /session leaderboard, /gw list

Both Discord slash commands and `.` prefix commands work. For example, `/points add` and `.points add @member 10` do the same thing. Enable the **Message Content Intent** in the Discord Developer Portal for prefix commands.

- `/rank update <rank>` sends an embed request to the configured staff channel.
- `/rank change`, `/unverify`, `/trust`, `/untrust`
- `/warn add`, `/warn remove`, `/warnings`, `/warns`
- `/points add`, `/points remove`, `/points view`, `/points check`
- `/wof view`, `/wof add`, `/wof remove`
- `/item add <name> <bulk/individual> <price> <min_amount>`
- `/item remove <name>`
- `/item restocked <name> <amount>`
- `/subscription add @member [amount]`
- `/subscription remove @member [amount]`
- `/mysubscription`
- `/session add <item>`
- `/session remove <item>`
- `/session check`
- `/session start <hours>`
- `/session stop`
- `/session history`
- `/coins add @member <amount>`
- `/coins remove @member <amount>`
- `/coins bal`
- `/cf <bet>`
- `/gw start <channel> <days> <winners> <prize>`
- `/gw reroll <msg_id> [winners]`
- `/gw end <msg_id>`

Prefix examples: `.rank update Samurai`, `.rank change @member Samurai`, `.warn @member reason`, `.warn remove 12 reason`, `.warnings`, `.points view`, `.item add`, `.item remove`, `.item restocked`, `.subscription add`, `.subscription remove`, `.mysubscription`, `.session add`, `.session remove`, `.session check`, `.session start`, `.session stop`, `.session history`, `.coins add`, `.coins remove`, `.coins bal`, `.cf`, `.gw start`, `.gw reroll`, `.gw end`, and `.wof`.

All staff actions require a configured staff role or the Discord **Manage Server** permission. Warning IDs are global and never reused. Warnings and trust changes notify the affected member by DM when their DMs are open.
