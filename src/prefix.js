const { PermissionFlagsBits } = require("discord.js");
const store = require("./database");
const {
  embed,
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
  logModeration,
} = require("./commands");

const DEFAULT_PREFIX = "m.";

function getPrefix(guildId) {
  return store.getPrefix(guildId) || DEFAULT_PREFIX;
}

function parsePrefixMessage(message) {
  const prefix = getPrefix(message.guild.id);
  if (!message.content.startsWith(prefix)) return null;

  const input = message.content.slice(prefix.length).trim();
  if (!input) return null;

  const [name, ...argumentsList] = input.split(/\s+/);
  return { name: name.toLowerCase(), arguments: argumentsList };
}

function reply(message, payload) {
  const options = typeof payload === "string" ? { content: payload } : { ...payload };
  if (options.components) options.flags = (options.flags || 0) | 32768;
  return message.reply(options).catch((error) => {
    console.error("[prefix] failed to reply:", error.message);
  });
}

function cleanId(text) {
  if (!text) return null;
  const match = text.match(/^<@!?(\d+)>$|^<@&(\d+)>$|^<#(\d+)>$|^(\d+)$/);
  return match ? match[1] || match[2] || match[3] || match[4] : null;
}

async function resolveUser(client, guild, arg) {
  if (!arg) return null;
  const id = cleanId(arg);
  if (id) {
    try {
      return await client.users.fetch(id);
    } catch {
      // ignore fetch error
    }
  }
  return null;
}

async function resolveMember(guild, arg) {
  if (!arg) return null;
  const id = cleanId(arg);
  if (id) {
    try {
      return await guild.members.fetch(id);
    } catch {
      // ignore fetch error
    }
  }
  return null;
}

function resolveRole(guild, arg) {
  if (!arg) return null;
  const id = cleanId(arg);
  if (id && guild.roles.cache.has(id)) {
    return guild.roles.cache.get(id);
  }
  const lower = arg.toLowerCase();
  return (
    guild.roles.cache.find((r) => r.name.toLowerCase() === lower) || null
  );
}

function resolveChannel(guild, arg) {
  if (!arg) return null;
  const id = cleanId(arg);
  if (id && guild.channels.cache.has(id)) {
    return guild.channels.cache.get(id);
  }
  const lower = arg.toLowerCase();
  return (
    guild.channels.cache.find((c) => c.name.toLowerCase() === lower) || null
  );
}

async function handlePrefixMessage(message) {
  if (message.author.bot || !message.guild) return;

  const command = parsePrefixMessage(message);
  if (!command) return;

  const p = getPrefix(message.guild.id);

  logCommand(message.guild.id, message.client, {
    command: `${p}${command.name}`,
    input: command.arguments.join(" "),
    user: message.author,
    channelName: message.channel?.name,
  }).catch(() => {});

  if (command.name === "tags") {
    const tagList = store.listTags(message.guild.id);
    return reply(message, {
      components: [
        embed(
          "Claimable tags",
          tagList.length
            ? tagList.map((tag) => `\`${tag.display_name}\``).join(", ")
            : "No tags are available.",
        ),
      ],
    });
  }

  if (command.name === "help") {
    return reply(message, {
      components: [buildHelpEmbed(p), buildHelpRow()],
    });
  }

  if (command.name === "prefix") {
    return reply(
      message,
      "This server uses the `" + p + "` prefix.",
    );
  }

  if (command.name === "settings") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.Administrator) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "Only server administrators can change settings.");
    }

    const [key, ...valParts] = command.arguments;
    const val = valParts.join(" ").trim();

    if (!key) {
      const s = store.settings(message.guild.id);
      return reply(message, {
        components: [
          embed(
            "Guild settings",
            `Mute role: ${s.mute_role_id ? `<@&${s.mute_role_id}>` : "not set"}\nSupport category: ${s.support_category_id ? `<#${s.support_category_id}>` : "not set"}\nManager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "not set"}\nLog channel: ${s.log_channel_id ? `<#${s.log_channel_id}>` : "not set"}\nPrefix: ${s.prefix || "m."}`,
          ),
        ],
      });
    }

    const lowerKey = key.toLowerCase();
    if (lowerKey === "prefix") {
      if (!val) {
        return reply(message, `Usage: \`${p}settings prefix <new-prefix>\``);
      }
      if (val.length > 5 || /\s/.test(val)) {
        return reply(
          message,
          "The prefix must be 1–5 characters and cannot contain spaces.",
        );
      }
      const s = store.updateSettings(message.guild.id, { prefix: val });
      return reply(message, {
        components: [
          embed(
            "Settings updated",
            `Mute role: ${s.mute_role_id ? `<@&${s.mute_role_id}>` : "not set"}\nSupport category: ${s.support_category_id ? `<#${s.support_category_id}>` : "not set"}\nManager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "not set"}\nLog channel: ${s.log_channel_id ? `<#${s.log_channel_id}>` : "not set"}\nPrefix: ${s.prefix || "m."}`,
          ),
        ],
      });
    }

    if (lowerKey === "mute_role") {
      const role = val === "none" || val === "reset" ? null : resolveRole(message.guild, val);
      if (val !== "none" && val !== "reset" && !role) {
        return reply(message, `Role not found. Usage: \`${p}settings mute_role <@role|none>\``);
      }
      const s = store.updateSettings(message.guild.id, { mute_role_id: role ? role.id : null });
      return reply(message, {
        components: [embed("Settings updated", `Mute role set to: ${role ? `<@&${role.id}>` : "not set"}`)],
      });
    }

    if (lowerKey === "manager_role") {
      const role = val === "none" || val === "reset" ? null : resolveRole(message.guild, val);
      if (val !== "none" && val !== "reset" && !role) {
        return reply(message, `Role not found. Usage: \`${p}settings manager_role <@role|none>\``);
      }
      const s = store.updateSettings(message.guild.id, { manager_role_id: role ? role.id : null });
      return reply(message, {
        components: [embed("Settings updated", `Manager role set to: ${role ? `<@&${role.id}>` : "not set"}`)],
      });
    }

    if (lowerKey === "support_category") {
      const channel = val === "none" || val === "reset" ? null : resolveChannel(message.guild, val);
      if (val !== "none" && val !== "reset" && (!channel || channel.type !== 4)) {
        return reply(message, `Category not found. Support category must be a category channel. Usage: \`${p}settings support_category <category_id|none>\``);
      }
      const s = store.updateSettings(message.guild.id, { support_category_id: channel ? channel.id : null });
      return reply(message, {
        components: [embed("Settings updated", `Support category set to: ${channel ? `<#${channel.id}>` : "not set"}`)],
      });
    }

    if (lowerKey === "log_channel") {
      const channel = val === "none" || val === "reset" ? null : resolveChannel(message.guild, val);
      if (val !== "none" && val !== "reset" && !channel) {
        return reply(message, `Channel not found. Usage: \`${p}settings log_channel <#channel|none>\``);
      }
      const s = store.updateSettings(message.guild.id, { log_channel_id: channel ? channel.id : null });
      return reply(message, {
        components: [embed("Settings updated", `Log channel set to: ${channel ? `<#${channel.id}>` : "not set"}`)],
      });
    }

    return reply(
      message,
      `Unknown setting key \`${key}\`. Valid keys: \`prefix\`, \`mute_role\`, \`manager_role\`, \`support_category\`, \`log_channel\`.`,
    );
  }

  if (command.name === "invite") {
    return reply(message, {
      components: [embed("Invite Mihulish", "Click the link below to invite me to your server.\nhttps://invite.ro-mihaiu.xyz")],
    });
  }

  if (command.name === "vote") {
    const result = store.vote(message.guild.id, message.author.id);
    if (!result.ok) {
      return reply(message, {
        components: [
          embed("Vote cooldown", `You can vote again in **${result.remainingMinutes}** minute(s).\nCurrent streak: **${result.streak}** 🔥`),
        ],
      });
    }
    const desc = [];
    desc.push(`**Your vote** has been recorded!`);
    desc.push(`**Server streak:** **${result.streak}** 🔥`);
    if (result.isNewStreak) desc.push("*(streak reset — votes had expired)*");
    if (result.prevVoterId && result.prevVoterId !== message.author.id) {
      desc.push(`Last vote by <@${result.prevVoterId}>`);
    }
    return reply(message, {
      components: [embed("Vote recorded", desc.join("\n"))],
    });
  }

  if (command.name === "votes") {
    const v = store.getVotes(message.guild.id);
    const desc = [];
    desc.push(`**Current streak:** **${v.streak}** 🔥`);
    if (v.lastVoterId) {
      desc.push(`Last vote by <@${v.lastVoterId}>`);
      desc.push(`<t:${Math.floor(v.lastVoteAt / 1000)}:R>`);
    } else {
      desc.push("No votes yet — use `" + p + "vote` to start the streak!");
    }
    return reply(message, {
      components: [embed("Server vote streak", desc.join("\n"))],
    });
  }

  if (command.name === "warn") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.ModerateMembers) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Moderate Members.");
    }
    const [userArg, ...reasonParts] = command.arguments;
    const targetMember = await resolveMember(message.guild, userArg);
    const targetUser = targetMember ? targetMember.user : await resolveUser(message.client, message.guild, userArg);
    const reason = reasonParts.join(" ").trim();
    if (!targetUser || !reason) {
      return reply(message, `Usage: \`${p}warn <@user|id> <reason>\``);
    }
    const w = store.addWarning(message.guild.id, targetUser.id, message.author.id, reason);
    logModeration(message.guild.id, message.client, {
      action: "warn",
      targetId: targetUser.id,
      moderatorId: message.author.id,
      reason,
    });
    return reply(message, {
      components: [
        embed(
          "Warning issued",
          `<@${targetUser.id}> received warning **#${w.id}**.\nReason: ${reason}`,
        ),
      ],
    });
  }

  if (command.name === "unwarn") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.ModerateMembers) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Moderate Members.");
    }
    const [userArg, idArg] = command.arguments;
    const id = parseInt(idArg, 10);
    const targetMember = await resolveMember(message.guild, userArg);
    const targetUser = targetMember ? targetMember.user : await resolveUser(message.client, message.guild, userArg);
    if (!targetUser || isNaN(id) || id < 1) {
      return reply(message, `Usage: \`${p}unwarn <@user|id> <warn-id>\``);
    }
    const w = store.getWarning(message.guild.id, id);
    if (!w) {
      return reply(message, `Warning #${id} was not found.`);
    }
    if (w.user_id !== targetUser.id) {
      return reply(message, `Warning #${id} does not belong to <@${targetUser.id}>.`);
    }
    store.deleteWarning(message.guild.id, id);
    logModeration(message.guild.id, message.client, {
      action: "unwarn",
      targetId: targetUser.id,
      moderatorId: message.author.id,
      reason: w.reason,
    });
    return reply(message, {
      components: [
        embed(
          "Warning removed",
          `Warning **#${id}** for <@${targetUser.id}> was removed.\nReason was: ${w.reason}`,
        ),
      ],
    });
  }

  if (command.name === "warns") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const [userArg] = command.arguments;
    const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
    if (!targetUser) return reply(message, "User not found.");
    const rows = store.warnings(message.guild.id, targetUser.id);
    const text = rows.length
      ? rows
          .slice(0, 15)
          .map(
            (w) =>
              `**#${w.id}** <@${w.user_id}> — ${w.reason}\nBy <@${w.moderator_id}> · ${stamp(w.created_at)}`,
          )
          .join("\n\n")
      : "No warnings found.";
    return reply(message, {
      components: [embed("Member warnings", text)],
    });
  }

  if (command.name === "warnings") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const rows = store.warnings(message.guild.id);
    const text = rows.length
      ? rows
          .slice(0, 15)
          .map(
            (w) =>
              `**#${w.id}** <@${w.user_id}> — ${w.reason}\nBy <@${w.moderator_id}> · ${stamp(w.created_at)}`,
          )
          .join("\n\n")
      : "No warnings found.";
    return reply(message, {
      components: [embed("Server warnings", text)],
    });
  }

  if (command.name === "mute") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.ModerateMembers) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Moderate Members.");
    }
    const [userArg, minArg, ...reasonParts] = command.arguments;
    const minutes = parseInt(minArg, 10);
    const targetMember = await resolveMember(message.guild, userArg);
    const reason = reasonParts.join(" ").trim() || "No reason provided";
    if (!targetMember || isNaN(minutes) || minutes < 1 || minutes > 40320) {
      return reply(
        message,
        `Usage: \`${p}mute <@user|id> <minutes 1-40320> [reason]\``,
      );
    }
    if (
      targetMember.id === message.guild.ownerId ||
      (!isBotOwner(message.author.id, message.client) &&
        ((message.guild.members.me && targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position) ||
          targetMember.roles.highest.position >= message.member.roles.highest.position))
    ) {
      return reply(message, "You cannot mute that member.");
    }
    await targetMember.timeout(minutes * 60000, reason);
    return reply(message, {
      components: [
        embed(
          "Mute complete",
          `<@${targetMember.id}> was timed out for ${minutes} minute(s).\nReason: ${reason}`,
        ),
      ],
    });
  }

  if (command.name === "unmute") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.ModerateMembers) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Moderate Members.");
    }
    const [userArg, ...reasonParts] = command.arguments;
    const targetMember = await resolveMember(message.guild, userArg);
    const reason = reasonParts.join(" ").trim() || "No reason provided";
    if (!targetMember) {
      return reply(message, `Usage: \`${p}unmute <@user|id> [reason]\``);
    }
    if (
      targetMember.id === message.guild.ownerId ||
      (!isBotOwner(message.author.id, message.client) &&
        ((message.guild.members.me && targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position) ||
          targetMember.roles.highest.position >= message.member.roles.highest.position))
    ) {
      return reply(message, "You cannot moderate a member with an equal or higher role.");
    }
    const s = store.settings(message.guild.id);
    if (s.mute_role_id && targetMember.roles?.cache?.has(s.mute_role_id)) {
      await targetMember.roles.remove(s.mute_role_id).catch(() => {});
    }
    await targetMember.timeout(null, reason);
    logModeration(message.guild.id, message.client, {
      action: "unmute",
      targetId: targetMember.id,
      moderatorId: message.author.id,
      reason,
    });
    return reply(message, {
      components: [
        embed(
          "Unmute complete",
          `<@${targetMember.id}> was unmuted.\nReason: ${reason}`,
        ),
      ],
    });
  }

  if (command.name === "kick") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.KickMembers) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Kick Members.");
    }
    const [userArg, ...reasonParts] = command.arguments;
    const targetMember = await resolveMember(message.guild, userArg);
    const reason = reasonParts.join(" ").trim() || "No reason provided";
    if (!targetMember) {
      return reply(message, `Usage: \`${p}kick <@user|id> [reason]\``);
    }
    if (
      targetMember.id === message.guild.ownerId ||
      targetMember.id === message.client.user.id
    ) {
      return reply(message, "That member cannot be moderated.");
    }
    if (
      !isBotOwner(message.author.id, message.client) &&
      ((message.guild.members.me && targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position) ||
        targetMember.roles.highest.position >= message.member.roles.highest.position)
    ) {
      return reply(message, "You cannot moderate a member with an equal or higher role.");
    }
    await targetMember.kick(reason);
    logModeration(message.guild.id, message.client, {
      action: "kick",
      targetId: targetMember.id,
      moderatorId: message.author.id,
      reason,
    });
    return reply(message, {
      components: [
        embed("Kick complete", `<@${targetMember.id}> was kicked.\nReason: ${reason}`),
      ],
    });
  }

  if (command.name === "ban" || command.name === "softban") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.BanMembers) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Ban Members.");
    }
    const [userArg, ...reasonParts] = command.arguments;
    const targetMember = await resolveMember(message.guild, userArg);
    const targetUser = targetMember ? targetMember.user : await resolveUser(message.client, message.guild, userArg);
    const reason = reasonParts.join(" ").trim() || "No reason provided";
    if (!targetUser) {
      return reply(message, `Usage: \`${p}${command.name} <@user|id> [reason]\``);
    }
    if (
      targetUser.id === message.guild.ownerId ||
      targetUser.id === message.client.user.id
    ) {
      return reply(message, "That member cannot be moderated.");
    }
    if (
      !isBotOwner(message.author.id, message.client) &&
      targetMember &&
      ((message.guild.members.me && targetMember.roles.highest.position >= message.guild.members.me.roles.highest.position) ||
        targetMember.roles.highest.position >= message.member.roles.highest.position)
    ) {
      return reply(message, "You cannot moderate a member with an equal or higher role.");
    }
    if (command.name === "softban") {
      await message.guild.members.ban(targetUser.id, {
        reason: `[Softban] ${reason}`,
        deleteMessageSeconds: 86400 * 7,
      });
      await message.guild.members.unban(targetUser.id, "Softban unban");
      logModeration(message.guild.id, message.client, {
        action: "softban",
        targetId: targetUser.id,
        moderatorId: message.author.id,
        reason,
      });
      return reply(message, {
        components: [
          embed("Softban complete", `<@${targetUser.id}> was softbanned.\nReason: ${reason}`),
        ],
      });
    } else {
      await message.guild.members.ban(targetUser.id, { reason });
      logModeration(message.guild.id, message.client, {
        action: "ban",
        targetId: targetUser.id,
        moderatorId: message.author.id,
        reason,
      });
      return reply(message, {
        components: [
          embed("Ban complete", `<@${targetUser.id}> was banned.\nReason: ${reason}`),
        ],
      });
    }
  }

  if (command.name === "unban") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.BanMembers) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Ban Members.");
    }
    const [userArg, ...reasonParts] = command.arguments;
    const targetUser = await resolveUser(message.client, message.guild, userArg);
    const reason = reasonParts.join(" ").trim() || "No reason provided";
    if (!targetUser) {
      return reply(message, `Usage: \`${p}unban <@user|id> [reason]\``);
    }
    try {
      await message.guild.members.unban(targetUser.id, reason);
      logModeration(message.guild.id, message.client, {
        action: "unban",
        targetId: targetUser.id,
        moderatorId: message.author.id,
        reason,
      });
    } catch (e) {
      if (e.code === 10026) {
        return reply(message, "That user is not banned.");
      }
      return reply(message, `Failed to unban user: ${e.message}`);
    }
    return reply(message, {
      components: [
        embed(
          "Unban complete",
          `<@${targetUser.id}> was unbanned.\nReason: ${reason}`,
        ),
      ],
    });
  }

  if (command.name === "bans") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.BanMembers) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Ban Members.");
    }
    const rows = await message.guild.bans.fetch();
    return reply(message, {
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
  }

  if (command.name === "loa") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const [sub, ...args] = command.arguments;
    if (sub === "rules") {
      return reply(message, {
        components: [
          embed(
            "LOA rules",
            "Use LOA when fully unavailable. Give a clear reason and an optional end date. Return to active status when available again.",
          ),
        ],
      });
    }
    if (sub === "status") {
      const [activeStr, ...rest] = args;
      if (!activeStr) {
        return reply(message, `Usage: \`${p}loa status <on|off> <reason> [ends_in_days]\``);
      }
      const active = ["on", "true", "yes", "active", "1"].includes(activeStr.toLowerCase());
      let days = null;
      let reason = rest.join(" ").trim();
      const lastArg = rest[rest.length - 1];
      if (rest.length > 1 && /^\d+$/.test(lastArg)) {
        days = parseInt(lastArg, 10);
        reason = rest.slice(0, -1).join(" ").trim();
      }
      if (active && !reason) {
        return reply(message, `Please provide a reason. Usage: \`${p}loa status on <reason> [ends_in_days]\``);
      }
      store.setLeave(
        "loa",
        message.guild.id,
        message.author.id,
        active,
        reason || (active ? "LOA" : "Returned"),
        null,
        days ? Date.now() + days * 86400000 : null,
      );
      const nickError = await setLeaveNickname(message.member, message.guild, "loa", active);
      const embedText = nickError
        ? `<@${message.author.id}> — ${reason || (active ? "LOA" : "Returned")}\n⚠️ ${nickError}`
        : `<@${message.author.id}> — ${reason || (active ? "LOA" : "Returned")}`;
      return reply(message, {
        components: [embed(active ? "LOA active" : "LOA removed", embedText)],
      });
    }
    if (sub === "check") {
      const [userArg] = args;
      const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      const row = store.getLeave("loa", message.guild.id, targetUser.id);
      return reply(message, {
        components: [
          embed(
            "LOA status",
            row && row.active
              ? `<@${row.user_id}> — ${row.reason} · since ${stamp(row.started_at)}${row.ends_at ? ` · ends ${stamp(row.ends_at)}` : ""}`
              : `<@${targetUser.id}> is not currently on LOA.`,
          ),
        ],
      });
    }
    if (sub === "list") {
      const rows = store.listLeave("loa", message.guild.id);
      return reply(message, {
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
    }
    return reply(message, `Usage: \`${p}loa <rules|status|check|list>\``);
  }

  if (command.name === "sloa") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const [sub, ...args] = command.arguments;
    if (sub === "rules") {
      return reply(message, {
        components: [
          embed(
            "SLOA rules",
            "Use SLOA when partially available. Describe your availability clearly and keep it updated.",
          ),
        ],
      });
    }
    if (sub === "status") {
      const [activeStr, ...rest] = args;
      if (!activeStr) {
        return reply(message, `Usage: \`${p}sloa status <on|off> <reason> | <availability> [ends_in_days]\``);
      }
      const active = ["on", "true", "yes", "active", "1"].includes(activeStr.toLowerCase());
      const fullRest = rest.join(" ");
      let reason = "SLOA";
      let availability = "Partial availability";
      let days = null;
      if (fullRest.includes("|")) {
        const parts = fullRest.split("|");
        reason = parts[0].trim();
        const restAvail = parts.slice(1).join("|").trim();
        const matchDays = restAvail.match(/\s+(\d+)$/);
        if (matchDays) {
          days = parseInt(matchDays[1], 10);
          availability = restAvail.slice(0, -matchDays[0].length).trim();
        } else {
          availability = restAvail;
        }
      } else if (rest.length > 0) {
        reason = rest.join(" ").trim();
        availability = reason;
      }
      store.setLeave(
        "sloa",
        message.guild.id,
        message.author.id,
        active,
        reason,
        availability,
        days ? Date.now() + days * 86400000 : null,
      );
      const nickError = await setLeaveNickname(message.member, message.guild, "sloa", active);
      const embedText = nickError
        ? `<@${message.author.id}> — ${availability}\n⚠️ ${nickError}`
        : `<@${message.author.id}> — ${availability}`;
      return reply(message, {
        components: [embed(active ? "SLOA active" : "SLOA removed", embedText)],
      });
    }
    if (sub === "check") {
      const [userArg] = args;
      const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      const row = store.getLeave("sloa", message.guild.id, targetUser.id);
      return reply(message, {
        components: [
          embed(
            "SLOA status",
            row && row.active
              ? `<@${row.user_id}> — ${row.reason} · ${row.availability}`
              : `<@${targetUser.id}> is not currently on SLOA.`,
          ),
        ],
      });
    }
    if (sub === "list") {
      const rows = store.listLeave("sloa", message.guild.id);
      return reply(message, {
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
    }
    return reply(message, `Usage: \`${p}sloa <rules|status|check|list>\``);
  }

  if (command.name === "staff" || command.name === "staffs") {
    const [sub, userArg, roleArg] = command.arguments;
    if (command.name === "staffs" || sub === "list") {
      if (!staffCheck(message.guild.id, message.member, message.client)) {
        return reply(message, "You must be configured staff to use this command.");
      }
      return reply(message, {
        components: [await buildStaffDirectory(message.guild)],
      });
    }
    if (!managerCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "Only managers can manage staff.");
    }
    if (sub === "remove") {
      const targetUser = await resolveUser(message.client, message.guild, userArg);
      if (!targetUser) return reply(message, `Usage: \`${p}staff remove <@user|id>\``);
      store.removeStaff(message.guild.id, targetUser.id);
      return reply(message, {
        components: [embed("Staff removed", `<@${targetUser.id}> is no longer registered staff.`)],
      });
    }
    if (sub === "add" || sub === "upgrade") {
      const targetUser = await resolveUser(message.client, message.guild, userArg);
      if (!targetUser) return reply(message, `Usage: \`${p}staff ${sub} <@user|id> [@role]\``);
      const role = roleArg ? resolveRole(message.guild, roleArg) : null;
      store.upsertStaff(message.guild.id, targetUser.id, role?.id || null, message.author.id);
      if (role) {
        try {
          const m = await message.guild.members.fetch(targetUser.id);
          if (!m.roles.cache.has(role.id)) await m.roles.add(role);
        } catch {
          // ignore role assign error
        }
      }
      return reply(message, {
        components: [
          embed(
            sub === "add" ? "Staff added" : "Staff upgraded",
            `<@${targetUser.id}> is registered as staff.`,
          ),
        ],
      });
    }
    return reply(message, `Usage: \`${p}staff <list|add|remove|upgrade> [@user] [@role]\``);
  }

  if (command.name === "tag") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const [sub, tagArg, userArg] = command.arguments;
    const isMgr = managerCheck(message.guild.id, message.member, message.client);
    if (["create", "delete", "ping"].includes(sub) && !isMgr) {
      return reply(message, "Only managers can manage available tags or ping tags.");
    }
    if (sub === "create") {
      if (!tagArg) return reply(message, `Usage: \`${p}tag create <name>\``);
      const name = tagArg.trim().toLowerCase();
      store.tag(message.guild.id, name);
      return reply(message, `Tag \`${name}\` created.`);
    }
    if (sub === "delete") {
      if (!tagArg) return reply(message, `Usage: \`${p}tag delete <name>\``);
      const name = tagArg.trim().toLowerCase();
      store.deleteTag(message.guild.id, name);
      return reply(message, `Tag \`${name}\` deleted.`);
    }
    if (sub === "ping") {
      if (!tagArg) return reply(message, `Usage: \`${p}tag ping <name>\``);
      const name = tagArg.trim().toLowerCase();
      const members = store.tagMembers(message.guild.id, name);
      if (!members.length) return reply(message, `No staff members have the \`${name}\` tag.`);
      return reply(message, members.map((id) => `<@${id}>`).join(" "));
    }
    if (sub === "check") {
      if (!tagArg) return reply(message, `Usage: \`${p}tag check <name>\``);
      const name = tagArg.trim().toLowerCase();
      const members = store.tagMembers(message.guild.id, name);
      return reply(message, {
        components: [
          embed(
            `Staff with ${name}`,
            members.length ? members.map((id) => `<@${id}>`).join("\n") : "None",
          ),
        ],
      });
    }
    if (sub === "add") {
      if (!tagArg) return reply(message, `Usage: \`${p}tag add <tag> [@user]\``);
      const name = tagArg.trim().toLowerCase();
      const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      store.addStaffTag(message.guild.id, name, targetUser.id, message.author.id);
      return reply(message, `Assigned tag \`${name}\` to <@${targetUser.id}>.`);
    }
    if (sub === "remove") {
      if (!tagArg) return reply(message, `Usage: \`${p}tag remove <tag> [@user]\``);
      const name = tagArg.trim().toLowerCase();
      const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      store.removeStaffTag(message.guild.id, name, targetUser.id);
      return reply(message, `Removed tag \`${name}\` from <@${targetUser.id}>.`);
    }
    if (sub === "list") {
      const targetUser = tagArg ? await resolveUser(message.client, message.guild, tagArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      const tagsList = store.userTags(message.guild.id, targetUser.id);
      return reply(message, {
        components: [
          embed(
            `Tags for ${targetUser.username}`,
            tagsList.length ? tagsList.map((t) => `\`${t.name}\``).join(", ") : "No tags assigned.",
          ),
        ],
      });
    }
    return reply(message, `Usage: \`${p}tag <add|remove|list|check|ping|create|delete>\``);
  }

  if (command.name === "claim") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const t = store.ticket(message.guild.id, message.channel.id);
    if (!t || t.status !== "OPEN" || !t.ticket_user_id) {
      return reply(message, "This is not a recognized open ticket.");
    }
    store.assignTicket(message.guild.id, message.channel.id, message.author.id);
    return reply(message, {
      content: `<@${t.ticket_user_id}> <@${message.author.id}> has claimed this ticket.`,
      allowedMentions: { users: [t.ticket_user_id, message.author.id] },
    });
  }

  if (command.name === "transfer") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const [userArg] = command.arguments;
    const targetUser = await resolveUser(message.client, message.guild, userArg);
    if (!targetUser) {
      return reply(message, `Usage: \`${p}transfer <@user|id>\``);
    }
    const t = store.ticket(message.guild.id, message.channel.id);
    if (!t || t.status !== "OPEN" || !t.ticket_user_id) {
      return reply(message, "This is not a recognized open ticket.");
    }
    if (!store.isStaff(message.guild.id, targetUser.id) && !isBotOwner(targetUser.id, message.client)) {
      return reply(message, "The recipient must be registered staff.");
    }
    store.assignTicket(message.guild.id, message.channel.id, targetUser.id);
    return reply(message, {
      content: `<@${t.ticket_user_id}> <@${targetUser.id}> has received this ticket from <@${message.author.id}>.`,
      allowedMentions: { users: [t.ticket_user_id, targetUser.id, message.author.id] },
    });
  }

  if (command.name === "unclaim") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const t = store.ticket(message.guild.id, message.channel.id);
    if (!t || !t.assigned_staff_id) {
      return reply(message, "This ticket is not claimed.");
    }
    const isMgr = managerCheck(message.guild.id, message.member, message.client);
    if (t.assigned_staff_id !== message.author.id && !isMgr) {
      return reply(
        message,
        "Only the assigned staff member or a manager can unclaim this ticket.",
      );
    }
    store.assignTicket(message.guild.id, message.channel.id, null);
    return reply(message, {
      content: `<@${t.ticket_user_id || "0"}> The ticket is no longer assigned.`,
      allowedMentions: { users: t.ticket_user_id ? [t.ticket_user_id] : [] },
    });
  }

  return reply(
    message,
    "Unknown command `" +
      command.name +
      "`. Use `" +
      p +
      "help` for all commands.",
  );
}

module.exports = {
  DEFAULT_PREFIX,
  getPrefix,
  parsePrefixMessage,
  handlePrefixMessage,
  cleanId,
  resolveUser,
  resolveMember,
  resolveRole,
  resolveChannel,
};
