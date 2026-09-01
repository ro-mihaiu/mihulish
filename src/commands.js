const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const store = require("./database");
const { makeEmbed, logCommand, logEvent, logModeration } = require("./utils");
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
    .setTitle(title)
    .setDescription(description);
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
function deny(i, text = "You must be configured staff to use this command.") {
  return i.reply({ content: text, ephemeral: true });
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
async function buildStaffDirectory(guild) {
  const rows = store.listStaffStatuses(guild.id);
  if (!rows.length) return embed("Configured staff", "No staff configured.");

  const members = await Promise.all(
    rows.map(async (row) => [row, await guild.members.fetch(row.user_id).catch(() => null)]),
  );
  const grouped = new Map();
  for (const [row, member] of members) {
    const role = row.role_id ? guild.roles.cache.get(row.role_id) : null;
    const roleName = role?.name || "No role";
    const position = role?.position || 0;
    const tags = store.userTags(guild.id, row.user_id).map((tag) => tag.display_name);
    const status = row.loa_active ? "LOA" : row.sloa_active ? "SLOA" : "";
    const username = member?.user.username || `Unknown user (${row.user_id})`;
    const line = `${username}${status ? ` - ${status}` : ""}\n> ${tags.length ? tags.join(", ") : "No tags"}`;
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
    .setTitle("Mihulish — Commands")
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
        { name: "prefix", desc: "Check current server prefix" },
        { name: "settings", desc: "View or configure server roles, channels, and prefix" },
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
    helpEmbed.addFields({ name: cat.name, value: value || "None", inline: false });
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

add(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Learn about Mihulish and view all commands"),
  "Utility",
  "Everyone",
  (i) => {
    const p = store.getPrefix(i.guildId);
    return i.reply({
      embeds: [buildHelpEmbed(p)],
      components: [buildHelpRow()],
    });
  },
);
const invite = new SlashCommandBuilder()
  .setName("invite")
  .setDescription("Get the bot invite link");
add(invite, "Utility", "Everyone", async (i) => {
  return i.reply({
    embeds: [
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
    return i.reply({
      embeds: [
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
  return i.reply({
    embeds: [embed("Vote recorded", desc.join("\n"))],
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
  return i.reply({
    embeds: [embed("Server vote streak", desc.join("\n"))],
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
      ),
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
    return i.reply({
      embeds: [
        embed(
          "LOA rules",
          "Use LOA when fully unavailable. Give a clear reason and an optional end date. Return to active status when available again.",
        ),
      ],
    });
  if (s === "status") {
    const a = i.options.getBoolean("active"),
      r = i.options.getString("reason"),
      d = i.options.getInteger("ends_in_days");
    store.setLeave(
      "loa",
      i.guildId,
      i.user.id,
      a,
      r,
      null,
      d ? Date.now() + d * 86400000 : null,
    );
    const nickError = await setLeaveNickname(i.member, i.guild, "loa", a);
    const embedText = nickError
      ? `${i.user} — ${r}\n⚠️ ${nickError}`
      : `${i.user} — ${r}`;
    return i.reply({
      embeds: [embed(a ? "LOA active" : "LOA removed", embedText)],
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
  return i.reply({
    embeds: [
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
      ),
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
    return i.reply({
      embeds: [
        embed(
          "SLOA rules",
          "Use SLOA when partially available. Describe your availability clearly and keep it updated.",
        ),
      ],
    });
  if (s === "status") {
    const a = i.options.getBoolean("active"),
      d = i.options.getInteger("ends_in_days");
    store.setLeave(
      "sloa",
      i.guildId,
      i.user.id,
      a,
      i.options.getString("reason"),
      i.options.getString("availability"),
      d ? Date.now() + d * 86400000 : null,
    );
    const nickError = await setLeaveNickname(i.member, i.guild, "sloa", a);
    const embedText = nickError
      ? `${i.user} — ${i.options.getString("availability")}\n⚠️ ${nickError}`
      : `${i.user} — ${i.options.getString("availability")}`;
    return i.reply({
      embeds: [
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
  return i.reply({
    embeds: [
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
    return i.reply({
      embeds: [
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
    return i.reply({
      embeds: [
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
    return i.reply({
      embeds: [
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
      return i.reply({
        embeds: [
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
  return i.reply({ embeds: [embed("Mute complete", `${m} was timed out.`)] });
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
  return i.reply({
    embeds: [embed("Unmute complete", `${m} was unmuted.\nReason: ${r}`)],
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
  } catch (e) {
    if (e.code === 10026) {
      return deny(i, "That user is not banned.");
    }
    return deny(i, `Failed to unban user: ${e.message}`);
  }
  return i.reply({
    embeds: [
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
  return i.reply({
    embeds: [
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
    return i.reply({ embeds: [await buildStaffDirectory(i.guild)] });
  }
  if (!manager(i)) return deny(i, "Only managers can manage staff.");
  const u = i.options.getUser("user");
  if (s === "remove") {
    store.removeStaff(i.guildId, u.id);
    return i.reply({
      embeds: [embed("Staff removed", `${u} is no longer registered staff.`)],
    });
  }
  const role = i.options.getRole("role");
  store.upsertStaff(i.guildId, u.id, role?.id || null, i.user.id);
  if (role) {
    const m = await i.guild.members.fetch(u.id);
    if (!m.roles.cache.has(role.id)) await m.roles.add(role);
  }
  return i.reply({
    embeds: [
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
    return i.reply({
      embeds: [
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
    return i.reply({
      embeds: [
        embed(
          "Your tags",
          tagList.length ? tagList.map((tag) => `\`${tag.display_name}\``).join(", ") : "No tags assigned.",
        ),
      ],
    });
  }
  if (!name) return i.reply({ content: "Please provide a tag name.", ephemeral: true });
  if (s === "create") {
    store.tag(i.guildId, name, rawName.trim());
    return i.reply({ content: `Tag \`${name}\` created.` });
  }
  if (s === "delete") {
    store.deleteTag(i.guildId, name);
    return i.reply({ content: `Tag \`${name}\` deleted.` });
  }
  if (s === "add" || s === "remove") {
    const user = i.options.getUser("user") || i.user;
    if (s === "add") store.addStaffTag(i.guildId, name, user.id, i.user.id);
    else store.removeStaffTag(i.guildId, name, user.id);
    return i.reply({ content: `${s === "add" ? "Assigned" : "Removed"} tag \`${name}\` ${s === "add" ? "to" : "from"} ${user}.` });
  }
  const members = store.tagMembers(i.guildId, name);
  if (s === "ping") {
    if (!manager(i)) return deny(i, "Only managers can ping expertise tags.");
    if (!members.length)
      return i.reply({ content: `No staff members have the \`${name}\` tag.` });
    return i.reply({ content: members.map((id) => `<@${id}>`).join(" ") });
  }
  if (s === "check")
    return i.reply({
      embeds: [
        embed(
          `Staff with ${name}`,
          members.length ? members.map((id) => `<@${id}>`).join("\n") : "None",
        ),
      ],
    });
  return i.reply({ content: "Unknown tag command.", ephemeral: true });
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
  return i.reply({
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
  return i.reply({
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
  return i.reply({
    content: `<@${t.ticket_user_id || "0"}> The ticket is no longer assigned.`,
    allowedMentions: { users: t.ticket_user_id ? [t.ticket_user_id] : [] },
  });
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
    return i.reply({
      embeds: [
        embed(
          "Guild settings",
          `Mute role: ${s.mute_role_id ? `<@&${s.mute_role_id}>` : "not set"}\nSupport category: ${s.support_category_id ? `<#${s.support_category_id}>` : "not set"}\nManager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "not set"}\nLog channel: ${s.log_channel_id ? `<#${s.log_channel_id}>` : "not set"}\nPrefix: ${s.prefix || "m."}`,
        ),
      ],
      ephemeral: true,
    });
  }
  const s = store.updateSettings(i.guildId, values);
  return i.reply({
    embeds: [
      embed(
        "Settings updated",
        `Mute role: ${s.mute_role_id ? `<@&${s.mute_role_id}>` : "not set"}\nSupport category: ${s.support_category_id ? `<#${s.support_category_id}>` : "not set"}\nManager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "not set"}\nLog channel: ${s.log_channel_id ? `<#${s.log_channel_id}>` : "not set"}\nPrefix: ${s.prefix || "m."}`,
      ),
    ],
  });
});

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
};
