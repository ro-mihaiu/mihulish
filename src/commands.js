const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const { AttachmentBuilder } = require("discord.js");
const store = require("./database");
const { makeEmbed, logCommand, logEvent, logModeration, sendDM, fetchVideoTitle, resolveThumbnail } = require("./utils");
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
// Footer credit for command-triggered embeds, e.g. "Triggered by mihaiu".
function triggerFooter(user) {
  if (!user) return null;
  const name = user.displayName || user.globalName || user.username || user.tag || String(user.id ?? "");
  return name ? `Triggered by ${name}` : null;
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
        { name: "ticket", desc: "Ping ticket owners whose tickets have no staff reply" },
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
        { name: "embed", desc: "Create and manage saved embed messages" },
        { name: "invite", desc: "Get the bot invite link" },
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

// ---------------- Ticket inactivity pings ----------------
function formatIdle(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
// Find open tickets whose newest *staff* message (falling back to the newest
// activity) is older than `hours`, then ping the ticket owner plus the staff
// member who last replied. Shared by `/ticket ping:<hours>` and the nightly
// sweep in index.js so both agree on what counts as stale. Tickets whose owner
// turned pings off (`/ticket ping:<off>`) are skipped entirely.
async function pingStaleTickets(guild, hours, { limit = 25, markActive = true } = {}) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  const stale = [];
  const skipped = [];
  for (const t of store.listOpenTickets(guild.id)) {
    if (store.ticketPingDisabled(guild.id, t.channel_id)) {
      skipped.push({ ticket: t, reason: "pings disabled for this ticket" });
      continue;
    }
    const channel = guild.channels.cache.get(t.channel_id);
    if (!channel?.isTextBased()) {
      skipped.push({ ticket: t, reason: "channel not cached" });
      continue;
    }
    const fetched = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const recent = fetched
      ? [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      : [];
    const lastStaffMsg = recent.filter(
      (m) => !m.author.bot && store.isStaff(guild.id, m.author.id),
    ).pop();
    // Take the NEWER of the last staff message and the DB's last-activity
    // timestamp: the sweep itself records its ping as activity (markActive),
    // and using `||` here would ignore that reset whenever an old staff
    // message is still in the recent window — pinging the ticket again on
    // every sweep instead of waiting a full `hours`.
    const lastActivity = Math.max(
      lastStaffMsg?.createdTimestamp || 0,
      t.last_message_at || t.created_at || 0,
    );
    if (lastActivity >= cutoff) continue;

    const targetIds = [t.ticket_user_id];
    if (lastStaffMsg && !targetIds.includes(lastStaffMsg.author.id))
      targetIds.push(lastStaffMsg.author.id);
    if (t.assigned_staff_id && !targetIds.includes(t.assigned_staff_id))
      targetIds.push(t.assigned_staff_id);
    if (targetIds.filter(Boolean).length < 1) {
      skipped.push({ ticket: t, reason: "no one to ping" });
      continue;
    }
    stale.push({
      ticket: t,
      channel,
      // Filter in case the ticket owner id is missing (legacy rows).
      targetIds: targetIds.filter(Boolean),
      lastStaffId: lastStaffMsg?.author.id || null,
      idleMs: Date.now() - lastActivity,
    });
  }

  let sent = 0;
  for (const entry of stale.slice(0, limit)) {
    const mentions = entry.targetIds.map((id) => `<@${id}>`).join(" ");
    try {
      await entry.channel.send({
        content: `${mentions} — no staff reply for **${formatIdle(entry.idleMs)}** in this ticket. Please check in.`,
        allowedMentions: { users: entry.targetIds },
      });
      sent++;
      // Record the ping as activity so the periodic sweep doesn't ping again
      // straight away.
      if (markActive) store.updateTicketLastMessage(guild.id, entry.channel.id);
    } catch {
      skipped.push({ ticket: entry.ticket, reason: "could not send" });
    }
  }
  return { stale, sent, skipped, limit };
}

const ticketCmd = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Ticket utilities")
  .addStringOption((o) =>
    o
      .setName("ping")
      .setDescription("Ping tickets with no staff reply for this many hours, or toggle pings in the current ticket")
      .setRequired(true)
      .addChoices(
        { name: "on — re-enable ticket pings", value: "on" },
        { name: "off — stop pinging this ticket", value: "off" },
        { name: "12h", value: "12" },
        { name: "24h", value: "24" },
        { name: "48h", value: "48" },
        { name: "72h", value: "72" },
        { name: "1 week", value: "168" },
      ),
  );
add(ticketCmd, "Tickets", "Staff", async (i) => {
  if (!staff(i)) return deny(i);
  const raw = i.options.getString("ping", true);

  // `/ticket ping:<on/off>` toggles pings for the current ticket. Default is
  // on; when off, neither the sweep nor `/ticket ping` pings anyone here.
  if (raw === "on" || raw === "off") {
    const t = store.ticket(i.guildId, i.channelId);
    if (!t || t.status !== "OPEN")
      return respond(i, {
        content: "Run this inside the ticket channel you want to toggle.",
        ephemeral: true,
      });
    store.setTicketPingDisabled(i.guildId, i.channelId, raw === "off");
    return respond(i, {
      content:
        raw === "off"
          ? "Ticket pings are now **off** for this ticket — no one will be pinged here."
          : "Ticket pings are now **on** for this ticket.",
      ephemeral: true,
    });
  }

  const hours = Number.parseInt(raw, 10);
  if (!hours || hours < 1 || hours > 720)
    return respond(i, {
      content: "Use `/ticket ping:<on|off>` to toggle pings in this ticket, or a 1–720 hour value to ping stale tickets.",
      ephemeral: true,
    });
  const { stale, sent, skipped } = await pingStaleTickets(i.guild, hours);
  if (!stale.length)
    return respond(i, {
      components: [
        embed(
          "No stale tickets",
          `Every open ticket has had a staff reply in the last **${hours}h**.`,
        ),
      ],
      ephemeral: true,
    });
  const lines = stale.map((entry) => {
    const who = entry.lastStaffId ? `last staff <@${entry.lastStaffId}>` : "no staff reply yet";
    return `<#${entry.channel.id}> — idle **${formatIdle(entry.idleMs)}** · ${who}`;
  });
  const notes = [];
  if (sent < stale.length) notes.push(`${stale.length - sent} could not be pinged.`);
  if (skipped.length) notes.push(`${skipped.length} ticket(s) skipped.`);
  return respond(i, {
    components: [
      embed(
        `Pinged ${sent} ticket(s)`,
        `Stale for more than **${hours}h**:\n${lines.join("\n")}${
          notes.length ? `\n\n*${notes.join(" ")}*` : ""
        }`,
      ),
    ],
    ephemeral: true,
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

function farmListEmbed(guildId, farms, page, perPage, type, footer = null) {
  const slice = farms.slice(page * perPage, page * perPage + perPage);
  const pages = Math.max(1, Math.ceil(farms.length / perPage));
  const lines = slice.map(
    (f) =>
      `**\`${f.dn}\`** — ${f.type ? `\`${f.type}\`` : "*(no type)*"} — <t:${Math.floor(f.created_at / 1000)}:R>`,
  );
  const built = embed(
    type ? `Farms — ${type}` : "Farms",
    lines.join("\n") +
      (farms.length === 0 ? "Nothing here." : "") +
      (pages > 1 ? `\n\nPage ${page + 1} of ${pages} (${farms.length} farms)` : ""),
  );
  if (footer) built.setFooter({ text: footer });
  return built;
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
    farmPages.set(pageToken, { guildId: i.guildId, type, page: 0, footer: triggerFooter(i.user) });
    return respond(i, {
      components: [
        farmListEmbed(i.guildId, farms, 0, perPage, type, triggerFooter(i.user)),
        row,
      ],
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
    o
      .setName("dn")
      .setDescription("Farm identifier, for example 467 or B105")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((o) =>
    o.setName("send")
      .setDescription("Where to send the farm link (default: DMs)")
      .addChoices({ name: "here", value: "here" }, { name: "dms", value: "dms" }),
  );
// Autocomplete every farm DN in the guild so members can find `B105`-style
// identifiers instead of guessing them.
async function dnAutocomplete(i) {
  const query = String(i.options.getFocused() || "");
  const choices = store.searchFarms(i.guildId, query, 25).map((f) => ({
    name: `${f.dn}${f.video_title ? ` — ${f.video_title}` : ""}`.slice(0, 100),
    value: f.dn,
  }));
  return i.respond(choices);
}
// How a farm embed delivers its links.
//   buttons — title is plain text, one coloured button per available link
//   site    — legacy behaviour: the title links to the farm page, no buttons
// `/dnstyle` switches between them per server; DN_LINK_STYLE sets the default.
const DN_LINK_STYLES = ["buttons", "site"];
const DN_DEFAULT_STYLE = DN_LINK_STYLES.includes(
  (process.env.DN_LINK_STYLE || "").toLowerCase(),
)
  ? process.env.DN_LINK_STYLE.toLowerCase()
  : "buttons";
// Buttons go stale 10 minutes after the embed was posted or last used.
const DN_BUTTON_TTL_MS = 10 * 60 * 1000;
const DN_FARM_LINKS = [
  { kind: "video", label: "YouTube video", style: ButtonStyle.Danger },
  { kind: "schematic", label: "Schematic", style: ButtonStyle.Success },
  { kind: "world", label: "World", style: ButtonStyle.Primary },
];
function dnLinkStyle(guildId) {
  const stored = store.settings(guildId)?.dn_link_style;
  return DN_LINK_STYLES.includes(stored) ? stored : DN_DEFAULT_STYLE;
}
// Buttons are not Link-styled on purpose: the click is handled by the bot so
// the expiry can be enforced and the timer refreshed on each use. The guild id
// rides along in the custom id because `/dn` delivers these embeds by DM, where
// `interaction.guildId` is null and there is no channel guild to fall back on.
function dnButtonRow(farm, guildId, expiresAt, disabled = false) {
  const row = new ActionRowBuilder();
  for (const { kind, label, style } of DN_FARM_LINKS) {
    if (!farm[kind]) continue;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`farm_dl|${guildId}|${farm.dn}|${kind}|${expiresAt}`)
        .setLabel(label)
        .setStyle(style)
        .setDisabled(disabled),
    );
  }
  return row.components.length ? row : null;
}
// Shared embed for /dn (here + DMs), `m.dn` and the DN channel: the title keeps
// the video name, the thumbnail is attached when there is one, and the links are
// reachable through coloured buttons.
async function buildDnEmbed(farm, guildId = null, user = null) {
  const style = guildId ? dnLinkStyle(guildId) : DN_DEFAULT_STYLE;
  const siteUrl = `${FARM_SITE}/${encodeURIComponent(farm.dn)}`;
  const linked = style === "site";
  const built = embed(
    farm.video_title || `Farm ${farm.dn}`,
    farm.type
      ? `Farm type: ${farm.type}`
      : linked
        ? "All farm links are on the page below."
        : "Use the buttons below to get the files.",
    linked ? 0xe91e63 : COLOR,
  );
  const footer = triggerFooter(user);
  if (footer) built.setFooter({ text: footer });
  if (linked) built.setURL(siteUrl);
  const thumbnail = await resolveThumbnail(farm.video);
  if (thumbnail) built.setImage(thumbnail);
  if (linked) return { embed: built, row: null };
  const row = dnButtonRow(farm, guildId, Date.now() + DN_BUTTON_TTL_MS);
  return { embed: built, row };
}
function dnMissMessage(guildId, rawDn) {
  const close = store.suggestFarms(guildId, rawDn, 5);
  const hints = close.length
    ? `\nDid you mean: ${close.map((f) => `\`${f.dn}\``).join(", ")}?`
    : "";
  return `No farm found for DN \`${store.normalizeDn(rawDn) || rawDn}\`.${hints} Start typing in \`/dn\` to browse every DN.`;
}
add(dnCmd, "Farms", "Everyone", async (i) => {
  const dn = store.normalizeDn(i.options.getString("dn"));
  const send = i.options.getString("send") || "dms";
  if (!dn)
    return respond(i, {
      content: "That doesn't look like a DN. DNs are alphanumeric, for example `467` or `B105`.",
      ephemeral: true,
    });
  const farm = store.getFarm(i.guildId, dn);
  if (!farm)
    // Not found: no cooldown consumed — typos shouldn't burn the 2-minute wait.
    return respond(i, { content: dnMissMessage(i.guildId, dn), ephemeral: true });

  const last = store.getDnCooldown(i.user.id);
  const bypass = i.member?.roles?.cache?.has(DN_STAFF_ROLE_ID) || isBotOwner(i.user.id, i.client);
  if (!bypass && last && Date.now() - last < DN_COOLDOWN_MS) {
    const remaining = Math.ceil((DN_COOLDOWN_MS - (Date.now() - last)) / 1000);
    return respond(i, {
      content: `Please wait ${remaining}s before using \`/dn\` again.`,
      ephemeral: true,
    });
  }

  const siteUrl = `${FARM_SITE}/${encodeURIComponent(farm.dn)}`;
  const { embed: dnEmbed, row } = await buildDnEmbed(farm, i.guildId, i.user);
  const payload = { components: row ? [dnEmbed, row] : [dnEmbed] };

  if (send === "here") {
    if (!bypass) store.setDnCooldown(i.user.id);
    return respond(i, payload);
  }

  try {
    await i.user.send({ embeds: [dnEmbed], components: row ? [row] : [] });
  } catch {
    return respond(i, {
      content: `Couldn't DM you (your DMs may be closed) — here's the link: ${siteUrl}`,
      ephemeral: true,
    });
  }
  if (!bypass) store.setDnCooldown(i.user.id);
  return respond(i, {
    content: `Sent you the farm links for \`${farm.dn}\` — check your DMs.`,
    ephemeral: true,
  });
});
commands.find((c) => c.data.name === "dn").autocomplete = dnAutocomplete;

const dnStyleCmd = new SlashCommandBuilder()
  .setName("dnstyle")
  .setDescription("Choose how farm links are delivered in /dn embeds")
  .addStringOption((o) =>
    o
      .setName("style")
      .setDescription("buttons = one coloured button per link; site = title links to the farm page")
      .setRequired(true)
      .addChoices(
        { name: "buttons (video / schematic / world)", value: "buttons" },
        { name: "site (link behind the title)", value: "site" },
      ),
  );
add(dnStyleCmd, "Farms", "Manager", async (i) => {
  if (!manager(i)) return deny(i, "Only managers can change the /dn link style.");
  const style = i.options.getString("style");
  store.updateSettings(i.guildId, { dn_link_style: style });
  return respond(i, {
    components: [
      embed(
        "DN link style updated",
        style === "buttons"
          ? "Farm embeds now show one button per link: red for the video, green for the schematic, blue for the world. The title is plain text."
          : "Farm embeds now link the title to the farm page again, with no buttons.",
      ),
    ],
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

const cmdCmd = new SlashCommandBuilder()
  .setName("cmd")
  .setDescription("Manage custom trigger commands")
  .addSubcommand((s) =>
    s
      .setName("add")
      .setDescription("Add a custom command")
      .addStringOption((o) =>
        o.setName("trigger").setDescription("Trigger word (e.g., dn)").setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("content").setDescription("Response content").setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("remove")
      .setDescription("Remove a custom command")
      .addStringOption((o) =>
        o.setName("trigger").setDescription("Trigger word to remove").setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName("list").setDescription("List all custom commands"));
add(cmdCmd, "Utility", "Manage Messages", async (i) => {
  if (
    !i.memberPermissions?.has(PermissionFlagsBits.ManageMessages) &&
    !isBotOwner(i.user.id, i.client)
  )
    return deny(i, "You need Manage Messages to manage custom commands.");
  const sub = i.options.getSubcommand();
  if (sub === "add") {
    const trigger = i.options.getString("trigger").trim().toLowerCase();
    const content = i.options.getString("content");
    if (!trigger || !content) return deny(i, "Trigger and content are required.");
    store.addCustomCommand(i.guildId, trigger, content, i.user.id);
    return respond(i, {
      components: [
        embed(
          "Custom command added",
          `Trigger: \`${trigger}\`\nContent: ${content.slice(0, 1000)}`,
        ),
      ],
    });
  }
  if (sub === "remove") {
    const trigger = i.options.getString("trigger").trim().toLowerCase();
    if (store.removeCustomCommand(i.guildId, trigger))
      return respond(i, { content: `Removed custom command \`${trigger}\`.` });
    return deny(i, `No custom command found for trigger \`${trigger}\`.`);
  }
  // list
  const cmds = store.listCustomCommands(i.guildId);
  if (!cmds.length) return respond(i, { content: "No custom commands configured." });
  const lines = cmds.map((c) => `\`${c.trigger}\` — ${c.content.slice(0, 80)}${c.content.length > 80 ? "…" : ""}`);
  return respond(i, {
    components: [embed("Custom commands", lines.join("\n"))],
  });
});

// ---------------- Saved embeds ----------------
// Embeds are posted through a per-channel webhook that is named and dressed
// after the server, so the resulting message looks native instead of carrying
// the bot's own name and avatar. Only the author (or a bot owner / admin) can
// change or remove an embed afterwards.
const EMBED_FORM_CREATE = "embedform_create";
const EMBED_FORM_EDIT = "embedform_edit";
const EMBED_LIST_LIMIT = 25;
const EMBED_MAX_CONTENT = 4000;

function pad2(n) {
  return String(n).padStart(2, "0");
}
// Footer date, e.g. 03/10/2026. UTC so the stored date is stable across hosts.
function embedDate(t) {
  const d = new Date(t);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
function embedAuthorName(user) {
  return (
    user?.displayName ||
    user?.globalName ||
    user?.username ||
    user?.tag ||
    (user?.id ? `<@${user.id}>` : "unknown")
  );
}
function embedPfp(user) {
  return user?.displayAvatarURL?.({ size: 128, extension: "png" }) || null;
}
// The message always presents itself as the server: server name as author,
// server icon as author icon + thumbnail, regardless of who posts it.
function buildEmbedMessage(guild, { title, content, author, createdAt }) {
  const icon = guild.iconURL({ size: 256, extension: "png" });
  const built = new EmbedBuilder().setColor(COLOR);
  if (title) built.setTitle(String(title).slice(0, 256));
  if (content) built.setDescription(String(content).slice(0, EMBED_MAX_CONTENT));
  built.setAuthor({ name: guild.name, ...(icon ? { iconURL: icon } : {}) });
  if (icon) built.setThumbnail(icon);
  const pfp = embedPfp(author);
  built.setFooter({
    text: `Sent by ${embedAuthorName(author)} at ${embedDate(createdAt)}`,
    ...(pfp ? { iconURL: pfp } : {}),
  });
  if (guild.id) built.setTimestamp(new Date(createdAt));
  return built;
}
async function resolveEmbedChannel(guild, raw, fallbackId) {
  const cleaned = String(raw ?? "").trim().replace(/^<#|>$/g, "");
  if (!cleaned) {
    if (!fallbackId) return null;
    return (
      guild.channels.cache.get(fallbackId) ||
      (await guild.channels.fetch(fallbackId).catch(() => null))
    );
  }
  if (/^\d{15,25}$/.test(cleaned))
    return (
      guild.channels.cache.get(cleaned) ||
      (await guild.channels.fetch(cleaned).catch(() => null))
    );
  const name = cleaned.replace(/^#/, "").toLowerCase();
  return guild.channels.cache.find((c) => c.name?.toLowerCase() === name) || null;
}
function channelMention(guild, channelId) {
  if (!channelId) return "";
  return guild?.channels?.cache?.has(channelId) ? `<#${channelId}>` : "";
}
function usableEmbedChannel(channel) {
  if (!channel) return "I could not find that channel in this server.";
  if (typeof channel.isTextBased === "function" && !channel.isTextBased())
    return "Embeds can only be sent to text channels.";
  if (typeof channel.isVoiceBased === "function" && channel.isVoiceBased())
    return "Embeds can only be sent to text channels.";
  if (typeof channel.manageWebhooks === "boolean" && !channel.manageWebhooks)
    return "I need **Manage Webhooks** in that channel to post embeds there.";
  return null;
}
async function ensureEmbedWebhook(guild, channel) {
  const guildId = guild.id;
  const cached = store.getEmbedWebhook(guildId, channel.id);
  const icon = guild.iconURL({ size: 256, extension: "png" });
  if (cached?.webhook_id) {
    const existing = await guild.webhooks
      .fetch(cached.webhook_id)
      .catch(() => null);
    if (existing) return existing;
    store.deleteEmbedWebhook(guildId, channel.id);
  }
  const hook = await channel.createWebhook({
    name: guild.name.slice(0, 80),
    ...(icon ? { avatar: icon } : {}),
    reason: `Mihulish embeds in #${channel.name}`,
  });
  store.setEmbedWebhook(guildId, channel.id, hook.id, hook.token);
  return hook;
}
function embedFormModal({ customId, channelLabel, title, content }) {
  // Only pre-fill fields that actually hold something, so an untouched form
  // does not submit empty strings that look like real values.
  const field = (customId, label, style, maxLength, required, value) => {
    const input = new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(style)
      .setMaxLength(maxLength)
      .setRequired(required);
    if (value) input.setValue(String(value));
    return new ActionRowBuilder().addComponents(input);
  };
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(customId.startsWith(EMBED_FORM_EDIT) ? "Edit embed" : "Create embed")
    .addComponents(
      field(
        "channel",
        "Channel",
        TextInputStyle.Short,
        100,
        false,
        channelLabel,
      ),
      field("title", "Title", TextInputStyle.Short, 256, false, title),
      field(
        "content",
        "Content",
        TextInputStyle.Paragraph,
        EMBED_MAX_CONTENT,
        true,
        content,
      ),
    );
}
function embedResultEmbed(row, channel, extra, usage) {
  const body = [
    `ID: \`${row.embed_id}\``,
    `Channel: ${channel ? `<#${row.channel_id}>` : "a deleted channel"}`,
    `Author: ${row.author_id ? `<@${row.author_id}>` : "unknown"}${
      row.author_name ? ` (${row.author_name})` : ""
    }`,
    `Created: <t:${Math.floor(row.created_at / 1000)}:f> (\`${embedDate(
      row.created_at,
    )}\`)`,
    extra || "",
    usage || `Use \`/embed edit id:${row.embed_id}\` or \`/embed delete id:${row.embed_id}\`.`,
  ].filter(Boolean);
  return embed(`Embed \`${row.embed_id}\``, body.join("\n"));
}
// ---- Shared operations, used by both /embed and the `m.embed` prefix form ----
function renderEmbedList(guildId, guild) {
  const rows = store.listEmbeds(guildId);
  if (!rows.length)
    return {
      components: [
        embed("Saved embeds", "No embeds have been created in this server yet."),
      ],
      ephemeral: true,
    };
  const shown = rows.slice(0, EMBED_LIST_LIMIT);
  const lines = shown.map((r) => {
    const label = r.title || r.content || "(empty)";
    const short = label.length > 60 ? `${label.slice(0, 60)}…` : label;
    const edited = r.updated_at
      ? ` · edited <t:${Math.floor(r.updated_at / 1000)}:R>`
      : "";
    const where = channelMention(guild, r.channel_id) || "a deleted channel";
    return `\`${r.embed_id}\` — ${where} — **${short}**\nby ${
      r.author_id ? `<@${r.author_id}>` : "unknown"
    } · <t:${Math.floor(r.created_at / 1000)}:R>${edited}`;
  });
  const overflow =
    rows.length > shown.length
      ? `\n*Showing ${shown.length} of ${rows.length} — look up the rest with \`/embed edit\` or \`/embed delete\` and their ID.*`
      : "";
  return {
    components: [
      embed(`Saved embeds (${rows.length})`, `${lines.join("\n")}${overflow}`),
    ],
    ephemeral: true,
  };
}
// Posts a brand new embed through the channel's webhook and saves it.
async function postEmbed({ guild, user, channel, title, content }) {
  const built = buildEmbedMessage(guild, {
    title,
    content,
    author: user,
    createdAt: Date.now(),
  });
  const hook = await ensureEmbedWebhook(guild, channel);
  const sent = await hook
    .send({ embeds: [built], allowedMentions: { parse: [] } })
    .catch((e) => {
      console.error("[embed] webhook send failed:", e.message);
      return null;
    });
  const row = store.createEmbed(guild.id, {
    channelId: channel.id,
    webhookId: hook.id,
    messageId: sent?.id || null,
    title: title || null,
    content,
    authorId: user.id,
    authorName: embedAuthorName(user),
  });
  if (!row) return { row: null, note: "I could not save the embed, so it has no ID." };
  return {
    row,
    note: sent ? "" : "*The message could not be posted — it was still saved.*",
  };
}
// Rewrites a saved embed, keeping the original author and creation date.
async function patchEmbed({ client, guild, user, row, channel, title, content }) {
  const author =
    (await client.users.fetch(row.author_id).catch(() => null)) ||
    client.users.cache.get(row.author_id) ||
    user;
  const built = buildEmbedMessage(guild, {
    title,
    content,
    author,
    createdAt: row.created_at,
  });
  const hook = await ensureEmbedWebhook(guild, channel);
  const sameChannel = row.channel_id === channel.id;
  if (sameChannel && row.webhook_id === hook.id && row.message_id) {
    const edited = await hook
      .editMessage(row.message_id, { embeds: [built] })
      .then(() => true)
      .catch(() => false);
    if (edited) {
      return {
        row: store.updateEmbed(guild.id, row.embed_id, {
          title: title || null,
          content,
        }),
        note: "",
      };
    }
  }
  // The message or webhook is gone (or the channel changed), so repost and
  // clean up whatever is left of the old message.
  const sent = await hook
    .send({ embeds: [built], allowedMentions: { parse: [] } })
    .catch((e) => {
      console.error("[embed] webhook send failed:", e.message);
      return null;
    });
  if (!sameChannel && row.message_id && row.webhook_id) {
    const oldHook = await guild.webhooks
      .fetch(row.webhook_id)
      .catch(() => null);
    await oldHook?.deleteMessage(row.message_id).catch(() => {});
  }
  const updated = store.updateEmbed(guild.id, row.embed_id, {
    channel_id: channel.id,
    webhook_id: hook.id,
    message_id: sent?.id || null,
    title: title || null,
    content,
  });
  return {
    row: updated,
    note: !sent
      ? "*The message could not be posted — the saved details were still updated.*"
      : sameChannel
        ? "The original message was gone, so a new one was posted."
        : "The embed moved to the new channel.",
  };
}
async function removeEmbed(guild, row) {
  const hook = row.webhook_id
    ? await guild.webhooks.fetch(row.webhook_id).catch(() => null)
    : null;
  if (hook && row.message_id)
    await hook.deleteMessage(row.message_id).catch(() => {});
  store.deleteEmbed(guild.id, row.embed_id);
}
function canManageEmbed(interaction, row) {
  if (isBotOwner(interaction.user?.id, interaction.client)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))
    return true;
  return Boolean(row && row.author_id && row.author_id === interaction.user?.id);
}
function canManageEmbedAs(userId, client, permissions, row) {
  return canManageEmbed({ user: { id: userId }, client, memberPermissions: permissions }, row);
}
function embedGate(interaction) {
  return (
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ||
    isBotOwner(interaction.user?.id, interaction.client)
  )
    ? null
    : "You need Manage Messages to manage embeds.";
}
function embedManageGate(userId, client, permissions) {
  return (
    permissions?.has(PermissionFlagsBits.ManageMessages) ||
    isBotOwner(userId, client)
  )
    ? null
    : "You need Manage Messages to manage embeds.";
}

const embedCmd = new SlashCommandBuilder()
  .setName("embed")
  .setDescription("Create and manage saved embed messages")
  .addSubcommand((s) =>
    s
      .setName("create")
      .setDescription("Open the embed form and post the embed")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Where to create the embed (default: this channel)"),
      ),
  )
  .addSubcommand((s) =>
    s.setName("list").setDescription("List every saved embed in this server"),
  )
  .addSubcommand((s) =>
    s
      .setName("edit")
      .setDescription("Edit an embed you created")
      .addStringOption((o) =>
        o
          .setName("id")
          .setDescription("Embed ID (8 characters)")
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("delete")
      .setDescription("Delete an embed you created")
      .addStringOption((o) =>
        o
          .setName("id")
          .setDescription("Embed ID (8 characters)")
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );
add(embedCmd, "Utility", "Manage Messages", async (i) => {
  const gate = embedGate(i);
  if (gate) return deny(i, gate);
  const sub = i.options.getSubcommand();

  if (sub === "create") {
    const channel = i.options.getChannel("channel") || i.channel;
    const channelError = usableEmbedChannel(channel);
    if (channelError) return deny(i, channelError);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`embed_create|${channel.id}`)
        .setLabel("Open form")
        .setStyle(ButtonStyle.Primary),
    );
    return respond(i, {
      content: `Fill in the form to create an embed in ${channel}.`,
      components: [row],
      ephemeral: true,
    });
  }

  if (sub === "list") return respond(i, renderEmbedList(i.guildId, i.guild));

  const id = i.options.getString("id")?.trim();
  const row = store.getEmbed(i.guildId, id);
  if (!row)
    return deny(i, `No embed found with id \`${id}\`. Use \`/embed list\` to see them.`);
  if (!canManageEmbed(i, row))
    return deny(i, `Only <@${row.author_id}> (the author) can ${sub} this embed.`);

  if (sub === "delete") {
    await removeEmbed(i.guild, row);
    return respond(i, {
      components: [
        embed(
          "Embed deleted",
          `\`${row.embed_id}\` was removed${
            channelMention(i.guild, row.channel_id)
              ? ` from ${channelMention(i.guild, row.channel_id)}`
              : ""
          }.`,
        ),
      ],
      ephemeral: true,
    });
  }

  const editChannel = await resolveEmbedChannel(i.guild, "", row.channel_id);
  const channelError = usableEmbedChannel(editChannel);
  if (channelError) return deny(i, `Cannot edit \`${row.embed_id}\`: ${channelError}`);
  return respond(i, {
    content: `Editing embed \`${row.embed_id}\`. Leave the channel field blank to keep it in ${channelMention(
      i.guild,
      row.channel_id,
    )}.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`embed_edit|${row.embed_id}`)
          .setLabel("Open form")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
    ephemeral: true,
  });
});
commands.find((c) => c.data.name === "embed").autocomplete = async (i) => {
  if (i.options.getSubcommand(false) !== "edit" && i.options.getSubcommand(false) !== "delete")
    return i.respond([]).catch(() => {});
  const query = String(i.options.getFocused() || "").toLowerCase();
  const choices = store
    .listEmbeds(i.guildId)
    .filter((r) => !query || r.embed_id.toLowerCase().includes(query))
    .slice(0, 25)
    .map((r) => ({
      name: `${r.embed_id} — ${(r.title || r.content || "(empty)").slice(0, 70)}`.slice(0, 100),
      value: r.embed_id,
    }));
  return i.respond(choices).catch(() => {});
};

async function handleEmbedButton(i) {
  if (!i.isButton()) return false;
  const [prefix, arg] = i.customId.split("|");
  if (prefix !== "embed_create" && prefix !== "embed_edit") return false;
  const gate = embedGate(i);
  if (gate) {
    return i
      .reply({ content: gate, ephemeral: true, allowedMentions: { parse: [] } })
      .then(() => true);
  }
  if (prefix === "embed_create") {
    const channel = await resolveEmbedChannel(i.guild, arg, i.channelId);
    const channelError = usableEmbedChannel(channel);
    if (channelError)
      return i
        .reply({ content: channelError, ephemeral: true, allowedMentions: { parse: [] } })
        .then(() => true);
    return i
      .showModal(
        embedFormModal({
          customId: `${EMBED_FORM_CREATE}|${channel.id}`,
          channelLabel: `#${channel.name}`,
        }),
      )
      .then(() => true);
  }
  const row = store.getEmbed(i.guildId, arg);
  if (!row)
    return i
      .reply({
        content: `That embed no longer exists. Use \`/embed list\` to see the current ones.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      })
      .then(() => true);
  if (!canManageEmbed(i, row))
    return i
      .reply({
        content: `Only <@${row.author_id}> (the author) can edit this embed.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      })
      .then(() => true);
  const channel = await resolveEmbedChannel(i.guild, "", row.channel_id);
  const channelError = usableEmbedChannel(channel);
  if (channelError)
    return i
      .reply({ content: channelError, ephemeral: true, allowedMentions: { parse: [] } })
      .then(() => true);
  return i
    .showModal(
      embedFormModal({
        customId: `${EMBED_FORM_EDIT}|${row.embed_id}`,
        channelLabel: channel ? `#${channel.name}` : "",
        title: row.title || "",
        content: row.content || "",
      }),
    )
    .then(() => true);
}

async function embedFormReply(i, payload) {
  const response = { ...normalizeResponse(payload), allowedMentions: { parse: [] } };
  // The form was opened from a button message, so replacing that message keeps
  // the whole flow on one ephemeral reply instead of stacking follow-ups.
  const updated = await i
    .update({ ...response, components: response.components ?? [] })
    .catch(() => null);
  if (updated) return updated;
  return i
    .editReply({ ...response, flags: MessageFlags.Ephemeral })
    .catch(() => null);
}

async function handleEmbedModal(i) {
  if (!i.isModalSubmit()) return false;
  const [kind, arg] = i.customId.split("|");
  if (kind !== EMBED_FORM_CREATE && kind !== EMBED_FORM_EDIT) return false;
  await submitEmbedForm(i, kind, arg);
  return true;
}

async function submitEmbedForm(i, kind, arg) {
  const label = kind === EMBED_FORM_EDIT ? "Embed not edited" : "Embed not created";
  const gate = embedGate(i);
  if (gate) {
    await i.deferUpdate().catch(() => {});
    return embedFormReply(i, { content: gate });
  }

  const fields = i.fields.getTextInputValue("channel");
  const title = i.fields.getTextInputValue("title").trim();
  const content = i.fields.getTextInputValue("content").trim();
  if (!content) {
    await i.deferUpdate().catch(() => {});
    return embedFormReply(i, {
      components: [embed(label, "The content field was empty.")],
    });
  }

  const existing = kind === EMBED_FORM_EDIT ? store.getEmbed(i.guildId, arg) : null;
  if (kind === EMBED_FORM_EDIT && !existing) {
    await i.deferUpdate().catch(() => {});
    return embedFormReply(i, {
      components: [embed(label, "That embed no longer exists.")],
    });
  }
  if (existing && !canManageEmbed(i, existing)) {
    await i.deferUpdate().catch(() => {});
    return embedFormReply(i, {
      components: [
        embed(label, `Only <@${existing.author_id}> (the author) can edit this embed.`),
      ],
    });
  }

  const fallbackChannelId = existing ? existing.channel_id : arg;
  const channel = await resolveEmbedChannel(i.guild, fields, fallbackChannelId);
  const channelError = usableEmbedChannel(channel);
  if (channelError) {
    await i.deferUpdate().catch(() => {});
    return embedFormReply(i, { components: [embed(label, channelError)] });
  }

  // Past this point the form does real work, so acknowledge it first.
  await i.deferUpdate().catch(() => {});
  const run = existing
    ? patchEmbed({
        client: i.client,
        guild: i.guild,
        user: i.user,
        row: existing,
        channel,
        title,
        content,
      })
    : postEmbed({ guild: i.guild, user: i.user, channel, title, content });

  let outcome;
  try {
    outcome = await run;
  } catch (e) {
    return embedFormReply(i, {
      components: [embed(label, `I could not post the embed: ${e.message}`)],
    });
  }
  if (!outcome.row) {
    return embedFormReply(i, {
      components: [
        embed(label, `The embed was posted to ${channel} but ${outcome.note}`),
      ],
    });
  }
  return embedFormReply(i, {
    components: [embedResultEmbed(outcome.row, channel, outcome.note)],
  });
}

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
  pingStaleTickets,
  formatIdle,
  buildDnEmbed,
  dnMissMessage,
  dnLinkStyle,
  dnButtonRow,
  DN_BUTTON_TTL_MS,
  DN_LINK_STYLES,
  FARM_TYPES,
  handleEmbedButton,
  handleEmbedModal,
  resolveEmbedChannel,
  usableEmbedChannel,
  renderEmbedList,
  postEmbed,
  patchEmbed,
  removeEmbed,
  canManageEmbedAs,
  embedManageGate,
  embedResultEmbed,
  EMBED_MAX_CONTENT,
};
