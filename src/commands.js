const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const { AttachmentBuilder } = require("discord.js");
const store = require("./database");
const { makeEmbed, logCommand, logEvent, logModeration, sendDM, fetchVideoTitle } = require("./utils");
const COLOR = 0xe91e63;
const DOCS = "https://mihulish.ro-mihaiu.xyz";
const metadata = [];
const commands = [];
function add(builder, category, permission, execute) {
  const data = builder.toJSON();
  metadata.push({
    name: data.name,
    description: data.description,
    category,
    permission,
    usage: `/${data.name}`,
  });
  commands.push({ data: builder, execute });
}
function embed(title, description, color = COLOR) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(String(title ?? "Mihulish"))
    .setDescription(String(description ?? "No details provided."));
}

function normalizeResponse(payload) {
  const response = { ...payload };
  if (!response.components) return response;
  const embeds = response.components.filter((component) => component instanceof EmbedBuilder);
  const components = response.components.filter((component) => !(component instanceof EmbedBuilder));
  delete response.components;
  if (embeds.length) response.embeds = [...(response.embeds || []), ...embeds];
  if (components.length) response.components = components;
  return response;
}
function isBotOwner(userId, client = null) {
  if (!userId) return false;
  if (process.env.OWNER_ID && userId === process.env.OWNER_ID) return true;
  if (process.env.BOT_OWNER_ID && userId === process.env.BOT_OWNER_ID) return true;
  if (client?.application?.owner) {
    const owner = client.application.owner;
    if (owner.id === userId) return true;
    if (owner.members && owner.members.has(userId)) return true;
    if (owner.ownerId === userId) return true;
  }
  return false;
}
function staffCheck(guildId, member, client = null) {
  if (!member) return false;
  if (isBotOwner(member.id, client || member.client)) return true;
  return (
    store.isStaff(guildId, member.id) ||
    member.permissions?.has(PermissionFlagsBits.Administrator)
  );
}
function managerCheck(guildId, member, client = null) {
  if (!member) return false;
  if (isBotOwner(member.id, client || member.client)) return true;
  const s = store.settings(guildId);
  return (
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    (Boolean(s.manager_role_id) && Boolean(member.roles?.cache?.has(s.manager_role_id)))
  );
}
function staff(i) {
  return isBotOwner(i.user?.id, i.client) || staffCheck(i.guildId, i.member, i.client);
}
function manager(i) {
  return isBotOwner(i.user?.id, i.client) || managerCheck(i.guildId, i.member, i.client);
}
function respond(i, payload) {
  const response = normalizeResponse(payload);
  if (i.deferred) return i.editReply(response);
  if (i.replied) return i.followUp(response);
  return i.reply(response);
}

function deny(i, text = "You must be configured staff to use this command.") {
  return respond(i, { content: text, ephemeral: true });
}
function target(i, name = "user") {
  return i.options.getMember(name) || i.options.getUser(name);
}
function stamp(t) {
  return `<t:${Math.floor(t / 1000)}:f>`;
}
function staffStatusLine(row) {
  let status = "";
  let details = "";
  if (row.loa_active) {
    status = "LOA";
    details = row.loa_ends_at
      ? `${Math.max(1, Math.ceil((row.loa_ends_at - Date.now()) / 86400000))} days`
      : "ongoing";
    if (row.loa_reason) details += ` · ${row.loa_reason}`;
  } else if (row.sloa_active) {
    status = "SLOA";
    details = row.sloa_availability || row.sloa_reason || "ongoing";
    if (row.sloa_reason && row.sloa_reason !== details) details += ` · ${row.sloa_reason}`;
  }
  return `<@${row.user_id}> — \`${status}\`${details ? ` — ${details}` : ""}`;
}
// Display-order rank for imported role names when no live Discord role is mapped.
const ROLE_NAME_RANK = [
  "TheySix", "Manager", "Admin", "Head Moderator", "Moderator", "Helper Team",
];
function roleNameRank(name) {
  const idx = ROLE_NAME_RANK.indexOf(name);
  return idx === -1 ? -1 : ROLE_NAME_RANK.length - idx;
}
async function buildStaffDirectory(guild) {
  const rows = store.listStaffStatuses(guild.id);
  if (!rows.length) return embed("Configured staff", "No staff configured.");

  const members = await Promise.all(
    rows.map(async (row) => [row, await guild.members.fetch(row.user_id).catch(() => null)]),
  );
  const grouped = new Map();
  for (const [row, member] of members) {
    const role = row.role_id ? guild.roles.cache.get(row.role_id) : null;
    // Imported rosters keep their role_name hierarchy even when role_id maps to
    // a generic role (e.g. the shared Staff role).
    const rank = roleNameRank(row.role_name);
    const roleName = row.role_name || role?.name || "No role";
    const position = rank >= 0 ? rank : role?.position || 0;
    const tags = store.userTags(guild.id, row.user_id).map((tag) => tag.display_name);
    const status = row.loa_active ? "LOA" : row.sloa_active ? "SLOA" : "";
    const username = member?.user.username || `Unknown user (${row.user_id})`;
    const mention = `<@${row.user_id}>`;
    const line = `${mention} (${username})${status ? ` - **${status}**` : ""}\n> ${tags.length ? tags.join(", ") : "No tags"}`;
    if (!grouped.has(roleName)) grouped.set(roleName, { position, lines: [] });
    grouped.get(roleName).lines.push(line);
  }

  const description = [...grouped.entries()]
    .sort(([, a], [, b]) => b.position - a.position)
    .map(([roleName, group]) => `### ${roleName}\n${group.lines.join("\n")}`)
    .join("\n\n")
    .slice(0, 4096);
  const updatedAt = store.getStaffDirectoryUpdatedAt(guild.id);
  const directory = embed("Configured staff", description);
  if (updatedAt) directory.setFooter({ text: `Last updated ${stamp(updatedAt)}` });
  return directory;
}
async function setLeaveNickname(member, guild, type, active) {
  if (!member || !guild) return null;
  const prefix = type === "loa" ? "LOA" : "SLOA";
  if (active) {
    try {
      if (member.id === guild.ownerId) {
        return "Cannot rename the server owner.";
      }
      if (
        guild.members.me &&
        member.roles.highest.position >= guild.members.me.roles.highest.position
      ) {
        return "Cannot rename a member with an equal or higher role than the bot.";
      }
      const originalNick = member.nickname || member.user.username;
      store.saveOriginalNickname(guild.id, member.id, originalNick);
      await member.setNickname(`${prefix} | ${member.user.username}`);
      return null;
    } catch (e) {
      if (e.code === 50013) {
        return "Missing permission to rename members. Ensure the bot has Manage Nicknames permission.";
      }
      return `Failed to rename: ${e.message}`;
    }
  } else {
    try {
      const originalNick = store.getOriginalNickname(guild.id, member.id);
      store.deleteOriginalNickname(guild.id, member.id);
      if (originalNick) {
        await member.setNickname(originalNick);
      } else {
        await member.setNickname(null);
      }
      return null;
    } catch (e) {
      if (e.code === 50013) {
        return "Missing permission to rename members. Ensure the bot has Manage Nicknames permission.";
      }
      return `Failed to restore nickname: ${e.message}`;
    }
  }
}

