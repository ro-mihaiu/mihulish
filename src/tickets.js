// Ticket system: panel buttons that open permission-locked channels under the
// support category, close/reopen/delete controls inside each ticket, and an
// HTML transcript posted to the log channel when a ticket is closed or deleted.
//
// Channel naming matches the existing detector in index.js (`panel-username`,
// with `closed-` prefixed on close) so both flows agree on what a ticket is.
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
  AttachmentBuilder,
} = require("discord.js");
const store = require("./database");

const PANEL_CUSTOM_ID = "ticket_open";
const CLOSE_CUSTOM_ID = "ticket_close";
const REOPEN_CUSTOM_ID = "ticket_reopen";
const DELETE_CUSTOM_ID = "ticket_delete";

// ---------- helpers ----------

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function supportCategoryId(guildId) {
  return store.settings(guildId)?.support_category_id || null;
}

function ticketRowForChannel(guildId, channelId) {
  return store.ticket(guildId, channelId);
}

function ticketControls(closed) {
  const row = new ActionRowBuilder();
  if (closed) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(REOPEN_CUSTOM_ID)
        .setLabel("Reopen ticket")
        .setEmoji("🔓")
        .setStyle(ButtonStyle.Success),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(CLOSE_CUSTOM_ID)
        .setLabel("Close ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Secondary),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(DELETE_CUSTOM_ID)
      .setLabel("Delete ticket")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
  );
  return row;
}

async function logToChannel(guild, payload) {
  const logId = store.settings(guild.id)?.log_channel_id;
  if (!logId) return null;
  const channel = guild.channels.cache.get(logId);
  if (!channel) return null;
  try {
    return await channel.send(payload);
  } catch {
    return null;
  }
}

// ---------- panel ----------

// `/panel` — post a panel embed with one "Open a ticket" button per enabled
// ticket panel (java, br, bug, report, partnership by default). Selecting a
// panel happens via the `ticket_open|<panel>` buttons.
function buildPanelEmbed(guild, panels) {
  const e = embed(`🎫 Support Tickets`,
    `Need help? Open a ticket below.\n\n` +
    panels
      .map((p) => `**${p.panel}**${p.tag_name && p.tag_name !== p.panel ? ` — ${p.tag_name}` : ""}`)
      .join("\n") +
    `\n\nClick a button and a private channel will be created for you and the staff team.`,
  );
  e.setFooter({ text: "Mihulish | Ticket System" });
  return e;
}

