const { PermissionFlagsBits } = require("discord.js");
const store = require("./database");
const {
  embed,
  buildHelpEmbed,
  buildHelpRow,
  buildUpdateEmbed,
  setLeaveNickname,
  staffStatusLine,
  buildStaffDirectory,
  staffCheck,
  managerCheck,
  isBotOwner,
  DN_STAFF_ROLE_ID,
  buildDnEmbed,
  dnMissMessage,
  dnLinkStyle,
  DN_LINK_STYLES,
  findFarmByVideo,
  pingStaleTickets,
  formatIdle,
  stamp,
  logCommand,
  logModeration,
  sendDM,
  FARM_TYPES,
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
  isLearningEnabled,
  setLearningEnabled,
  buildLearningReviewEmbed,
} = require("./commands");
const { fetchVideoTitle, searchWikis } = require("./utils");

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
  if (options.components) {
    options.embeds = options.components.filter((component) => component.data?.title);
    options.components = options.components.filter((component) => !component.data?.title);
    if (!options.components.length) delete options.components;
  }
  return message.reply(options).catch(async (error) => {
    // A deleted trigger message makes the implicit reply reference invalid; retry
    // once without it so the command still answers.
    if (/MESSAGE_REFERENCE_UNKNOWN_MESSAGE/.test(error?.message ?? "")) {
      try {
        return await message.channel.send({ ...options, messageReference: undefined });
      } catch (retryError) {
        console.error("[prefix] failed to reply:", retryError.message);
        return null;
      }
    }
    console.error("[prefix] failed to reply:", error.message);
    return null;
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

  if (command.name === "update") {
    return reply(message, { components: [buildUpdateEmbed()] });
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
          `Mute role: ${s.mute_role_id ? `<@&${s.mute_role_id}>` : "not set"}\nSupport category: ${s.support_category_id ? `<#${s.support_category_id}>` : "not set"}\nManager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "not set"}\nLog channel: ${s.log_channel_id ? `<#${s.log_channel_id}>` : "not set"}\nPrefix: ${s.prefix || "m."}\nAppeal link: ${s.appeal_link || "not set"}`,
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
            `Mute role: ${s.mute_role_id ? `<@&${s.mute_role_id}>` : "not set"}\nSupport category: ${s.support_category_id ? `<#${s.support_category_id}>` : "not set"}\nManager role: ${s.manager_role_id ? `<@&${s.manager_role_id}>` : "not set"}\nLog channel: ${s.log_channel_id ? `<#${s.log_channel_id}>` : "not set"}\nPrefix: ${s.prefix || "m."}\nAppeal link: ${s.appeal_link || "not set"}`,
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

  if (command.name === "link") {
    if (!managerCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "Only managers can set links.");
    }
    const [type, ...linkParts] = command.arguments;
    const link = linkParts.join(" ").trim();
    if (!type || !link) {
      return reply(message, `Usage: \`${p}link <type> <url>\``);
    }
    if (type.toLowerCase() === "appeal") {
      store.updateSettings(message.guild.id, { appeal_link: link });
      return reply(message, { components: [embed("Link set", `Appeal link set to: ${link}`)] });
    }
    return reply(message, "Unknown link type. Use `appeal`.");
  }

  if (command.name === "invite") {
    return reply(message, {
      components: [embed("Invite Mihulish", "Click the link below to invite me to your server.\nhttps://invite.ro-mihaiu.xyz")],
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
    sendDM(message.author.id, message.client, "Warning Issued", `You issued warning **#${w.id}** to <@${targetUser.id}> in **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
    const appealLink = store.getAppealLink(message.guild.id);
    const modDesc = `You received warning **#${w.id}** in **${message.guild.name}**.\nReason: ${reason}${appealLink ? `\nAppeal: ${appealLink}` : ""}`;
    sendDM(targetUser.id, message.client, "Warning Received", modDesc).catch(() => {});
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
    sendDM(message.author.id, message.client, "Warning Removed", `You removed warning **#${id}** from <@${targetUser.id}> in **${message.guild.name}**.`).catch(() => {});
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
    sendDM(message.author.id, message.client, "Mute Complete", `You muted <@${targetMember.id}> in **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
    const appealLink = store.getAppealLink(message.guild.id);
    const muteTargetDesc = `You were muted in **${message.guild.name}**.\nReason: ${reason}${appealLink ? `\nAppeal: ${appealLink}` : ""}`;
    sendDM(targetMember.id, message.client, "Muted", muteTargetDesc).catch(() => {});
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
    sendDM(message.author.id, message.client, "Unmute Complete", `You unmuted <@${targetMember.id}> in **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
    sendDM(targetMember.id, message.client, "Unmuted", `You were unmuted in **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
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
    sendDM(message.author.id, message.client, "Kick Complete", `You kicked <@${targetMember.id}> from **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
    const appealLink = store.getAppealLink(message.guild.id);
    const kickDesc = `You were kicked from **${message.guild.name}**.\nReason: ${reason}${appealLink ? `\nAppeal: ${appealLink}` : ""}`;
    sendDM(targetMember.id, message.client, "Kicked", kickDesc).catch(() => {});
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
      sendDM(message.author.id, message.client, "Softban Complete", `You softbanned <@${targetUser.id}> in **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
      const appealLink = store.getAppealLink(message.guild.id);
      const softDesc = `You were softbanned from **${message.guild.name}**.\nReason: ${reason}${appealLink ? `\nAppeal: ${appealLink}` : ""}`;
      sendDM(targetUser.id, message.client, "Softbanned", softDesc).catch(() => {});
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
      sendDM(message.author.id, message.client, "Ban Complete", `You banned <@${targetUser.id}> from **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
      const appealLink = store.getAppealLink(message.guild.id);
      const banDesc = `You were banned from **${message.guild.name}**.\nReason: ${reason}${appealLink ? `\nAppeal: ${appealLink}` : ""}`;
      sendDM(targetUser.id, message.client, "Banned", banDesc).catch(() => {});
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
      sendDM(message.author.id, message.client, "Unban Complete", `You unbanned <@${targetUser.id}> in **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
      sendDM(targetUser.id, message.client, "Unbanned", `You were unbanned from **${message.guild.name}**.\nReason: ${reason}`).catch(() => {});
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
      const isMgr = managerCheck(message.guild.id, message.member, message.client);
      if (isMgr) {
        const tagDisplay = store.listTags(message.guild.id).find((t) => t.name === name)?.display_name || name;
        return reply(message, `**${tagDisplay}** staffs: ${members.map((id) => `<@${id}>`).join(", ")}`);
      }
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
    if (sub === "addall") {
      const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      if (targetUser.id !== message.author.id && !isMgr)
        return reply(message, "Only managers can add all tags to another user.");
      const allTags = store.listTags(message.guild.id);
      if (!allTags.length) return reply(message, "There are no tags to assign.");
      for (const t of allTags) store.addStaffTag(message.guild.id, t.name, targetUser.id, message.author.id);
      sendDM(targetUser.id, message.client, "Tags Assigned", `You have been assigned all tags in **${message.guild.name}**.`).catch(() => {});
      return reply(message, `Assigned all ${allTags.length} tag(s) to <@${targetUser.id}>: ${allTags.map((t) => `\`${t.display_name}\``).join(", ")}`);
    }
    if (sub === "add") {
      if (!tagArg) return reply(message, `Usage: \`${p}tag add <tag> [@user]\``);
      const name = tagArg.trim().toLowerCase();
      const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      store.addStaffTag(message.guild.id, name, targetUser.id, message.author.id);
      sendDM(targetUser.id, message.client, "Tag Assigned", `You have been assigned the tag **${name}** in **${message.guild.name}**.`).catch(() => {});
      return reply(message, `Assigned tag \`${name}\` to <@${targetUser.id}>.`);
    }
    if (sub === "remove") {
      if (!tagArg) return reply(message, `Usage: \`${p}tag remove <tag> [@user]\``);
      const name = tagArg.trim().toLowerCase();
      const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      store.removeStaffTag(message.guild.id, name, targetUser.id);
      sendDM(targetUser.id, message.client, "Tag Removed", `You have been removed from the tag **${name}** in **${message.guild.name}**.`).catch(() => {});
      return reply(message, `Removed tag \`${name}\` from <@${targetUser.id}>.`);
    }
    if (sub === "remall") {
      const targetUser = userArg ? await resolveUser(message.client, message.guild, userArg) : message.author;
      if (!targetUser) return reply(message, "User not found.");
      if (targetUser.id !== message.author.id && !isMgr)
        return reply(message, "Only managers can remove all tags from another user.");
      const tagsList = store.userTags(message.guild.id, targetUser.id);
      if (!tagsList.length) return reply(message, `<@${targetUser.id}> has no tags assigned.`);
      store.removeAllStaffTags(message.guild.id, targetUser.id);
      sendDM(targetUser.id, message.client, "Tags Removed", `All your tags have been removed in **${message.guild.name}**.`).catch(() => {});
      return reply(message, `Removed all ${tagsList.length} tag(s) from <@${targetUser.id}>.`);
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
    return reply(message, `Usage: \`${p}tag <add|remove|addall|remall|list|check|ping|create|delete>\``);
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
    sendDM(message.author.id, message.client, "Ticket Assigned", `You claimed ticket **${t.panel}** in **${message.guild.name}**.`).catch(() => {});
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
    sendDM(targetUser.id, message.client, "Ticket Transferred", `You received ticket **${t.panel}** in **${message.guild.name}** from <@${message.author.id}>.`).catch(() => {});
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

  if (command.name === "ticket") {
    if (!staffCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "You must be configured staff to use this command.");
    }
    const [sub, valueArg] = command.arguments;
    if (sub !== "ping")
      return reply(message, `Usage: \`${p}ticket ping <hours|on|off>\``);

    // `m.ticket ping on|off` toggles pings for the current ticket (default on).
    if (valueArg && /^(on|off)$/i.test(valueArg.trim())) {
      const off = valueArg.trim().toLowerCase() === "off";
      const t = store.ticket(message.guild.id, message.channel.id);
      if (!t || t.status !== "OPEN")
        return reply(message, "Run this inside the ticket channel you want to toggle.");
      store.setTicketPingDisabled(message.guild.id, message.channel.id, off);
      return reply(
        message,
        off
          ? "Ticket pings are now **off** for this ticket — no one will be pinged here."
          : "Ticket pings are now **on** for this ticket.",
      );
    }

    const hours = parseInt(valueArg, 10);
    if (!hours || hours < 1 || hours > 720)
      return reply(message, `Usage: \`${p}ticket ping <hours|on|off>\` — 1 to 720, or on/off for this ticket.`);
    const { stale, sent, skipped } = await pingStaleTickets(message.guild, hours);
    if (!stale.length)
      return reply(message, `Every open ticket has had a staff reply in the last **${hours}h**.`);
    const lines = stale.map(
      (entry) =>
        `<#${entry.channel.id}> — idle **${formatIdle(entry.idleMs)}** · ${
          entry.lastStaffId ? `last staff <@${entry.lastStaffId}>` : "no staff reply yet"
        }`,
    );
    const notes = [];
    if (sent < stale.length) notes.push(`${stale.length - sent} could not be pinged.`);
    if (skipped.length) notes.push(`${skipped.length} ticket(s) skipped.`);
    return reply(message, {
      components: [
        embed(
          `Pinged ${sent} ticket(s)`,
          `Stale for more than **${hours}h**:\n${lines.join("\n")}${
            notes.length ? `\n\n*${notes.join(" ")}*` : ""
          }`,
        ),
      ],
    });
  }

  if (command.name === "channels") {
    if (!managerCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "Only managers can configure farm channels.");
    }
    const values = {};
    for (const [arg, key, label] of [
      [command.arguments[0], "video_channel_id", "video"],
      [command.arguments[1], "world_channel_id", "world"],
      [command.arguments[2], "schematic_channel_id", "schematic"],
    ]) {
      if (!arg) continue;
      const channel = resolveChannel(message.guild, arg);
      if (!channel || !channel.isTextBased()) {
        return reply(message, `Channel not found for \`${label}\`. Usage: \`${p}channels [video] [world] [schematic]\``);
      }
      values[key] = channel.id;
    }
    if (!Object.keys(values).length) {
      const c = store.getFarmChannelConfig(message.guild.id);
      if (!c) return reply(message, "No farm channels are configured yet.");
      return reply(message, {
        components: [
          embed(
            "Farm channels",
            `Video: ${c.video_channel_id ? `<#${c.video_channel_id}>` : "not set"}\nWorld: ${c.world_channel_id ? `<#${c.world_channel_id}>` : "not set"}\nSchematic: ${c.schematic_channel_id ? `<#${c.schematic_channel_id}>` : "not set"}`,
          ),
        ],
      });
    }
    const c = store.setFarmChannelConfig(message.guild.id, values);
    return reply(message, {
      components: [
        embed(
          "Farm channels updated",
          `Video: ${c.video_channel_id ? `<#${c.video_channel_id}>` : "not set"}\nWorld: ${c.world_channel_id ? `<#${c.world_channel_id}>` : "not set"}\nSchematic: ${c.schematic_channel_id ? `<#${c.schematic_channel_id}>` : "not set"}`,
        ),
      ],
    });
  }

  if (command.name === "farm") {
    if (!managerCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "Only managers can manage farms.");
    }
    const [sub, ...args] = command.arguments;
    if (sub === "add") {
      // m.farm add <dn> [type=…] [video=…] [world=…] [schematic=…]
      const dn = args.find((a) => !a.includes("="));
      if (!dn) return reply(message, `Usage: \`${p}farm add <dn> [type=] [video=] [world=] [schematic=]\``);
      const fields = {};
      for (const a of args) {
        const eq = a.indexOf("=");
        if (eq < 1) continue;
        const key = a.slice(0, eq).toLowerCase();
        const value = a.slice(eq + 1).trim();
        if (["type", "video", "world", "schematic"].includes(key) && value) fields[key] = value;
      }
      if (fields.type && !FARM_TYPES.includes(fields.type)) {
        return reply(message, `Unknown farm type \`${fields.type}\`. Valid: ${FARM_TYPES.join(", ")}`);
      }
      if (!Object.keys(fields).length)
        return reply(message, `Provide at least one field: \`${p}farm add ${dn} type=iron video=https://…\``);
      const currentFarm = store.getFarm(message.guild.id, dn);
      if (fields.video && (!currentFarm || currentFarm.video !== fields.video)) {
        const staged = store
          .listFarmSuggestions(message.guild.id)
          .find((x) => x.kind === "video" && x.url === fields.video && x.title);
        fields.video_title = staged ? staged.title : await fetchVideoTitle(fields.video);
      }
      const { farm } = store.upsertFarm(message.guild.id, dn, fields, message.author.id);
      const changedKeys = Object.keys(fields).filter((k) => fields[k] !== currentFarm?.[k]);
      if (changedKeys.length) {
        store.appendFarmChange(message.guild.id, {
          action: "add",
          dn,
          fields: Object.fromEntries(changedKeys.map((k) => [k, fields[k]])),
          by: message.author.id,
          timestamp: new Date().toISOString(),
        });
      }
      for (const s of store.listFarmSuggestions(message.guild.id)) {
        if (s.dn === dn) store.deleteFarmSuggestion(message.guild.id, s.id);
      }
      return reply(message, {
        components: [
          embed(
            "Farm saved",
            `DN \`${dn}\`${farm.type ? ` (${farm.type})` : ""}\nVideo: ${farm.video ? `[link](${farm.video})` : "not set"}\nWorld: ${farm.world ? `[link](${farm.world})` : "not set"}\nSchematic: ${farm.schematic ? `[link](${farm.schematic})` : "not set"}${farm.video_title ? `\nVideo title: ${farm.video_title}` : ""}`,
          ),
        ],
      });
    }
    if (sub === "remove") {
      const dn = args[0];
      if (!dn) return reply(message, `Usage: \`${p}farm remove <dn>\``);
      if (!store.getFarm(message.guild.id, dn))
        return reply(message, `No farm exists for DN \`${dn}\`; nothing was removed.`);
      store.deleteFarm(message.guild.id, dn);
      store.appendFarmChange(message.guild.id, {
        action: "remove",
        dn,
        by: message.author.id,
        timestamp: new Date().toISOString(),
      });
      return reply(message, `Removed farm \`${dn}\`.`);
    }
    if (sub === "list") {
      const filter = args.find((a) => a.startsWith("type="));
      const type = filter ? filter.slice(5).toLowerCase() : null;
      if (type && !FARM_TYPES.includes(type))
        return reply(message, `Unknown farm type \`${type}\`. Valid: ${FARM_TYPES.join(", ")}`);
      const farms = store.listFarms(message.guild.id, type);
      if (!farms.length)
        return reply(message, type ? `No farms found for type \`${type}\`.` : "No farms found.");
      const lines = farms.slice(0, 20).map(
        (f) => `**\`${f.dn}\`** — ${f.type ? `\`${f.type}\`` : "*(no type)*"} — ${stamp(f.created_at)}`,
      );
      return reply(message, {
        components: [
          embed(
            type ? `Farms — ${type}` : "Farms",
            lines.join("\n") + (farms.length > 20 ? `\n…and ${farms.length - 20} more` : ""),
          ),
        ],
      });
    }
    if (sub === "suggestions") {
      const rows = store.listFarmSuggestions(message.guild.id);
      if (!rows.length) return reply(message, "No staged suggestions right now.");
      const lines = rows.slice(0, 20).map(
        (s) => `\`${s.dn ?? "?"}\` — ${s.kind}: ${s.url ?? "*(link missing)*"} (${stamp(s.created_at)})`,
      );
      return reply(message, { components: [embed("Farm suggestions", lines.join("\n"))] });
    }
    if (sub === "export") {
      const { current, previous } = store.rotateFarmChangelog(message.guild.id);
      const meta = {
        type: "meta",
        last_updated: new Date().toISOString(),
        ai_instructions:
          "Update the target database using the farm records that follow (type=farm), matching on the 'dn' field. Apply the changes listed in 'changes.current' to reconcile any records your database may already have. After processing, discard 'changes.previous' — it is historical context only, not something to re-apply.",
        changes: { current, previous },
      };
      const lines = [JSON.stringify(meta)];
      const farms = store.listFarms(message.guild.id);
      for (const f of farms) {
        lines.push(
          JSON.stringify({ type: "farm", dn: f.dn, farm_type: f.type, video: f.video, world: f.world, schematic: f.schematic }),
        );
      }
      const sent = await message.reply({
        content: `Farms export — ${farms.length} farms, ${current.length} change(s) since last export.`,
        files: [
          {
            attachment: Buffer.from(lines.join("\n") + "\n", "utf8"),
            name: `farms-${Date.now()}.jsonl`,
          },
        ],
      }).catch((error) => {
        console.error("[prefix] failed to reply:", error.message);
        return null;
      });
      return sent;
    }
    return reply(message, `Usage: \`${p}farm <add|remove|list|suggestions|export>\``);
  }

  if (command.name === "dn") {
    const rawDn = command.arguments.join("");
    const dn = store.normalizeDn(rawDn);
    if (!dn) return reply(message, `Usage: \`${p}dn <dn>\` — for example \`${p}dn 467\` or \`${p}dn B105\``);
    const farm = store.getFarm(message.guild.id, dn);
    if (!farm) return reply(message, dnMissMessage(message.guild.id, dn));
    const last = store.getDnCooldown(message.author.id);
    const bypass =
      message.member?.roles?.cache?.has(DN_STAFF_ROLE_ID) ||
      isBotOwner(message.author.id, message.client);
    if (!bypass && last && Date.now() - last < 2 * 60 * 1000) {
      const remaining = Math.ceil((2 * 60 * 1000 - (Date.now() - last)) / 1000);
      return reply(message, `Please wait ${remaining}s before using \`${p}dn\` again.`);
    }
    const siteUrl = `https://theysix.ro-mihaiu.xyz/farm/java/${encodeURIComponent(farm.dn)}`;
    try {
      const { embed: dnEmbed, row } = await buildDnEmbed(farm, message.guild.id, message.author);
      await message.author.send({
        embeds: [dnEmbed],
        components: row ? [row] : [],
      });
    } catch {
      return reply(message, `Couldn't DM you (your DMs may be closed) — here's the link: ${siteUrl}`);
    }
    if (!bypass) store.setDnCooldown(message.author.id);
    return reply(message, `Sent you the farm link for \`${farm.dn}\` — check your DMs.`);
  }

  if (command.name === "dnstyle") {
    if (!managerCheck(message.guild.id, message.member, message.client)) {
      return reply(message, "Only managers can change the /dn link style.");
    }
    const style = (command.arguments[0] || "").toLowerCase();
    if (!style) {
      return reply(message, {
        components: [
          embed(
            "Current DN link style",
            `\`${dnLinkStyle(message.guild.id)}\`\nSet it with \`${p}dnstyle <${DN_LINK_STYLES.join("|")}>\`.`,
          ),
        ],
      });
    }
    if (!DN_LINK_STYLES.includes(style))
      return reply(message, `Unknown style \`${style}\`. Valid: ${DN_LINK_STYLES.join(", ")}.`);
    store.updateSettings(message.guild.id, { dn_link_style: style });
    return reply(message, {
      components: [
        embed(
          "DN link style updated",
          style === "buttons"
            ? "Farm embeds now show one button per link: red for the video, green for the schematic, blue for the world. The title is plain text."
            : "Farm embeds now link the title to the farm page again, with no buttons.",
        ),
      ],
    });
  }

  if (command.name === "wiki") {
    const [sub, ...rest] = command.arguments;
    if (sub !== "article")
      return reply(message, `Usage: \`${p}wiki article <keyword or article name>\` — searches the TheySix wiki and minecraft.wiki.`);
    const query = rest.join(" ").trim();
    if (!query) return reply(message, `Usage: \`${p}wiki article <keyword or article name>\``);
    const { results, errors } = await searchWikis(query);
    if (!results.length)
      return reply(message, `No wiki articles found for **${query}**.${errors.length ? " (A wiki source was unreachable.)" : ""}`);
    const lines = results.map(
      (r) =>
        `**[${r.title}](${r.url})** — ${r.source}${r.description ? `\n${r.description.slice(0, 200)}` : ""}`,
    );
    return reply(message, { components: [embed(`Wiki: ${query}`, lines.join("\n\n"))] });
  }

  if (command.name === "vd") {
    const url = command.arguments.join(" ").trim();
    if (!url)
      return reply(message, `Usage: \`${p}vd <video link>\` — same as \`${p}dn\` but with the video URL.`);
    if (!/^https?:\/\//i.test(url))
      return reply(message, "That doesn't look like a video link — it should start with `http://` or `https://`.");
    const farm = findFarmByVideo(message.guild.id, url);
    if (!farm)
      return reply(message, `No farm found with that video link. Try the DN instead with \`${p}dn\`.`);
    const last = store.getDnCooldown(message.author.id);
    const bypass =
      message.member?.roles?.cache?.has(DN_STAFF_ROLE_ID) ||
      isBotOwner(message.author.id, message.client);
    if (!bypass && last && Date.now() - last < 2 * 60 * 1000) {
      const remaining = Math.ceil((2 * 60 * 1000 - (Date.now() - last)) / 1000);
      return reply(message, `Please wait ${remaining}s before using \`${p}vd\` again.`);
    }
    const siteUrl = `https://theysix.ro-mihaiu.xyz/farm/java/${encodeURIComponent(farm.dn)}`;
    try {
      const { embed: dnEmbed, row } = await buildDnEmbed(farm, message.guild.id, message.author);
      await message.author.send({
        embeds: [dnEmbed],
        components: row ? [row] : [],
      });
    } catch {
      return reply(message, `Couldn't DM you (your DMs may be closed) — here's the link: ${siteUrl}`);
    }
    if (!bypass) store.setDnCooldown(message.author.id);
    return reply(message, `Sent you the farm link for \`${farm.dn}\` — check your DMs.`);
  }

  if (command.name === "cmd") {
    if (
      !message.member.permissions.has(PermissionFlagsBits.ManageMessages) &&
      !isBotOwner(message.author.id, message.client)
    ) {
      return reply(message, "You need Manage Messages to manage custom commands.");
    }
    const [sub, triggerArg, ...contentParts] = command.arguments;
    const trigger = triggerArg?.toLowerCase().trim();
    if (sub === "add") {
      const content = contentParts.join(" ").trim();
      if (!trigger || !content) return reply(message, `Usage: \`${p}cmd add <trigger> <content>\``);
      store.addCustomCommand(message.guild.id, trigger, content, message.author.id);
      return reply(message, { components: [embed("Custom command added", `Trigger: \`${trigger}\`\nContent: ${content.slice(0, 1000)}`)] });
    }
    if (sub === "remove") {
      if (!trigger) return reply(message, `Usage: \`${p}cmd remove <trigger>\``);
      if (store.removeCustomCommand(message.guild.id, trigger))
        return reply(message, `Removed custom command \`${trigger}\`.`);
      return reply(message, `No custom command found for trigger \`${trigger}\`.`);
    }
    if (sub === "list") {
      const cmds = store.listCustomCommands(message.guild.id);
      if (!cmds.length) return reply(message, "No custom commands configured.");
      const lines = cmds.map((c) => `\`${c.trigger}\` — ${c.content.slice(0, 80)}${c.content.length > 80 ? "…" : ""}`);
      return reply(message, { components: [embed("Custom commands", lines.join("\n"))] });
    }
    return reply(message, `Usage: \`${p}cmd <add|remove|list> [trigger] [content]\``);
  }

  // `/embed create` opens a modal, which a text command cannot do, so the
  // prefix form takes the same three answers inline: channel, title, content.
  if (command.name === "embed") {
    const gate = embedManageGate(
      message.author.id,
      message.client,
      message.member.permissions,
    );
    if (gate) return reply(message, gate);
    const [sub, ...args] = command.arguments;
    const guild = message.guild;

    if (sub === "list") {
      return reply(message, renderEmbedList(message.guild.id, guild));
    }

    if (sub === "delete" || sub === "remove") {
      const id = args[0]?.trim();
      if (!id) return reply(message, `Usage: \`${p}embed delete <id>\``);
      const row = store.getEmbed(message.guild.id, id);
      if (!row)
        return reply(
          message,
          `No embed found with id \`${id}\`. Use \`${p}embed list\` to see them.`,
        );
      if (
        !canManageEmbedAs(
          message.author.id,
          message.client,
          message.member.permissions,
          row,
        )
      )
        return reply(
          message,
          `Only <@${row.author_id}> (the author) can delete this embed.`,
        );
      await removeEmbed(guild, row);
      return reply(message, {
        components: [
          embed("Embed deleted", `\`${row.embed_id}\` was removed.`),
        ],
      });
    }

    if (sub !== "create" && sub !== "edit") {
      return reply(
        message,
        `Usage: \`${p}embed create [channel] <title> || <content>\`\n` +
          `\`${p}embed list\`\n` +
          `\`${p}embed edit <id> [channel] <title> || <content>\`\n` +
          `\`${p}embed delete <id>\`\n` +
          `Use \`<title> || <content>\` to set both, or drop the \`||\` part to send content with no title.`,
      );
    }

    let rest = args;
    let existing = null;
    if (sub === "edit") {
      const id = rest[0]?.trim();
      if (!id) return reply(message, `Usage: \`${p}embed edit <id> ...\``);
      rest = rest.slice(1);
      existing = store.getEmbed(message.guild.id, id);
      if (!existing)
        return reply(
          message,
          `No embed found with id \`${id}\`. Use \`${p}embed list\` to see them.`,
        );
      if (
        !canManageEmbedAs(
          message.author.id,
          message.client,
          message.member.permissions,
          existing,
        )
      )
        return reply(
          message,
          `Only <@${existing.author_id}> (the author) can edit this embed.`,
        );
    }

// An optional leading channel, accepted in any notation as long as it really
    // is a channel here. A `#name`/`<#id>`/bare id that does not resolve is an
    // error rather than silently becoming the title; a bare word is kept as the
    // title, since it could legitimately be one.
    let channelArg = "";
    if (rest[0]) {
      const found = await resolveEmbedChannel(guild, rest[0], null);
      if (found) {
        channelArg = rest[0];
        rest = rest.slice(1);
      } else if (/^(?:<#|#|\d{15,25}$)/.test(rest[0])) {
        return reply(
          message,
          `I could not find the channel \`${rest[0]}\` in this server.`,
        );
      }
    }
    // `<title> || <content>`, or just `<content>` for no title.
    const joined = rest.join(" ");
    const parts = joined.split(/\s*\|\|\s*/);
    const hasTitle = parts.length > 1;
    const title = hasTitle ? parts.shift().trim() : "";
    const content = (hasTitle ? parts.join(" || ") : joined).trim();

    if (!content)
      return reply(
        message,
        `Provide the embed content. Usage: \`${p}embed ${sub}${
          sub === "edit" ? " <id>" : ""
        } [channel] <title> || <content>\``,
      );
    if (content.length > EMBED_MAX_CONTENT)
      return reply(
        message,
        `That content is ${content.length} characters — the limit is ${EMBED_MAX_CONTENT}.`,
      );
    if (title.length > 256)
      return reply(message, "That title is too long — the limit is 256 characters.");

    const fallbackId = existing ? existing.channel_id : message.channel.id;
    const channel = await resolveEmbedChannel(guild, channelArg, fallbackId);
    const channelError = usableEmbedChannel(channel);
    if (channelError) return reply(message, channelError);

    try {
      const outcome = existing
        ? await patchEmbed({
            client: message.client,
            guild,
            user: message.author,
            row: existing,
            channel,
            title,
            content,
          })
        : await postEmbed({
            guild,
            user: message.author,
            channel,
            title,
            content,
          });
      if (!outcome.row)
        return reply(message, {
          components: [embed("Embed not saved", outcome.note)],
        });
      return reply(message, {
        components: [
          embedResultEmbed(
            outcome.row,
            channel,
            outcome.note,
            `Use \`${p}embed edit ${outcome.row.embed_id} ...\` or \`${p}embed delete ${outcome.row.embed_id}\`.`,
          ),
        ],
      });
    } catch (e) {
      return reply(message, `I could not post the embed: ${e.message}`);
    }
  }

  // `m.learn` — manage auto-learning from tickets
  if (command.name === "learn") {
    const gate = embedManageGate(message.author.id, message.client, message.member.permissions);
    if (gate) return reply(message, gate);
    const [sub, ...args] = command.arguments;

    if (sub === "status") {
      const enabled = isLearningEnabled(message.guild.id);
      const pending = store.listTicketLearning(message.guild.id, "pending").length;
      const total = store.listTicketLearning(message.guild.id).length;
      return reply(message, `Auto-learning: ${enabled ? "enabled" : "disabled"}\nPending review: ${pending}\nTotal entries: ${total}`);
    }

    if (sub === "enable") {
      setLearningEnabled(message.guild.id, true);
      return reply(message, "Auto-learning enabled for this server.");
    }

    if (sub === "disable") {
      setLearningEnabled(message.guild.id, false);
      return reply(message, "Auto-learning disabled for this server.");
    }

    if (sub === "review") {
      const id = parseInt(args[0], 10);
      const action = args[1];
      const name = args.slice(2).join(" ") || null;
      if (!id || !action) return reply(message, `Usage: \`${p}learn review <id> approve|reject [name]\``);
      const entry = store.getTicketLearning(message.guild.id, id);
      if (!entry) return reply(message, `No learning entry found with ID ${id}.`);
      if (entry.status !== "pending") return reply(message, `This entry is already ${entry.status}.`);

      const { reviewTicketLearning } = require("./ticket-learning");
      const result = await reviewTicketLearning(message.guild, { user: message.author, id: message.author.id }, id, action, name);
      if (result.error) return reply(message, result.error);
      return reply(message, result.message);
    }

    if (sub === "list") {
      const statusFilter = args[0] || null;
      const entries = store.listTicketLearning(message.guild.id, statusFilter);
      if (!entries.length) return reply(message, "No learning entries found.");
      const lines = entries.map((e) => {
        const q = e.question.length > 60 ? e.question.slice(0, 60) + "…" : e.question;
        const a = e.answer.length > 60 ? e.answer.slice(0, 60) + "…" : e.answer;
        const wiki = e.wiki_article_name ? ` → wiki: **${e.wiki_article_name}**` : "";
        return `\`#${e.id}\` [${e.status}] ${e.panel || "general"} | Q: ${q} | A: ${a}${wiki}`;
      });
      return reply(message, `Learning entries (${entries.length}):\n` + lines.slice(0, 15).join("\n"));
    }

    return reply(message, `Usage: \`${p}learn status\` | \`${p}learn enable\` | \`${p}learn disable\` | \`${p}learn review <id> approve|reject [name]\` | \`${p}learn list [status]\``);
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