function buildHelpEmbed(prefix = "m.") {
  const helpEmbed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Mihulish - Commands")
    .setDescription(
      "A dark, terminal-inspired Discord utility bot for moderation, staff management, tickets, and LOA/SLOA.\n\n" +
      `Commands can be used via slash commands (\`/command\`) or server prefix (\`${prefix}command\`).\n` +
      `Server prefix: \`${prefix}\``,
    );

  const categories = [
    {
      name: "🛡️ Moderation",
      cmds: [
        { name: "warn", desc: "Warn a member with a reason" },
        { name: "unwarn", desc: "Remove a warning from a member" },
        { name: "warns", desc: "View warning history for a member" },
        { name: "warnings", desc: "View recent server-wide warnings" },
        { name: "mute", desc: "Timeout a member for specified minutes" },
        { name: "unmute", desc: "Remove timeout from a member" },
        { name: "kick", desc: "Kick a member from the server" },
        { name: "ban", desc: "Ban a member from the server" },
        { name: "unban", desc: "Unban a user from the server" },
        { name: "softban", desc: "Softban a member (ban and prune messages)" },
        { name: "bans", desc: "List active server bans" },
      ],
    },
    {
      name: "📋 Staff & Leave",
      cmds: [
        { name: "staff", desc: "List or manage configured staff members" },
        { name: "loa", desc: "Manage leave of absence status, rules, or list" },
        { name: "sloa", desc: "Manage semi leave of absence status, rules, or list" },
        { name: "tag", desc: "Manage staff expertise tags and assignments" },
      ],
    },
    {
      name: "🎫 Tickets",
      cmds: [
        { name: "claim", desc: "Claim the current support ticket" },
        { name: "transfer", desc: "Transfer ticket to another staff member" },
        { name: "unclaim", desc: "Release claim on the current ticket" },
      ],
    },
    {
      name: "⚙️ Utility & Settings",
      cmds: [
        { name: "help", desc: "Learn about Mihulish and show all commands" },
        { name: "update", desc: "Show the latest Mihulish changes" },
        { name: "prefix", desc: "Check current server prefix" },
        { name: "settings", desc: "View or configure server roles, channels, and prefix" },
        { name: "link", desc: "Set an appeal link" },
        { name: "sticky", desc: "Manage a sticky message in a channel" },
        { name: "invite", desc: "Get the bot invite link" },
        { name: "vote", desc: "Vote for this server and grow the streak" },
        { name: "votes", desc: "View the server vote streak" },
      ],
    },
  ];

  for (const cat of categories) {
    const value = cat.cmds
      .map((c) => `\`${c.name}\` — ${c.desc}`)
      .join("\n");
    helpEmbed.addFields({
      name: cat.name,
      value: value || "None",
    });
  }

  return helpEmbed;
}

function buildHelpRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Documentation")
      .setStyle(ButtonStyle.Link)
      .setURL(DOCS),
  );
}

function buildUpdateEmbed() {
  const update = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "updates", "latest.json"), "utf8"),
  );
  const changes = update.changes.map((change, index) => `${index + 1}. ${change}`).join("\n");
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle("Mihulish - Latest Changes")
    .setDescription(changes || "No changes have been published yet.")
    .setFooter({ text: `${update.date} - ${update.version}` });
}

add(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Learn about Mihulish and view all commands"),
  "Utility",
  "Everyone",
  (i) => {
    const p = store.getPrefix(i.guildId);
    return respond(i, {
      components: [buildHelpEmbed(p), buildHelpRow()],
    });
  },
);
add(
  new SlashCommandBuilder()
    .setName("update")
    .setDescription("Show the latest Mihulish changes"),
  "Utility",
  "Everyone",
  (i) => respond(i, { components: [buildUpdateEmbed()] }),
);
const invite = new SlashCommandBuilder()
  .setName("invite")
  .setDescription("Get the bot invite link");
add(invite, "Utility", "Everyone", async (i) => {
  return respond(i, {
    components: [
      embed("Invite Mihulish", "Click the link below to invite me to your server.\nhttps://invite.ro-mihaiu.xyz"),
    ],
  });
});
const vote = new SlashCommandBuilder()
  .setName("vote")
  .setDescription("Vote for this server");
add(vote, "Utility", "Everyone", async (i) => {
  const result = store.vote(i.guildId, i.user.id);
  if (!result.ok) {
    return respond(i, {
      components: [
        embed("Vote cooldown", `You can vote again in **${result.remainingMinutes}** minute(s).\nCurrent streak: **${result.streak}** 🔥`),
      ],
      ephemeral: true,
    });
  }
  const desc = [];
  desc.push(`**Your vote** has been recorded!`);
  desc.push(`**Server streak:** **${result.streak}** 🔥`);
  if (result.isNewStreak) desc.push("*(streak reset — votes had expired)*");
  if (result.prevVoterId && result.prevVoterId !== i.user.id) {
    desc.push(`Last vote by <@${result.prevVoterId}>`);
  }
  return respond(i, {
    components: [embed("Vote recorded", desc.join("\n"))],
  });
});
const votes = new SlashCommandBuilder()
  .setName("votes")
  .setDescription("View the server vote streak");
add(votes, "Utility", "Everyone", async (i) => {
  const v = store.getVotes(i.guildId);
  const desc = [];
  desc.push(`**Current streak:** **${v.streak}** 🔥`);
  if (v.lastVoterId) {
    desc.push(`Last vote by <@${v.lastVoterId}>`);
    desc.push(`<t:${Math.floor(v.lastVoteAt / 1000)}:R>`);
  } else {
    desc.push("No votes yet — use `/vote` to start the streak!");
  }
  return respond(i, {
    components: [embed("Server vote streak", desc.join("\n"))],
  });
});
const loa = new SlashCommandBuilder()
  .setName("loa")
  .setDescription("Manage leave of absence")
  .addSubcommand((s) => s.setName("rules").setDescription("Show LOA rules"))
  .addSubcommand((s) =>
    s
      .setName("status")
      .setDescription("Set your LOA status")
      .addBooleanOption((o) =>
        o
          .setName("active")
          .setDescription("Whether you are available")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("reason")
          .setDescription("Reason")
          .setRequired(true)
                  .setMaxLength(500),
              )
              .addIntegerOption((o) =>
                o.setName("ends_in_days").setDescription("Optional duration in days"),
              )
              .addUserOption((o) => o.setName("user").setDescription("Staff member (managers only)")),
          )
          .addSubcommand((s) =>
            s
              .setName("check")
      .setDescription("Check LOA")
      .addUserOption((o) => o.setName("user").setDescription("Staff member")),
  )
  .addSubcommand((s) => s.setName("list").setDescription("List active LOA"));
add(loa, "LOA", "Staff", async (i) => {
  if (!staff(i)) return deny(i);
  const s = i.options.getSubcommand();
  if (s === "rules")
    return respond(i, {
      components: [
        embed(
          "LOA rules",
          "Use LOA when fully unavailable. Give a clear reason and an optional end date. Return to active status when available again.",
        ),
      ],
    });
  if (s === "status") {
    const a = i.options.getBoolean("active"),
      r = i.options.getString("reason"),
      d = i.options.getInteger("ends_in_days"),
      targetUser = i.options.getUser("user") || i.user;
    if (targetUser.id !== i.user.id && !manager(i))
      return deny(i, "Only managers can set LOA for other staff members.");
    const targetMember = targetUser.id === i.user.id ? i.member : await i.guild.members.fetch(targetUser.id).catch(() => null);
    if (!store.isStaff(i.guildId, targetUser.id))
      return deny(i, "The target user must be registered staff.");
    store.setLeave(
      "loa",
      i.guildId,
      targetUser.id,
      a,
      r,
      null,
      d ? Date.now() + d * 86400000 : null,
    );
    const nickError = await setLeaveNickname(targetMember, i.guild, "loa", a);
    const embedText = nickError
      ? `${targetUser} — ${r}\n⚠️ ${nickError}`
      : `${targetUser} — ${r}`;
    return respond(i, {
      components: [embed(a ? "LOA active" : "LOA removed", embedText)],
    });
  }
  let rows =
    s === "list"
      ? store.listLeave("loa", i.guildId)
      : [
          store.getLeave(
            "loa",
            i.guildId,
            (i.options.getUser("user") || i.user).id,
          ),
        ].filter(Boolean);
  return respond(i, {
    components: [
      embed(
        "LOA status",
        rows.length
          ? rows
              .map(
                (x) =>
                  `<@${x.user_id}> — ${x.reason} · since ${stamp(x.started_at)}${x.ends_at ? ` · ends ${stamp(x.ends_at)}` : ""}`,
              )
              .join("\n")
          : "No active LOA records.",
      ),
    ],
  });
});
const sloa = new SlashCommandBuilder()
  .setName("sloa")
  .setDescription("Manage semi leave of absence")
  .addSubcommand((s) => s.setName("rules").setDescription("Show SLOA rules"))
  .addSubcommand((s) =>
    s
      .setName("status")
      .setDescription("Set your SLOA status")
      .addBooleanOption((o) =>
        o
          .setName("active")
          .setDescription("Whether SLOA is active")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("reason").setDescription("Reason").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("availability")
          .setDescription("When you are available")
                  .setRequired(true),
              )
              .addIntegerOption((o) =>
                o.setName("ends_in_days").setDescription("Optional duration in days"),
              )
              .addUserOption((o) => o.setName("user").setDescription("Staff member (managers only)")),
          )
          .addSubcommand((s) =>
            s
              .setName("check")
      .setDescription("Check SLOA")
      .addUserOption((o) => o.setName("user").setDescription("Staff member")),
  )
  .addSubcommand((s) => s.setName("list").setDescription("List active SLOA"));