function panelButtons(panels) {
  const row = new ActionRowBuilder();
  for (const p of panels) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${PANEL_CUSTOM_ID}|${p.panel}`)
        .setLabel(p.tag_name && p.tag_name !== p.panel ? p.tag_name : p.panel)
        .setEmoji("📩")
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
}

// ---------- open ----------

async function openTicket(interaction, panel) {
  const guild = interaction.guild;
  const categoryId = supportCategoryId(guild.id);
  if (!categoryId) {
    return notice(interaction, "Support category is not configured. An admin must run `/settings` with a support category.");
  }
  const panels = store.listTicketPanels(guild.id).filter((p) => p.enabled);
  if (!panels.some((p) => p.panel === panel)) {
    return notice(interaction, "That ticket type is no longer available.");
  }

  // One open ticket per user per panel, like Drako's MaxTickets: 1.
  const existing = store.db
    .prepare(
      "SELECT channel_id FROM tickets WHERE guild_id=? AND panel=? AND ticket_user_id=? AND status='OPEN'",
    )
    .get(guild.id, panel, interaction.user.id);
  if (existing) {
    const found = guild.channels.cache.get(existing.channel_id);
    if (found)
      return notice(interaction, `You already have an open **${panel}** ticket: <#${found.id}>.`);
  }

  await interaction.deferReply({ flags: 64 }); // ephemeral

  const channelName = `${panel}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const everyone = guild.roles.everyone;
  const overwriteBase = [
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];
  // Staff configured in the bot (or managers) can see every ticket.
  const staffOverwrites = store
    .listStaff(guild.id)
    .map((s) => ({
      id: s.user_id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      type: OverwriteType.Member,
    }));
  const managerRoleId = store.settings(guild.id)?.manager_role_id;
  if (managerRoleId)
    staffOverwrites.push({
      id: managerRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [...overwriteBase, ...staffOverwrites],
      reason: `Ticket opened by ${interaction.user.tag} (${panel})`,
    });
  } catch (e) {
    return interaction.editReply({
      content: `I could not create the ticket channel: ${e.message}`,
    });
  }

  store.saveTicket(guild.id, channel.id, panel, interaction.user.id, "OPEN");

  const created = embed(
    `📩 ${panel} ticket`,
    `Hey <@${interaction.user.id}>, welcome to your ticket.\n` +
    `Describe your issue in as much detail as you can — the staff team has been notified.\n\n` +
    `Use **Close ticket** below once your issue is resolved.`,
  );
  created.setFooter({ text: `Mihulish | Ticket System · #${panel}` });
  await channel.send({
    content: managerRoleId ? `<@&${managerRoleId}>` : undefined,
    embeds: [created],
    components: [ticketControls(false)],
    allowedMentions: managerRoleId ? { roles: [managerRoleId] } : undefined,
  });

  await logToChannel(guild, {
    embeds: [
      embed("Ticket opened",
        `<@${interaction.user.id}> opened a **${panel}** ticket: <#${channel.id}>`),
    ],
  });

  return interaction.editReply({
    content: `Your **${panel}** ticket has been created: <#${channel.id}>`,
  });
}

// ---------- close ----------

async function closeTicket(interaction, { viaCommand = false } = {}) {
  const guild = interaction.guild;
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t || t.status !== "OPEN") {
    const message = "This is not a recognized open ticket.";
    return viaCommand ? { error: message } : notice(interaction, message);
  }
  if (!viaCommand) await interaction.deferReply({ flags: 64 });

  await generateAndPostTranscript(guild, interaction.channel, t, "closed", interaction.user);

  // Rename with the closed- prefix — the ChannelUpdate handler in index.js
  // will mark the ticket CLOSED and strip the claim automatically.
  try {
    await interaction.channel.setName(`closed-${interaction.channel.name}`, `Closed by ${interaction.user.tag}`);
  } catch {
    // Fallback if the rename fails (permissions/rate limits).
    store.saveTicket(guild.id, interaction.channelId, t.panel, t.ticket_user_id, "CLOSED");
  }

  const reply = embed(
    "Ticket closed",
    `This ticket has been closed by <@${interaction.user.id}>. A transcript has been saved.\n` +
    `Staff can reopen or delete it below.`,
  );
  reply.setFooter({ text: "Mihulish | Ticket System" });
  await interaction.channel.send({ embeds: [reply], components: [ticketControls(true)] });

  await logToChannel(guild, {
    embeds: [
      embed("Ticket closed",
        `**${t.panel}** ticket <#${interaction.channelId}> closed by <@${interaction.user.id}>`),
    ],
  });

  if (!viaCommand) await interaction.editReply({ content: "Ticket closed." });
  return { ok: true };
}

// ---------- reopen ----------

async function reopenTicket(interaction) {
  const guild = interaction.guild;
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t || t.status !== "CLOSED") return notice(interaction, "This ticket is not closed.");

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) && !store.isStaff(guild.id, interaction.user.id))
    return notice(interaction, "Only staff can reopen a ticket.");

  await interaction.deferReply({ flags: 64 });
  try {
    const name = interaction.channel.name.replace(/^closed-/, "");
    await interaction.channel.setName(name, `Reopened by ${interaction.user.tag}`);
  } catch {
    store.saveTicket(guild.id, interaction.channelId, t.panel, t.ticket_user_id, "OPEN");
  }
  await interaction.editReply({ content: "Ticket reopened." });
  await logToChannel(guild, {
    embeds: [embed("Ticket reopened", `**${t.panel}** ticket <#${interaction.channelId}> reopened by <@${interaction.user.id}>`)],
  });
}

// ---------- delete ----------

async function deleteTicket(interaction) {
  const guild = interaction.guild;
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t) return notice(interaction, "This is not a recognized ticket.");
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) && !store.isStaff(guild.id, interaction.user.id))
    return notice(interaction, "Only staff can delete a ticket.");

  await interaction.deferReply({ flags: 64 });
  const logTo = store.settings(guild.id)?.log_channel_id
    ? guild.channels.cache.get(store.settings(guild.id).log_channel_id)
    : null;
  const status = t.status === "CLOSED" ? "deleted (was closed)" : "deleted";
  await generateAndPostTranscript(guild, interaction.channel, t, status, interaction.user);
  await interaction.editReply({ content: `Transcript saved${logTo ? ` in <#${logTo.id}>` : ""}. Deleting ticket in 5 seconds…` });
  await logToChannel(guild, {
    embeds: [
      embed("Ticket deleted",
        `**${t.panel}** ticket <#${interaction.channelId}> deleted by <@${interaction.user.id}>`),
    ],
  });
  setTimeout(() => {
    interaction.channel.delete(`Ticket deleted by ${interaction.user.tag}`).catch(() => { });
  }, 5000);
}

// ---------- transcript ----------

// Fetches the whole channel history (up to 2000 messages) and renders an HTML
// transcript, then attaches it to the configured log channel. HTML because it
// preserves names, timestamps, colours and attachments without any dependency.
async function generateAndPostTranscript(guild, channel, ticketRow, status, actor) {
  let messages = [];
  try {
    let lastId;
    for (let round = 0; round < 20; round++) {
      const batch = await channel.messages.fetch({
        limit: 100,
        before: lastId,
        cache: false,
      });
      if (!batch.size) break;
      messages.push(...batch.values());
      lastId = batch.last().id;
      if (batch.size < 100) break;
    }
  } catch {
    // Fall through with whatever we managed to fetch.
  }
  messages.reverse();

  const html = renderTranscript(guild, channel, ticketRow, status, actor, messages);
  const file = new AttachmentBuilder(Buffer.from(html, "utf8"), {
    name: `transcript-${ticketRow.panel}-${channel.id}.html`,
  });
  await logToChannel(guild, {
    content: `📄 Transcript for **${ticketRow.panel}** ticket \`${channel.name}\` (${status}${actor ? ` by <@${actor.id}>` : ""})`,
    files: [file],
    allowedMentions: { parse: [] },
  });
}

function renderTranscript(guild, channel, t, status, actor, messages) {
  const fmt = (ts) => new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const body = messages
    .map((m) => {
      const author = escapeHtml(m.author ? m.author.tag : "Unknown");
      const avatar = m.author?.displayAvatarURL?.({ size: 64 }) ?? "";
      const time = escapeHtml(fmt(m.createdTimestamp));
      let content = escapeHtml(m.content);
      if (m.attachments?.size) {
        content +=
          (content ? "<br>" : "") +
          [...m.attachments.values()]
            .map((a) => `📎 <a href="${escapeHtml(a.url)}">${escapeHtml(a.name)}</a>`)
            .join("<br>");
      }
      if (m.embeds?.length) {
        const parts = m.embeds
          .filter((e) => e.title || e.description)
          .map((e) => `<em>[embed] ${escapeHtml(e.title || "")}${e.title && e.description ? " — " : ""}${escapeHtml(e.description || "")}</em>`);
        content += (content ? "<br>" : "") + parts.join("<br>");
      }
      return `<div class="msg${m.author?.bot ? " bot" : ""}">
  <img class="av" src="${escapeHtml(avatar)}" alt="" width="32" height="32">
  <div><span class="author">${author}</span> <span class="time">${time}</span>
  <div class="text">${content || "<em>(no content)</em>"}</div></div>
</div>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Transcript — ${escapeHtml(channel.name)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#1e1f22;color:#dcddde;margin:2rem auto;max-width:60rem;padding:0 1rem}
h1{color:#e91e63;font-size:1.3rem}
.meta{color:#9aa0a6;font-size:.9rem;margin-bottom:1.5rem}
.msg{display:flex;gap:.75rem;padding:.5rem 0;border-top:1px solid #2b2d31}
.av{border-radius:50%;margin-top:.2rem}
.author{font-weight:600;color:#fff}
.bot{background:rgba(233,30,99,.05)}
.time{color:#7d8085;font-size:.75rem}
.text{white-space:pre-wrap;word-break:break-word;margin-top:.15rem}
a{color:#00a8fc}
</style></head><body>
<h1>Ticket transcript — ${escapeHtml(channel.name)}</h1>
<div class="meta">
Guild: ${escapeHtml(guild.name)}<br>
Panel: ${escapeHtml(t.panel)} · Ticket #${t.id} · Owner: <span class="author">${t.ticket_user_id ? escapeHtml(t.ticket_user_id) : "unknown"}</span><br>
Opened: ${escapeHtml(fmt(t.created_at))} · ${escapeHtml(status)}${actor ? ` by ${escapeHtml(actor.tag)}` : ""} at ${escapeHtml(fmt(Date.now()))}<br>
Messages: ${messages.length}
</div>
${body}
</body></html>`;
}

// ---------- shared ----------

function embed(title, description) {
  return new EmbedBuilder().setColor(0xe91e63).setTitle(title).setDescription(description);
}

function notice(interaction, text) {
  const payload = { content: text, flags: 64 };
  if (interaction.deferred) return interaction.editReply(payload);
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

// Entry point wired to Events.InteractionCreate in index.js. Returns true when
// the interaction belonged to the ticket system.
async function handleTicketInteraction(interaction) {
  if (!interaction.isButton() || !interaction.guildId) return false;
  const id = interaction.customId;
  if (id === CLOSE_CUSTOM_ID) {
    await closeTicket(interaction).catch((e) =>
      console.error("[tickets] close:", e.message),
    );
    return true;
  }
  if (id === REOPEN_CUSTOM_ID) {
    await reopenTicket(interaction).catch((e) =>
      console.error("[tickets] reopen:", e.message),
    );
    return true;
  }
  if (id === DELETE_CUSTOM_ID) {
    await deleteTicket(interaction).catch((e) =>
      console.error("[tickets] delete:", e.message),
    );
    return true;
  }
  if (id.startsWith(`${PANEL_CUSTOM_ID}|`)) {
    const panel = id.slice(PANEL_CUSTOM_ID.length + 1);
    await openTicket(interaction, panel).catch((e) =>
      console.error("[tickets] open:", e.message),
    );
    return true;
  }
  return false;
}

// `/panel` — post the ticket panel in the current channel.
async function runPanelCommand(interaction) {
  const panels = store.listTicketPanels(interaction.guildId).filter((p) => p.enabled);
  if (!panels.length)
    return {
      content: "No ticket panels are configured for this server.",
      ephemeral: true,
    };
  return {
    embeds: [buildPanelEmbed(interaction.guild, panels)],
    components: [panelButtons(panels)],
  };
}

// `/close` — close the current ticket via command (staff only).
async function runCloseCommand(interaction) {
  if (
    !store.isStaff(interaction.guildId, interaction.user.id) &&
    !interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels)
  ) {
    return { content: "Only staff can close tickets.", ephemeral: true };
  }
  const result = await closeTicket(interaction, { viaCommand: true });
  if (result?.error) return { content: result.error, ephemeral: true };
  return {
    content: "Ticket closed. Transcript has been saved.",
    ephemeral: true,
  };
}

module.exports = {
  handleTicketInteraction,
  runPanelCommand,
  runCloseCommand,
  ticketControls,
};