add(sloa, "SLOA", "Staff", async (i) => {
  if (!staff(i)) return deny(i);
  const s = i.options.getSubcommand();
  if (s === "rules")
    return respond(i, {
      components: [
        embed(
          "SLOA rules",
          "Use SLOA when partially available. Describe your availability clearly and keep it updated.",
        ),
      ],
    });
  if (s === "status") {
    const a = i.options.getBoolean("active"),
      d = i.options.getInteger("ends_in_days"),
      targetUser = i.options.getUser("user") || i.user;
    if (targetUser.id !== i.user.id && !manager(i))
      return deny(i, "Only managers can set SLOA for other staff members.");
    const targetMember = targetUser.id === i.user.id ? i.member : await i.guild.members.fetch(targetUser.id).catch(() => null);
    if (!store.isStaff(i.guildId, targetUser.id))
      return deny(i, "The target user must be registered staff.");
    store.setLeave(
      "sloa",
      i.guildId,
      targetUser.id,
      a,
      i.options.getString("reason"),
      i.options.getString("availability"),
      d ? Date.now() + d * 86400000 : null,
    );
    const nickError = await setLeaveNickname(targetMember, i.guild, "sloa", a);
    const embedText = nickError
      ? `${targetUser} — ${i.options.getString("availability")}\n⚠️ ${nickError}`
      : `${targetUser} — ${i.options.getString("availability")}`;
    return respond(i, {
      components: [
        embed(
          a ? "SLOA active" : "SLOA removed",
          embedText,
        ),
      ],
    });
  }
  const rows =
    s === "list"
      ? store.listLeave("sloa", i.guildId)
      : [
          store.getLeave(
            "sloa",
            i.guildId,
            (i.options.getUser("user") || i.user).id,
          ),
        ].filter(Boolean);
  return respond(i, {
    components: [
      embed(
        "SLOA status",
        rows.length
          ? rows
              .map((x) => `<@${x.user_id}> — ${x.reason} · ${x.availability}`)
              .join("\n")
          : "No active SLOA records.",
      ),
    ],
  });
});

add(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("reason")
        .setDescription("Reason")
        .setRequired(true)
        .setMaxLength(1000),
    ),
  "Moderation",
  "Moderate Members",
  async (i) => {
    if (
      !i.memberPermissions.has(PermissionFlagsBits.ModerateMembers) &&
      !isBotOwner(i.user.id, i.client)
    )
      return deny(i, "You need Moderate Members.");
    const u = target(i),
      r = i.options.getString("reason");
    const w = store.addWarning(i.guildId, u.id, i.user.id, r);
    logModeration(i.guildId, i.client, {
      action: "warn",
      targetId: u.id,
      moderatorId: i.user.id,
      reason: r,
    });
    sendDM(i.user.id, i.client, "Warning Issued", `You issued warning **#${w.id}** to <@${u.id}> in **${i.guild.name}**.\nReason: ${r}`).catch(() => {});
    const appealLink = store.getAppealLink(i.guildId);
    const modDesc = `You received warning **#${w.id}** in **${i.guild.name}**.\nReason: ${r}${appealLink ? `\nAppeal: ${appealLink}` : ""}`;
    sendDM(u.id, i.client, "Warning Received", modDesc).catch(() => {});
    return respond(i, {
      components: [
        embed(
          "Warning issued",
          `${u} received warning **#${w.id}**.\nReason: ${r}`,
        ),
      ],
    });
  },
);
add(
  new SlashCommandBuilder()
    .setName("unwarn")
    .setDescription("Remove a warning from a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName("id")
        .setDescription("Warning ID")
        .setRequired(true)
        .setMinValue(1),
    ),
  "Moderation",
  "Moderate Members",
  async (i) => {
    if (
      !i.memberPermissions.has(PermissionFlagsBits.ModerateMembers) &&
      !isBotOwner(i.user.id, i.client)
    )
      return deny(i, "You need Moderate Members.");
    const u = target(i),
      id = i.options.getInteger("id");
    const w = store.getWarning(i.guildId, id);
    if (!w) return deny(i, `Warning #${id} was not found.`);
    if (w.user_id !== u.id)
      return deny(i, `Warning #${id} does not belong to ${u}.`);
    store.deleteWarning(i.guildId, id);
    logModeration(i.guildId, i.client, {
      action: "unwarn",
      targetId: u.id,
      moderatorId: i.user.id,
      reason: w.reason,
    });
    return respond(i, {
      components: [
        embed(
          "Warning removed",
          `Warning **#${id}** for ${u} was removed.\nReason was: ${w.reason}`,
        ),
      ],
    });
  },
);
for (const [name, desc] of [
  ["warns", "View a member warnings"],
  ["warnings", "View server warnings"],
]) {
  const b = new SlashCommandBuilder()
    .setName(name)
    .setDescription(desc)
    .addUserOption((o) => o.setName("user").setDescription("Optional member"));
  add(b, "Moderation", "Staff", async (i) => {
    if (!staff(i)) return deny(i);
    const rows = store.warnings(
      i.guildId,
      name === "warns" ? (i.options.getUser("user") || i.user).id : null,
    );
    const text = rows.length
      ? rows
          .slice(0, 15)
          .map(
            (w) =>
              `**#${w.id}** <@${w.user_id}> — ${w.reason}\nBy <@${w.moderator_id}> · ${stamp(w.created_at)}`,
          )
          .join("\n\n")
      : "No warnings found.";
    return respond(i, {
      components: [
        embed(name === "warns" ? "Member warnings" : "Server warnings", text),
      ],
      ephemeral: name === "warns",
    });
  });
}
function moderation(name, perm, method, label) {
  const b = new SlashCommandBuilder()
    .setName(name)
    .setDescription(label)
    .setDefaultMemberPermissions(perm)
    .addUserOption((o) =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addStringOption((o) => o.setName("reason").setDescription("Reason"));
  add(
    b,
    "Moderation",
    name === "mute"
      ? "Moderate Members"
      : name === "kick"
        ? "Kick Members"
        : "Ban Members",
    async (i) => {
      if (
        !i.memberPermissions.has(perm) &&
        !isBotOwner(i.user.id, i.client)
      )
        return deny(
          i,
          `You need ${name === "mute" ? "Moderate Members" : name === "kick" ? "Kick Members" : "Ban Members"}.`,
        );
      const m = target(i),
        r = i.options.getString("reason") || "No reason provided";
      if (m.id === i.guild.ownerId || m.id === i.client.user.id)
        return deny(i, "That member cannot be moderated.");
      if (
        !isBotOwner(i.user.id, i.client) &&
        m.roles?.highest?.position >= i.member.roles.highest.position
      )
        return deny(
          i,
          "You cannot moderate a member with an equal or higher role.",
        );
      if (!m[method])
        return deny(
          i,
          "That moderation action is unavailable for this target.",
        );
      await m[method](r);
      logModeration(i.guildId, i.client, {
        action: name,
        targetId: m.id,
        moderatorId: i.user.id,
        reason: r,
      });
      sendDM(i.user.id, i.client, `${name[0].toUpperCase() + name.slice(1)} Complete`, `You ${name}ned <@${m.id}> in **${i.guild.name}**.\nReason: ${r}`).catch(() => {});
      const appealLink = store.getAppealLink(i.guildId);
      const modDesc = `You were ${name}ned from **${i.guild.name}**.\nReason: ${r}${appealLink ? `\nAppeal: ${appealLink}` : ""}`;
      sendDM(m.id, i.client, `${name[0].toUpperCase() + name.slice(1)}`, modDesc).catch(() => {});
      return respond(i, {
        components: [
          embed(
            `${name[0].toUpperCase() + name.slice(1)} complete`,
            `${m} was ${name}d.\nReason: ${r}`,
          ),
        ],
      });
    },
  );
}
moderation("kick", PermissionFlagsBits.KickMembers, "kick", "Kick a member");
moderation("ban", PermissionFlagsBits.BanMembers, "ban", "Ban a member");
moderation(
  "softban",
  PermissionFlagsBits.BanMembers,
  "ban",
  "Softban a member",
);
const mute = new SlashCommandBuilder()
  .setName("mute")
  .setDescription("Timeout a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) =>
    o.setName("user").setDescription("Member").setRequired(true),
  )
  .addIntegerOption((o) =>
    o
      .setName("minutes")
      .setDescription("Timeout minutes, maximum 40320")
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(40320),
  )
  .addStringOption((o) => o.setName("reason").setDescription("Reason"));
add(mute, "Moderation", "Moderate Members", async (i) => {
  if (
    !i.memberPermissions.has(PermissionFlagsBits.ModerateMembers) &&
    !isBotOwner(i.user.id, i.client)
  )
    return deny(i, "You need Moderate Members.");
  const m = target(i);
  if (
    m.id === i.guild.ownerId ||
    (!isBotOwner(i.user.id, i.client) &&
      m.roles.highest.position >= i.member.roles.highest.position)
  )
    return deny(i, "You cannot mute that member.");
  await m.timeout(
    i.options.getInteger("minutes") * 60000,
    i.options.getString("reason") || "No reason provided",
  );
  logModeration(i.guildId, i.client, {
    action: "mute",
    targetId: m.id,
    moderatorId: i.user.id,
    reason: i.options.getString("reason") || "No reason provided",
  });
  const muteReason = i.options.getString("reason") || "No reason provided";
  sendDM(i.user.id, i.client, "Mute Complete", `You muted <@${m.id}> in **${i.guild.name}**.\nReason: ${muteReason}`).catch(() => {});
  const appealLink = store.getAppealLink(i.guildId);
  const muteTargetDesc = `You were muted in **${i.guild.name}**.\nReason: ${muteReason}${appealLink ? `\nAppeal: ${appealLink}` : ""}`;
  sendDM(m.id, i.client, "Muted", muteTargetDesc).catch(() => {});
  return respond(i, { components: [embed("Mute complete", `${m} was timed out.`)] });
});
const unmute = new SlashCommandBuilder()
  .setName("unmute")
  .setDescription("Remove timeout from a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) =>
    o.setName("user").setDescription("Member").setRequired(true),
  )
  .addStringOption((o) => o.setName("reason").setDescription("Reason"));
add(unmute, "Moderation", "Moderate Members", async (i) => {
  if (
    !i.memberPermissions.has(PermissionFlagsBits.ModerateMembers) &&
    !isBotOwner(i.user.id, i.client)
  )
    return deny(i, "You need Moderate Members.");
  const m = target(i);
  if (!m || !m.timeout)
    return deny(i, "That member is not in the server.");
  if (
    m.id === i.guild.ownerId ||
    (!isBotOwner(i.user.id, i.client) &&
      m.roles?.highest?.position >= i.member.roles.highest.position)
  )
    return deny(i, "You cannot moderate a member with an equal or higher role.");
  const r = i.options.getString("reason") || "No reason provided";
  const s = store.settings(i.guildId);
  if (s.mute_role_id && m.roles?.cache?.has(s.mute_role_id)) {
    await m.roles.remove(s.mute_role_id).catch(() => {});
  }
  await m.timeout(null, r);
  logModeration(i.guildId, i.client, {
    action: "unmute",
    targetId: m.id,
    moderatorId: i.user.id,
    reason: r,
  });
  sendDM(i.user.id, i.client, "Unmute Complete", `You unmuted <@${m.id}> in **${i.guild.name}**.\nReason: ${r}`).catch(() => {});
  sendDM(m.id, i.client, "Unmuted", `You were unmuted in **${i.guild.name}**.\nReason: ${r}`).catch(() => {});
  return respond(i, {
    components: [embed("Unmute complete", `${m} was unmuted.\nReason: ${r}`)],
  });
});
const unban = new SlashCommandBuilder()
  .setName("unban")
  .setDescription("Unban a user from the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((o) =>
    o.setName("user").setDescription("User to unban").setRequired(true),
  )
  .addStringOption((o) => o.setName("reason").setDescription("Reason"));
add(unban, "Moderation", "Ban Members", async (i) => {
  if (
    !i.memberPermissions.has(PermissionFlagsBits.BanMembers) &&
    !isBotOwner(i.user.id, i.client)
  )
    return deny(i, "You need Ban Members.");
  const u = i.options.getUser("user");
  const r = i.options.getString("reason") || "No reason provided";
  try {
    await i.guild.members.unban(u.id, r);
    logModeration(i.guildId, i.client, {
      action: "unban",
      targetId: u.id,
      moderatorId: i.user.id,
      reason: r,
    });
    sendDM(i.user.id, i.client, "Unban Complete", `You unbanned <@${u.id}> in **${i.guild.name}**.\nReason: ${r}`).catch(() => {});
    sendDM(u.id, i.client, "Unbanned", `You were unbanned from **${i.guild.name}**.\nReason: ${r}`).catch(() => {});
  } catch (e) {
    if (e.code === 10026) {
      return deny(i, "That user is not banned.");
    }
    return deny(i, `Failed to unban user: ${e.message}`);
  }
  return respond(i, {
    components: [
      embed("Unban complete", `<@${u.id}> was unbanned.\nReason: ${r}`),
    ],
  });
});
const bans = new SlashCommandBuilder()
  .setName("bans")
  .setDescription("List server bans")
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
add(bans, "Moderation", "Ban Members", async (i) => {
  if (
    !i.memberPermissions.has(PermissionFlagsBits.BanMembers) &&
    !isBotOwner(i.user.id, i.client)
  )
    return deny(i, "You need Ban Members.");
  const rows = await i.guild.bans.fetch();
  return respond(i, {
    components: [
      embed(
        "Server bans",
        rows.size
          ? [...rows.values()]
              .slice(0, 20)
              .map((x) => `<@${x.user.id}> — ${x.reason || "No reason"}`)
              .join("\n")
          : "No bans found.",
      ),
    ],
  });
});

const staffCmd = new SlashCommandBuilder()
  .setName("staff")
  .setDescription("Manage staff")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Add staff")
      .addUserOption((o) =>
        o.setName("user").setDescription("User").setRequired(true),
      )
      .addRoleOption((o) => o.setName("role").setDescription("Staff role")),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove staff")
      .addUserOption((o) =>
        o.setName("user").setDescription("User").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("upgrade")
      .setDescription("Change staff role")
      .addUserOption((o) =>
        o.setName("user").setDescription("User").setRequired(true),
      )
      .addRoleOption((o) =>
        o.setName("role").setDescription("New role").setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName("list").setDescription("List all configured staff"));
add(staffCmd, "Staff", "Staff", async (i) => {
  const s = i.options.getSubcommand();
  if (s === "list") {
    if (!staff(i)) return deny(i);
    return respond(i, { components: [await buildStaffDirectory(i.guild)] });
  }
  if (!manager(i)) return deny(i, "Only managers can manage staff.");
  const u = i.options.getUser("user");
  if (s === "remove") {
    store.removeStaff(i.guildId, u.id);
    return respond(i, {
      components: [embed("Staff removed", `${u} is no longer registered staff.`)],
    });
  }
  const role = i.options.getRole("role");
  store.upsertStaff(i.guildId, u.id, role?.id || null, i.user.id);
  if (role) {
    const m = await i.guild.members.fetch(u.id);
    if (!m.roles.cache.has(role.id)) await m.roles.add(role);
  }
  return respond(i, {
    components: [
      embed(
        s === "add" ? "Staff added" : "Staff upgraded",
        `${u} is registered as staff.`,
      ),
    ],
  });
});
add(
  new SlashCommandBuilder()
    .setName("tags")
    .setDescription("List all claimable staff tags"),
  "Tags",
  "Everyone",
  (i) => {
    const tagList = store.listTags(i.guildId);
    return respond(i, {
      components: [
        embed(
          "Claimable tags",
          tagList.length
            ? tagList.map((tag) => `\`${tag.display_name}\``).join(", ")
            : "No tags are available.",
        ),
      ],
    });
  },
);
const tags = new SlashCommandBuilder()
  .setName("tag")
  .setDescription("Manage staff expertise")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Assign a tag")
      .addStringOption((o) =>
        o.setName("tag").setDescription("Tag").setRequired(true),
      )
      .addUserOption((o) => o.setName("user").setDescription("Staff member")),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a tag")
      .addStringOption((o) =>
        o.setName("tag").setDescription("Tag").setRequired(true),
      )
      .addUserOption((o) => o.setName("user").setDescription("Staff member")),
  )
  .addSubcommand((s) => s.setName("list").setDescription("List your tags"))
  .addSubcommand((s) =>
    s
      .setName("addall")
      .setDescription("Assign all tags to yourself or a user (managers)")
      .addUserOption((o) =>
        o.setName("user").setDescription("Staff member (managers only)"),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("check")
      .setDescription("Find staff with a tag")
      .addStringOption((o) =>
        o.setName("tag").setDescription("Tag").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("ping")
      .setDescription("Ping staff with a tag")
      .addStringOption((o) =>
        o.setName("tag").setDescription("Tag").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("Create a tag")
      .addStringOption((o) =>
        o.setName("tag").setDescription("Tag").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("delete")
      .setDescription("Delete a tag")
      .addStringOption((o) =>
        o.setName("tag").setDescription("Tag").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("remall")
      .setDescription("Remove all your tags (managers can target any user)")
      .addUserOption((o) =>
        o.setName("user").setDescription("Staff member (managers only)"),
      ),
  );
add(tags, "Tags", "Staff / Managers", async (i) => {
  if (!staff(i)) return deny(i);
  const s = i.options.getSubcommand();
  const rawName = i.options.getString("tag");
  const name = rawName?.trim().toLowerCase();
  if (["create", "delete"].includes(s) && !manager(i))
    return deny(i, "Only managers can manage available tags.");
  if (s === "list") {
    const tagList = store.userTags(i.guildId, i.user.id);
    return respond(i, {
      components: [
        embed(
          "Your tags",
          tagList.length ? tagList.map((tag) => `\`${tag.display_name}\``).join(", ") : "No tags assigned.",
        ),
      ],
    });
  }
  if (!name) return respond(i, { content: "Please provide a tag name.", ephemeral: true });
  if (s === "create") {
    store.tag(i.guildId, name, rawName.trim());
    return respond(i, { content: `Tag \`${name}\` created.` });
  }
  if (s === "delete") {
    store.deleteTag(i.guildId, name);
    return respond(i, { content: `Tag \`${name}\` deleted.` });
  }
  if (s === "addall") {
    const user = i.options.getUser("user") || i.user;
    if (user.id !== i.user.id && !manager(i))
      return deny(i, "Only managers can add all tags to another user.");
    const allTags = store.listTags(i.guildId);
    if (!allTags.length)
      return respond(i, { content: "There are no tags to assign." });
    for (const t of allTags) store.addStaffTag(i.guildId, t.name, user.id, i.user.id);
    sendDM(user.id, i.client, "Tags Assigned", `You have been assigned all tags in **${i.guild.name}**.`).catch(() => {});
    return respond(i, {
      content: `Assigned all ${allTags.length} tag(s) to ${user}: ${allTags.map((t) => `\`${t.display_name}\``).join(", ")}`,
    });
  }
  if (s === "remall") {
    const user = i.options.getUser("user") || i.user;
    if (user.id !== i.user.id && !manager(i))
      return deny(i, "Only managers can remove all tags from another user.");
    const tagsList = store.userTags(i.guildId, user.id);
    if (!tagsList.length)
      return respond(i, { content: `${user} has no tags assigned.` });
    store.removeAllStaffTags(i.guildId, user.id);
    sendDM(user.id, i.client, "Tags Removed", `All your tags have been removed in **${i.guild.name}**.`).catch(() => {});
    return respond(i, { content: `Removed all ${tagsList.length} tag(s) from ${user}.` });
  }
  if (s === "add" || s === "remove") {
    const user = i.options.getUser("user") || i.user;
    if (s === "add") {
      store.addStaffTag(i.guildId, name, user.id, i.user.id);
      sendDM(user.id, i.client, "Tag Assigned", `You have been assigned the tag **${name}** in **${i.guild.name}**.`).catch(() => {});
    } else {
      store.removeStaffTag(i.guildId, name, user.id);
      sendDM(user.id, i.client, "Tag Removed", `You have been removed from the tag **${name}** in **${i.guild.name}**.`).catch(() => {});
    }
    return respond(i, { content: `${s === "add" ? "Assigned" : "Removed"} tag \`${name}\` ${s === "add" ? "to" : "from"} ${user}.` });
  }
  const members = store.tagMembers(i.guildId, name);
  if (s === "ping") {
    if (!manager(i)) return deny(i, "Only managers can ping expertise tags.");
    if (!members.length)
      return respond(i, { content: `No staff members have the \`${name}\` tag.` });
    const tagDisplay = store.listTags(i.guildId).find((t) => t.name === name)?.display_name || name;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("Claim ticket")
        .setStyle(ButtonStyle.Primary)
        .setCustomId(`claim_ticket_${i.channelId}`),
    );
    return respond(i, {
      content: `**${tagDisplay}** staffs: ${members.map((id) => `<@${id}>`).join(", ")}`,
      components: [row],
    });
  }
  if (s === "check")
    return respond(i, {
      components: [
        embed(
          `Staff with ${name}`,
          members.length ? members.map((id) => `<@${id}>`).join("\n") : "None",
        ),
      ],
    });
  return respond(i, { content: "Unknown tag command.", ephemeral: true });
});
const claim = new SlashCommandBuilder()
  .setName("claim")
  .setDescription("Claim the current ticket");
add(claim, "Tickets", "Staff", async (i) => {
  if (!staff(i)) return deny(i);
  const t = store.ticket(i.guildId, i.channelId);
  if (!t || t.status !== "OPEN" || !t.ticket_user_id)
    return deny(i, "This is not a recognized open ticket.");
  store.assignTicket(i.guildId, i.channelId, i.user.id);
  sendDM(i.user.id, i.client, "Ticket Assigned", `You claimed ticket **${t.panel}** in **${i.guild.name}**.`).catch(() => {});
  return respond(i, {
    content: `<@${t.ticket_user_id}> <@${i.user.id}> has claimed this ticket.`,
    allowedMentions: { users: [t.ticket_user_id, i.user.id] },
  });
});
const transfer = new SlashCommandBuilder()
  .setName("transfer")
  .setDescription("Transfer the current ticket")
  .addUserOption((o) =>
    o.setName("user").setDescription("Staff member").setRequired(true),
  );
add(transfer, "Tickets", "Staff", async (i) => {
  if (!staff(i)) return deny(i);
  const t = store.ticket(i.guildId, i.channelId),
    u = i.options.getUser("user");
  if (!t || t.status !== "OPEN" || !t.ticket_user_id)
    return deny(i, "This is not a recognized open ticket.");
  if (!store.isStaff(i.guildId, u.id))
    return deny(i, "The recipient must be registered staff.");
  store.assignTicket(i.guildId, i.channelId, u.id);
  sendDM(u.id, i.client, "Ticket Transferred", `You received ticket **${t.panel}** in **${i.guild.name}** from <@${i.user.id}>.`).catch(() => {});
  return respond(i, {
    content: `<@${t.ticket_user_id}> <@${u.id}> has received this ticket from <@${i.user.id}>.`,
    allowedMentions: { users: [t.ticket_user_id, u.id, i.user.id] },
  });
});
const unclaim = new SlashCommandBuilder()
  .setName("unclaim")
  .setDescription("Release the current ticket");
add(unclaim, "Tickets", "Staff", async (i) => {
  if (!staff(i)) return deny(i);
  const t = store.ticket(i.guildId, i.channelId);
  if (!t || !t.assigned_staff_id) return deny(i, "This ticket is not claimed.");
  if (t.assigned_staff_id !== i.user.id && !manager(i))
    return deny(
      i,
      "Only the assigned staff member or a manager can unclaim this ticket.",
    );
  store.assignTicket(i.guildId, i.channelId, null);
  return respond(i, {
    content: `<@${t.ticket_user_id || "0"}> The ticket is no longer assigned.`,
    allowedMentions: { users: t.ticket_user_id ? [t.ticket_user_id] : [] },
  });
});

const sticky = new SlashCommandBuilder()
  .setName("sticky")
  .setDescription("Manage sticky messages")
  .addSubcommand((s) =>
    s
      .setName("set")
      .setDescription("Set or replace the sticky message in a channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Target channel").setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("title").setDescription("Embed title").setMaxLength(256),
      )
      .addStringOption((o) =>
        o.setName("content").setDescription("Message text (or embed description)"),
      )
      .addStringOption((o) => o.setName("field1").setDescription("Embed field 1"))
      .addStringOption((o) => o.setName("field2").setDescription("Embed field 2"))
      .addStringOption((o) => o.setName("field3").setDescription("Embed field 3"))
      .addStringOption((o) => o.setName("field4").setDescription("Embed field 4"))
      .addStringOption((o) => o.setName("field5").setDescription("Embed field 5")),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a sticky message by its sticky ID or message ID")
      .addStringOption((o) =>
        o
          .setName("id")
          .setDescription("Sticky ID (6 characters) or the sticky message ID")
          .setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("list").setDescription("List all sticky messages configured in this server"),
  );
function stickyLabel(r) {
  let label = r.content ? r.content.slice(0, 80) : "(no text)";
  if (r.format === "embed" && r.embed_json) {
    try {
      const data = JSON.parse(r.embed_json);
      label = data.title || data.description || "(embed)";
      if (label === data.description && data.description?.length > 80)
        label = label.slice(0, 80) + "…";
    } catch {
      // keep fallback label
    }
  }
  return label;
}
add(sticky, "Utility", "Manage Messages", async (i) => {
  if (
    !i.memberPermissions?.has(PermissionFlagsBits.ManageMessages) &&
    !isBotOwner(i.user.id, i.client)
  )
    return deny(i, "You need Manage Messages.");
  const sub = i.options.getSubcommand();
  if (sub === "list") {
    const rows = store.listStickies(i.guildId);
    const text = rows.length
      ? rows
          .map((r) => `<#${r.channel_id}> — \\-${r.sticky_id} — ${stickyLabel(r)}`)
          .join("\n")
      : "No sticky messages configured in this server.";
    return respond(i, { components: [embed("Sticky messages", text)] });
  }
  if (sub === "remove") {
    const id = i.options.getString("id").trim();
    let row = store.deleteStickyById(i.guildId, id);
    if (!row && /^\\d{15,25}$/.test(id))
      row = store.deleteStickyByMessageId(i.guildId, id);
    if (!row) {
      const byChannel = store.getSticky(i.guildId, id.replace(/^<#|>$/g, ""));
      if (byChannel) row = store.deleteSticky(i.guildId, byChannel.channel_id) ? byChannel : null;
    }
    if (!row)
      return deny(
        i,
        "No sticky message found for that ID. Use `/sticky list` to see configured stickies.",
      );
    const channel = i.guild.channels.cache.get(row.channel_id);
    if (channel?.isTextBased() && row.message_id)
      await channel.messages.delete(row.message_id).catch(() => {});
    return respond(i, {
      content: `Sticky message \\-${row.sticky_id} removed from ${channel ? `<#${row.channel_id}>` : "a deleted channel"}.`,
    });
  }
  const channel = i.options.getChannel("channel");
  if (!channel.isTextBased() || channel.isVoiceBased())
    return deny(i, "Please choose a text channel.");
  const title = i.options.getString("title");
  const content = i.options.getString("content");
  const fields = [1, 2, 3, 4, 5]
    .map((n) => i.options.getString(`field${n}`))
    .filter(Boolean);
  if (!content && !title && !fields.length)
    return deny(i, "Provide a title, content, or at least one field.");
  let format = "plain";
  let embedJson = null;
  if (title || fields.length) {
    format = "embed";
    embedJson = JSON.stringify({ title: title || null, description: content, fields });
  }
  const row = store.setSticky(i.guildId, channel.id, content || "", format, embedJson);
  return respond(i, {
    components: [
      embed(
        "Sticky message set",
        `${channel} will now keep this message sticky.\nSticky ID: \\-${row.sticky_id}`,
      ),
    ],
  });
});

const link = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Set an appeal link")
  .addStringOption((o) =>
    o
      .setName("type")
      .setDescription("Link type")
      .setRequired(true)
      .addChoices({ name: "appeal", value: "appeal" }),
  )
  .addStringOption((o) =>
    o.setName("link").setDescription("The URL").setRequired(true),
  );
add(link, "Utility", "Manager", async (i) => {
  if (!manager(i)) return deny(i, "Only managers can set links.");
  const type = i.options.getString("type");
  const url = i.options.getString("link");
  if (type === "appeal") {
    store.updateSettings(i.guildId, { appeal_link: url });
    return respond(i, { content: `Appeal link set to: ${url}` });
  }
  return respond(i, { content: "Unknown link type.", ephemeral: true });
});

const settingsCmd = new SlashCommandBuilder()
  .setName("settings")
  .setDescription("Configure this guild")
  .addRoleOption((o) =>
    o.setName("mute_role").setDescription("Role used for role-based mute"),
  )
  .addChannelOption((o) =>
    o.setName("support_category").setDescription("Support ticket category"),
  )
  .addRoleOption((o) =>
    o
      .setName("manager_role")
      .setDescription("Role allowed to manage staff and settings"),
  )
  .addChannelOption((o) =>
    o.setName("log_channel").setDescription("Moderation log channel"),
  )
  .addStringOption((o) =>
    o
      .setName("prefix")
      .setDescription("Custom text-command prefix, for example m.")
      .setMinLength(1)
      .setMaxLength(5),
  );
add(settingsCmd, "Utility", "Administrator", async (i) => {
  if (
    !i.memberPermissions.has(PermissionFlagsBits.Administrator) &&
    !isBotOwner(i.user.id, i.client)
  )
    return deny(i, "Only server administrators can change settings.");
  const values = {};
  const muteRole = i.options.getRole("mute_role"),
    support = i.options.getChannel("support_category"),
    managerRole = i.options.getRole("manager_role"),
    log = i.options.getChannel("log_channel"),
    prefix = i.options.getString("prefix");
  if (muteRole) values.mute_role_id = muteRole.id;
  if (support) {
    if (support.type !== 4)
      return deny(i, "Support category must be a category channel.");
    values.support_category_id = support.id;
  }
  if (managerRole) values.manager_role_id = managerRole.id;
  if (log) values.log_channel_id = log.id;
  if (prefix) {
    if (/\s/.test(prefix)) return deny(i, "The prefix cannot contain spaces.");
    values.prefix = prefix;
  }
  if (!Object.keys(values).length) {
    const s = store.settings(i.guildId);
    return respond(i, {
      components: [
        embed(
          "Guild settings",
          `Mute role: ${s.mute_role_id ? `<@&${s.mute_role_id}>` : "not set"}\nSupport category: ${s.support_category_id ? `<#${s.support_category_id}>` : "not set"}\nManager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "not set"}\nLog channel: ${s.log_channel_id ? `<#${s.log_channel_id}>` : "not set"}\nPrefix: ${s.prefix || "m."}\nAppeal link: ${s.appeal_link || "not set"}`,
        ),
      ],
      ephemeral: true,
    });
  }
  const s = store.updateSettings(i.guildId, values);
  return respond(i, {
      components: [
        embed(
          "Settings updated",
          `Mute role: ${s.mute_role_id ? `<@&${s.mute_role_id}>` : "not set"}\nSupport category: ${s.support_category_id ? `<#${s.support_category_id}>` : "not set"}\nManager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "not set"}\nLog channel: ${s.log_channel_id ? `<#${s.log_channel_id}>` : "not set"}\nPrefix: ${s.prefix || "m."}\nAppeal link: ${s.appeal_link || "not set"}`,
        ),
      ],
    });
});

const channelsCmd = new SlashCommandBuilder()
  .setName("channels")
  .setDescription("Configure which channels Mihulish watches for farm links")
  .addChannelOption((o) =>
    o.setName("video").setDescription("Channel where video links are posted"),
  )
  .addChannelOption((o) =>
    o.setName("world").setDescription("Channel where world links + DN are posted"),
  )
  .addChannelOption((o) =>
    o.setName("schematic").setDescription("Channel where schematic links + DN are posted"),
  );
add(channelsCmd, "Farms", "Manager", async (i) => {
  if (!manager(i)) return deny(i, "Only managers can configure farm channels.");
  const video = i.options.getChannel("video"),
    world = i.options.getChannel("world"),
    schematic = i.options.getChannel("schematic");
  const values = {};
  for (const [opt, key] of [
    [video, "video_channel_id"],
    [world, "world_channel_id"],
    [schematic, "schematic_channel_id"],
  ]) {
    if (opt) {
      if (!opt.isTextBased())
        return deny(i, "Farm channels must be text channels.");
      values[key] = opt.id;
    }
  }
  if (!Object.keys(values).length) {
    const c = store.getFarmChannelConfig(i.guildId);
    if (!c) return deny(i, "No farm channels are configured yet. Provide video, world, and schematic channels.");
    return respond(i, {
      components: [
        embed(
          "Farm channels",
          `Video: ${c.video_channel_id ? `<#${c.video_channel_id}>` : "not set"}\nWorld: ${c.world_channel_id ? `<#${c.world_channel_id}>` : "not set"}\nSchematic: ${c.schematic_channel_id ? `<#${c.schematic_channel_id}>` : "not set"}`,
        ),
      ],
      ephemeral: true,
    });
  }
  const c = store.setFarmChannelConfig(i.guildId, values);
  return respond(i, {
    components: [
      embed(
        "Farm channels updated",
        `Video: ${c.video_channel_id ? `<#${c.video_channel_id}>` : "not set"}\nWorld: ${c.world_channel_id ? `<#${c.world_channel_id}>` : "not set"}\nSchematic: ${c.schematic_channel_id ? `<#${c.schematic_channel_id}>` : "not set"}`,
      ),
    ],
  });
});

const FARM_TYPES = [
  "bonemeal", "cobblestone", "creeper", "duper", "gold", "iron", "kelp",
  "lava", "mob", "raid", "resin", "sand", "shulker", "smelter",
  "sugarcane", "tnt", "wither-skeleton", "wood", "wool", "xp",
];
const FARM_TYPE_CHOICES = FARM_TYPES.map((t) => ({ name: t, value: t }));

// In-memory pagination state for /farm list buttons (token -> {guildId,type,page}).
const farmPages = new Map();
function newFarmPageToken() {
  let token;
  do {
    token = Math.random().toString(36).slice(2, 10);
  } while (farmPages.has(token));
  return token;
}

function farmListEmbed(guildId, farms, page, perPage, type) {
  const slice = farms.slice(page * perPage, page * perPage + perPage);
  const pages = Math.max(1, Math.ceil(farms.length / perPage));
  const lines = slice.map(
    (f) =>
      `**\`${f.dn}\`** — ${f.type ? `\`${f.type}\`` : "*(no type)*"} — <t:${Math.floor(f.created_at / 1000)}:R>`,
  );
  return embed(
    type ? `Farms — ${type}` : "Farms",
    lines.join("\n") +
      (farms.length === 0 ? "Nothing here." : "") +
      (pages > 1 ? `\n\nPage ${page + 1} of ${pages} (${farms.length} farms)` : ""),
  );
}

const farmCmd = new SlashCommandBuilder()
  .setName("farm")
  .setDescription("Manage tracked farms")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Add or update a farm")
      .addStringOption((o) =>
        o.setName("dn").setDescription("Farm identifier, for example ABC123").setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("type").setDescription("Farm type").addChoices(...FARM_TYPE_CHOICES),
      )
      .addStringOption((o) => o.setName("video").setDescription("Video link"))
      .addStringOption((o) => o.setName("world").setDescription("World link"))
      .addStringOption((o) => o.setName("schematic").setDescription("Schematic link")),
  )
  .addSubcommand((s) =>
    s
      .setName("list")
      .setDescription("List tracked farms")
      .addStringOption((o) =>
        o.setName("type").setDescription("Filter by farm type").addChoices(...FARM_TYPE_CHOICES),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a farm")
      .addStringOption((o) =>
        o.setName("dn").setDescription("Farm identifier to remove").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s.setName("export").setDescription("Export the farms dataset as a .jsonl file"),
  )
  .addSubcommand((s) =>
    s.setName("suggestions").setDescription("Show passively detected link suggestions"),
  );
add(farmCmd, "Farms", "Manager", async (i) => {
  if (!manager(i))
    return deny(i, "Only managers can manage farms.");
  const sub = i.options.getSubcommand();

  if (sub === "add") {
    const dn = i.options.getString("dn").trim();
    const fields = {};
    for (const key of ["type", "video", "world", "schematic"]) {
      const value = i.options.getString(key);
      if (value) fields[key] = value;
    }
    if (!Object.keys(fields).length)
      return deny(i, "Provide at least one of type, video, world, or schematic.");
    // If a video link was set (new or changed) without a matching passively
    // detected embed title, fetch the target page's own title so video_title
    // stays in sync with the link.
    const currentFarm = store.getFarm(i.guildId, dn);
    if (fields.video && (!currentFarm || currentFarm.video !== fields.video)) {
      const staged = store
        .listFarmSuggestions(i.guildId)
        .find((x) => x.kind === "video" && x.url === fields.video && x.title);
      fields.video_title = staged ? staged.title : (await fetchVideoTitle(fields.video));
    }
    const { farm, changed } = store.upsertFarm(i.guildId, dn, fields, i.user.id);
    if (Object.keys(changed).length) {
      store.appendFarmChange(i.guildId, {
        action: "add",
        dn,
        fields: changed,
        by: i.user.id,
        timestamp: new Date().toISOString(),
      });
    }
    // A manager confirmation clears matching staged suggestions.
    for (const s of store.listFarmSuggestions(i.guildId)) {
      if (s.dn === dn) store.deleteFarmSuggestion(i.guildId, s.id);
    }
    return respond(i, {
      components: [
        embed(
          "Farm saved",
          `DN \`${dn}\`${farm.type ? ` (${farm.type})` : ""}\nVideo: ${farm.video ? `[link](${farm.video})` : "not set"}\nWorld: ${farm.world ? `[link](${farm.world})` : "not set"}\nSchematic: ${farm.schematic ? `[link](${farm.schematic})` : "not set"}${farm.video_title ? `\nVideo title: ${farm.video_title}` : ""}`,
        ),
      ],
    });
  }

  if (sub === "remove") {
    const dn = i.options.getString("dn").trim();
    if (!store.getFarm(i.guildId, dn))
      return deny(i, `No farm exists for DN \`${dn}\`; nothing was removed.`);
    store.deleteFarm(i.guildId, dn);
    store.appendFarmChange(i.guildId, {
      action: "remove",
      dn,
      by: i.user.id,
      timestamp: new Date().toISOString(),
    });
    return respond(i, { content: `Removed farm \`${dn}\`.` });
  }

  if (sub === "list") {
    const type = i.options.getString("type");
    const farms = store.listFarms(i.guildId, type);
    if (!farms.length)
      return respond(i, {
        content: type ? `No farms found for type \`${type}\`.` : "No farms found.",
        ephemeral: true,
      });
    const perPage = 10;
    const pages = Math.ceil(farms.length / perPage);
    const pageToken = newFarmPageToken();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`farm_list_prev_${pageToken}_${type ?? "all"}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`farm_list_next_${pageToken}_${type ?? "all"}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pages <= 1),
    );
    farmPages.set(pageToken, { guildId, type, page: 0 });
    return respond(i, {
      components: [farmListEmbed(i.guildId, farms, 0, perPage, type), row],
      ephemeral: true,
    });
  }

  if (sub === "suggestions") {
    const rows = store.listFarmSuggestions(i.guildId);
    if (!rows.length) return respond(i, { content: "No staged suggestions right now.", ephemeral: true });
    const lines = rows.slice(0, 20).map(
      (s) =>
        `\`${s.dn ?? "?"}\` — ${s.kind}: ${s.url ?? "*(link missing)*"} (<t:${Math.floor(s.created_at / 1000)}:R>)`,
    );
    return respond(i, {
      components: [
        embed(
          "Farm suggestions",
          lines.join("\n") + (rows.length > 20 ? `\n…and ${rows.length - 20} more` : ""),
        ),
      ],
      ephemeral: true,
    });
  }

  // export
  const { current, previous } = store.rotateFarmChangelog(i.guildId);
  const meta = {
    type: "meta",
    last_updated: new Date().toISOString(),
    ai_instructions:
      "Update the target database using the farm records that follow (type=farm), matching on the 'dn' field. Apply the changes listed in 'changes.current' to reconcile any records your database may already have. After processing, discard 'changes.previous' — it is historical context only, not something to re-apply.",
    changes: { current, previous },
  };
  const lines = [JSON.stringify(meta)];
  for (const f of store.listFarms(i.guildId)) {
    lines.push(
      JSON.stringify({
        type: "farm",
        dn: f.dn,
        farm_type: f.type,
        video: f.video,
        world: f.world,
        schematic: f.schematic,
      }),
    );
  }
  const file = new AttachmentBuilder(Buffer.from(lines.join("\n") + "\n", "utf8"), {
    name: `farms-${Date.now()}.jsonl`,
  });
  return respond(i, {
    content: `Farms export — ${store.listFarms(i.guildId).length} farms, ${current.length} change(s) since last export.`,
    files: [file],
  });
});

const FARM_SITE = "https://theysix.ro-mihaiu.xyz/farm/java";
const DN_COOLDOWN_MS = 2 * 60 * 1000;
// Staff-role holders bypass the /dn cooldown entirely.
const DN_STAFF_ROLE_ID = "1118591747472228482";

const dnCmd = new SlashCommandBuilder()
  .setName("dn")
  .setDescription("Look up a farm and get its link")
  .addStringOption((o) =>
    o.setName("dn").setDescription("Farm identifier, for example ABC123").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("send")
      .setDescription("Where to send the farm link (default: DMs)")
      .addChoices({ name: "here", value: "here" }, { name: "dms", value: "dms" }),
  );
add(dnCmd, "Farms", "Everyone", async (i) => {
  const dn = i.options.getString("dn").trim();
  const send = i.options.getString("send") || "dms";
  const farm = store.getFarm(i.guildId, dn);
  if (!farm)
    // Not found: no cooldown consumed — typos shouldn't burn the 2-minute wait.
    return respond(i, { content: `No farm found for DN \`${dn}\`.`, ephemeral: true });

  const last = store.getDnCooldown(i.user.id);
  const bypass = i.member?.roles?.cache?.has(DN_STAFF_ROLE_ID) || isBotOwner(i.user.id, i.client);
  if (!bypass && last && Date.now() - last < DN_COOLDOWN_MS) {
    const remaining = Math.ceil((DN_COOLDOWN_MS - (Date.now() - last)) / 1000);
    return respond(i, {
      content: `Please wait ${remaining}s before using \`/dn\` again.`,
      ephemeral: true,
    });
  }

  const siteUrl = `${FARM_SITE}/${encodeURIComponent(dn)}`;
  const dmEmbed = embed(
    farm.video_title || `Farm ${dn}`,
    farm.type ? `Farm type: ${farm.type}` : "All farm links are on the page below.",
  ).setURL(siteUrl);

  if (send === "here") {
    if (!bypass) store.setDnCooldown(i.user.id);
    return respond(i, { components: [dmEmbed] });
  }

  try {
    await i.user.send({ embeds: [dmEmbed] });
  } catch {
    return respond(i, {
      content: `Couldn't DM you (your DMs may be closed) — here's the link: ${siteUrl}`,
      ephemeral: true,
    });
  }
  if (!bypass) store.setDnCooldown(i.user.id);
  return respond(i,
    { content: `Sent you the farm link for \`${dn}\` — check your DMs.`,
    ephemeral: true,
  });
});

// ---------------- Per-guild wiki ----------------
function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function wikiAutocomplete(i) {
  if (i.options.getSubcommand(false) !== "show") return i.respond([]);
  const query = String(i.options.getFocused() || "").toLowerCase();
  const choices = store
    .listWikiNames(i.guildId)
    .filter((name) => name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((name) => ({ name, value: name }));
  return i.respond(choices);
}

const wikiCmd = new SlashCommandBuilder()
  .setName("wiki")
  .setDescription("Manage this server's wiki links")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Add a wiki entry for this server")
      .addStringOption((o) =>
        o.setName("link").setDescription("The URL the entry points to").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("article-name")
          .setDescription("Human-readable name of the entry")
          .setRequired(true)
          .setMaxLength(100),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a wiki entry by its link")
      .addStringOption((o) =>
        o.setName("link").setDescription("The exact URL of the entry to remove").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("show")
      .setDescription("Show a wiki entry")
      .addStringOption((o) =>
        o
          .setName("article-name")
          .setDescription("Name of the entry (autocomplete available)")
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );
add(wikiCmd, "Utility", "Manage Messages", async (i) => {
  const sub = i.options.getSubcommand();

  if (sub === "add") {
    if (
      !i.memberPermissions?.has(PermissionFlagsBits.ManageMessages) &&
      !isBotOwner(i.user.id, i.client)
    )
      return deny(i, "You need Manage Messages to add wiki entries.");
    const link = i.options.getString("link").trim();
    const articleName = i.options.getString("article-name").trim();
    if (!isValidHttpUrl(link))
      return deny(i, "That link doesn't look valid — please provide a well-formed http(s) URL.");
    const existing = store.addWikiEntry(i.guildId, articleName, link, i.user.id);
    if (existing.created_at !== existing.updated_at)
      return deny(
        i,
        `A wiki entry named **${existing.article_name}** already exists in this server. Remove it first with \`/wiki remove\` or use a different name.`,
      );
    return respond(i, {
      components: [
        embed(
          "Wiki entry added",
          `**${existing.article_name}**\n${link}\nAdded by <@${i.user.id}>`,
        ),
      ],
    });
  }

  if (sub === "remove") {
    if (
      !i.memberPermissions?.has(PermissionFlagsBits.ManageMessages) &&
      !isBotOwner(i.user.id, i.client)
    )
      return deny(i, "You need Manage Messages to remove wiki entries.");
    const link = i.options.getString("link").trim();
    if (store.deleteWikiByLink(i.guildId, link))
      return respond(i, { content: `Removed the wiki entry for ${link}.` });
    const close = store
      .listWikiLinks(i.guildId)
      .filter((r) => r.link.toLowerCase().includes(link.replace(/^https?:\/\//, "").split("/")[0] || ""))
      .slice(0, 5)
      .map((r) => r.article_name);
    const suggestions = close.length
      ? `\nClose matches in this server: ${close.map((n) => `**${n}**`).join(", ")}.`
      : "";
    return deny(i, `No wiki entry with that link exists in this server.${suggestions}`);
  }

  // show
  const articleName = i.options.getString("article-name").trim();
  const row = store.getWikiByName(i.guildId, articleName);
  if (!row)
    return deny(
      i,
      `No wiki entry named **${articleName}** was found. Start typing the name with \`/wiki show\` to see the available entries.`,
    );
  const showEmbed = embed(row.article_name, row.link).setURL(row.link);
  return respond(i, {
    components: [
      showEmbed,
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Open link").setStyle(ButtonStyle.Link).setURL(row.link),
      ),
    ],
  });
});
// Attach the autocomplete handler for /wiki show's article-name option.
commands.find((c) => c.data.name === "wiki").autocomplete = wikiAutocomplete;

module.exports = {
  commands,
  metadata,
  store,
  COLOR,
  DOCS,
  embed,
  makeEmbed,
  buildHelpEmbed,
  buildHelpRow,
  buildUpdateEmbed,
  respond,
  setLeaveNickname,
  staffStatusLine,
  buildStaffDirectory,
  staffCheck,
  managerCheck,
  isBotOwner,
  stamp,
  logCommand,
  logEvent,
  logModeration,
  sendDM,
  farmPages,
  farmListEmbed,
  FARM_TYPES,
};
