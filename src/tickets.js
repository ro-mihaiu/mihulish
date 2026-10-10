// Ticket system: panel buttons that open permission-locked channels under the
// support category, close/reopen/delete controls inside each ticket, and an
// HTML transcript posted to the log channel when a ticket is closed or deleted.
//
// Channel naming matches the existing detector in index.js (`panel-username`,
// with `closed-` prefixed on close) so both flows agree on what a ticket is.
const { EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
  AttachmentBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const store = require("./database");
const { learnFromClosedTicket, isLearningEnabled } = require("./ticket-learning");
const { sendDM } = require("./utils");

const PANEL_CUSTOM_ID = "ticket_open";
const PANEL_SELECT_CUSTOM_ID = "ticket_open_select";
const MODAL_CUSTOM_ID = "ticket_modal";
const WIKI_URL = "https://wiki-theysix.ro-mihaiu.xyz/w/how-to-complete-a-ticket";
const CLOSE_CUSTOM_ID = "ticket_close";
const REOPEN_CUSTOM_ID = "ticket_reopen";
const DELETE_CUSTOM_ID = "ticket_delete";
const CLAIM_CUSTOM_ID = "ticket_claim";
const RATING_CUSTOM_ID = "ticket_rate";
const RATING_CANCEL_CUSTOM_ID = "ticket_rate_skip";

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

function ticketControls(closed, { claimed = false, canClaim = true } = {}) {
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
        .setCustomId(CLAIM_CUSTOM_ID)
        .setLabel(claimed ? "Claimed" : "Claim ticket")
        .setEmoji("🙋")
        .setStyle(claimed ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(claimed),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_CUSTOM_ID)
      .setLabel("Close ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary),
  );
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

// Per-panel metadata: display name, emoji, short description and the guidance
// note shown on the panel. Unknown panels fall back to the panel key.
const PANEL_META = {
  java: {
    label: "Java Farm",
    emoji: "🟦",
    description: "Open a Java Farm ticket",
    info: "Request help with Java farms, farm-related issues, or assistance with farm mechanics.",
    note: "Please describe your farm issue in detail and include any relevant screenshots, world seeds, or coordinates. A staff member will respond shortly.",
  },
  br: {
    label: "Bedrock Farm",
    emoji: "🟩",
    description: "Open a Bedrock Farm ticket",
    info: "Request help with Bedrock farms, farm-related issues, or assistance with farm mechanics.",
    note: "Please describe your farm issue in detail and include any relevant screenshots, device version, and steps to reproduce. A staff member will respond shortly.",
  },
  bug: {
    label: "Report a Bug",
    emoji: "🐞",
    description: "Report a server bug or exploit",
    info: "Report server bugs, glitches, exploits, or other technical issues that need to be investigated.",
    note: "Please describe the bug, include steps to reproduce it, server version, and any screenshots or videos you have. Developers will investigate.",
  },
  report: {
    label: "Report a Person",
    emoji: "🚨",
    description: "Report a player for rule-breaking",
    info: "Report a player for rule-breaking, griefing, stealing, harassment, or other inappropriate behavior. Please provide evidence when possible.",
    note: "Please provide the username(s), time, and as much evidence as possible (screenshots, video, logs). Moderation will review the report.",
  },
  partnership: {
    label: "Partnership",
    emoji: "🤝",
    description: "Send a partnership request",
    info: "Submit partnership requests or inquiries regarding collaborations with TheySix.",
    note: "Please include links to your channel/community and a short pitch about the collaboration. Note we do not accept partnership requests from Minecraft servers.",
  },
  management: {
    label: "Management Ticket",
    emoji: "🛠️",
    description: "Contact management",
    info: "Please explain the management request or concern and provide any relevant context. Management team will follow up.",
    note: "Provide clear context, reasons, and any supporting evidence for management to review.",
  },
};

// Required questions per ticket type. Every question is mandatory — the modal
// refuses to submit until all fields are filled. Answers are embedded into the
// ticket's welcome embed so staff see the context immediately. A question is a
// string (required, paragraph input) or an object with { label, optional,
// placeholder } for optional fields (e.g. the schematic file note).
const PANEL_QUESTIONS = {
  // Farm forms have exactly 5 fields (the modal cap): video link and DN are
  // combined into one box, everything else is its own box. The schematic file
  // stays optional and is attached in the ticket channel afterwards.
  java: [
    "Server version & client",
    "Do you play single player or multiplayer? (essentials mod / server / realm)",
    "Explain your problem in detail",
    "Video link & DN",
    "Do you play with Mods or Plugins? (server & client side)",
  ],
  br: [
    "Server version & client",
    "Do you play single player or multiplayer? (essentials mod / server / realm)",
    "Explain your problem in detail",
    "Video link & DN",
    "Do you play with Mods or Plugins? (server & client side)",
  ],
  bug: [
    "Describe the bug",
    "Steps to reproduce it",
    "Server version",
    "Links to screenshots or videos",
    "How often does it happen?",
  ],
  report: [
    "Username(s) of the reported player(s)",
    "What did they do?",
    "When did it happen?",
    "Links to evidence (screenshots/video/logs)",
    "Were there any witnesses?",
  ],
  partnership: [
    "Channel / community name",
    "Links (channel, Discord, socials)",
    "Short pitch about the collaboration",
    "Average views / members",
    "Anything else we should know?",
  ],
  management: [
    "Explain your request or concern",
    "Who is involved?",
    "When did this happen?",
    "Supporting evidence or context",
    "What outcome are you asking for?",
  ],
};

// Keyword rules for automatic staff assignment. Each rule matches on the panel
// type and/or keywords found anywhere in the answers (DN, video link, problem
// description, …). The matching tag name gives expertise-tagged staff priority.
const AUTO_ASSIGN_RULES = [
  { tag: "java", panels: ["java"], keywords: ["dn", "download number", "essentials", "java", "schematic", "litematica", "world download", "singleplayer"] },
  { tag: "bedrock", panels: ["br"], keywords: ["bedrock", "realm", "addon", "behavior pack", "resource pack"] },
  { tag: "bug", panels: ["bug"], keywords: ["bug", "exploit", "crash", "glitch", "dupe"] },
  { tag: "report", panels: ["report"], keywords: ["grief", "steal", "hacks", "cheat", "xray", "harass", "ban", "reported"] },
  { tag: "partnership", panels: ["partnership"], keywords: ["discord", "youtube", "tiktok", "collab", "subscriber", "views"] },
  { tag: "management", panels: ["management"], keywords: ["staff", "appeal", "unban", "refund", "complaint", "management"] },
];

// Auto-assigns the ticket to the best-matching staff member based on the
// ticket's answers. Rules are scored: the DN answer, the video link, the
// problem description and the ticket panel all contribute. Staff with a
// matching expertise tag are preferred, then the staff member with the least
// currently-claimed tickets wins (simple round-robin between equals).
function autoAssignStaff(guild, panel, answers) {
  const staff = store.listStaff(guild.id).filter((s) => s.user_id);
  if (!staff.length) return null;

  const haystack = [
    panel,
    ...(answers || []).map((a) => String(a).toLowerCase()),
  ].join("\n");

  // How many open tickets each staff member already owns (load balancing).
  const load = new Map(
    store.db
      .prepare(
        "SELECT assigned_staff_id AS id, COUNT(*) AS n FROM tickets WHERE guild_id=? AND status='OPEN' AND assigned_staff_id IS NOT NULL GROUP BY assigned_staff_id",
      )
      .all(guild.id)
      .map((r) => [r.id, r.n]),
  );

  let best = null;
  let bestScore = -Infinity;
  for (const s of staff) {
    let score = 0;
    for (const rule of AUTO_ASSIGN_RULES) {
      const panelHit = rule.panels.includes(panel);
      const keywordHit = rule.keywords.some((k) => haystack.includes(k));
      if (!panelHit && !keywordHit) continue;
      let ruleScore = (panelHit ? 2 : 0) + (keywordHit ? 1 : 0);
      // Staff with the matching expertise tag get a big bonus.
      const tagged = store.tagMembers(guild.id, rule.tag);
      if (tagged.includes(s.user_id)) ruleScore += 3;
      score += ruleScore;
    }
    score -= (load.get(s.user_id) || 0) * 0.5; // prefer less loaded staff
    if (score > bestScore) {
      bestScore = score;
      best = s.user_id;
    }
  }
  // Don't auto-assign when nothing matched at all.
  return bestScore > 0 ? best : null;
}

// `/panel` — post a Components V2 panel: welcome text, one description block
// per enabled panel, a Quick Select section with the wiki link button, and a
// select menu that opens a question form for the chosen ticket type.
function buildPanelPayload(panels) {
  const text = (content) => ({ type: 10, content });
  const divider = (spacing = 1) => ({ type: 14, divider: true, spacing });

  const welcome = text(
    "🎫 **TheySix Support System**\n\n" +
    "Welcome to TheySix Support, here to help you with any issues or requests you may have while playing on our server. " +
    "Please select the ticket type that best matches your situation.\n\n" +
    "⚠️ **Don't create tickets for fun or just to test the system.**\n" +
    "Misuse of the ticket system may result in moderation action.",
  );
  const blocks = [];
  for (const p of panels) {
    const meta = PANEL_META[p.panel];
    const title = meta ? meta.label : p.panel;
    const info = meta ? meta.info : "Request help from the staff team.";
    const note = meta ? meta.note : "Please describe your issue in as much detail as possible. A staff member will respond shortly.";
    blocks.push(text(`**${title}**\n${info}\n\n> ${note}`), divider(1));
  }
  const quickSelect = {
    type: 9,
    components: [text("**Quick Select**\nUse the menu to quickly select the ticket category you need.")],
    accessory: { type: 2, style: 5, label: "More Info", url: WIKI_URL },
  };
  const selectRow = {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: PANEL_SELECT_CUSTOM_ID,
        placeholder: "Select a ticket category...",
        options: panels.map((p) => {
          const meta = PANEL_META[p.panel];
          return {
            label: (meta ? meta.label : p.panel).slice(0, 100),
            description: meta ? meta.description : `Open a ${p.panel} ticket`,
            value: p.panel,
            emoji: meta ? { name: meta.emoji, animated: false } : undefined,
          };
        }),
      },
    ],
  };
  const footer = text(
    "Please choose the correct ticket category and provide as much relevant information as possible.\n-# TheySix | Minecraft",
  );
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [welcome, divider(2), ...blocks, quickSelect, selectRow, divider(1), footer],
  };
}

// Legacy button row kept so panels posted before the Components V2 update keep
// working until they are re-posted.
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

// Called when the user picks a ticket type. Types with required questions get
// a modal form first; the answers are then filled into the ticket embed.
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

  const questions = PANEL_QUESTIONS[panel];
  if (questions?.length) {
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_CUSTOM_ID}|${panel}`)
      .setTitle(`New ${panelLabel(panel).slice(0, 20)} ticket`);
    // Discord only allows 5 rows per modal. Optional questions come last in
    // the config, so they're the ones dropped when it doesn't fit — required
    // questions always make it into the form. The schematic file itself is
    // attached in the ticket channel after creation.
    for (const [i, q] of questions.slice(0, 5).entries()) {
      const opt = typeof q === "object" ? q : { label: q };
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(`q${i}`)
            .setLabel(opt.label.slice(0, 45))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(!opt.optional)
            .setMaxLength(1000),
        ),
      );
    }
    return interaction.showModal(modal);
  }
  return createTicket(interaction, panel);
}

async function createTicket(interaction, panel, answers) {
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

  // Auto-assign the ticket to the staff member whose expertise best matches
  // the answers (DN, video link, problem description). Logged so staff know
  // the ticket was routed automatically.
  const autoAssigned = autoAssignStaff(guild, panel, answers);
  if (autoAssigned) {
    store.assignTicket(guild.id, channel.id, autoAssigned);
    sendDM(
      autoAssigned,
      interaction.client,
      "Ticket Auto-Assigned",
      `You have been auto-assigned a **${panel}** ticket in **${guild.name}**: <#${channel.id}>`,
    ).catch(() => {});
  }

  // Fill the welcome embed with the answers from the required-question form.
  let description =
    `Hey <@${interaction.user.id}>, welcome to your ticket.\n` +
    (autoAssigned
      ? `This ticket has been auto-assigned to <@${autoAssigned}> based on your answers.\n`
      : `The staff team has been notified.\n`);
  const questions = PANEL_QUESTIONS[panel] || [];
  if (answers?.length) {
    description +=
      questions
        .map((q, i) => {
          const label = typeof q === "object" ? q.label : q;
          return answers[i] ? `**${label}**\n> ${String(answers[i]).slice(0, 400)}` : null;
        })
        .filter(Boolean)
        .join("\n\n") + "\n\n";
  }
  // Farm tickets accept an optional schematic file — modals only hold five
  // fields, so the file itself is attached in the ticket instead.
  if (panel === "java" || panel === "br") {
    description += `📎 **Schematic file (optional):** if you have a schematic, attach it as a file in this ticket.\n\n`;
  }
  description += `Use **Close ticket** below once your issue is resolved.`;
  const created = embed(`📩 ${panel} ticket`, description.slice(0, 4000));
  created.setFooter({ text: `Mihulish | Ticket System · #${panel}${autoAssigned ? " · auto-assigned" : ""}` });
  await channel.send({
    content: autoAssigned ? `<@${autoAssigned}>` : undefined,
    embeds: [created],
    components: [ticketControls(false, { claimed: Boolean(autoAssigned) })],
    allowedMentions: { users: autoAssigned ? [autoAssigned] : [] },
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

// ---------- claim ----------

// Claim via the 🙋 button inside the ticket. Staff-only; updates the welcome
// message buttons so the claim is visible to everyone in the channel.
async function claimTicket(interaction) {
  const guild = interaction.guild;
  if (!store.isStaff(guild.id, interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return notice(interaction, "Only staff can claim a ticket.");
  }
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t || t.status !== "OPEN") return notice(interaction, "This is not a recognized open ticket.");
  if (t.assigned_staff_id === interaction.user.id) {
    return notice(interaction, "You have already claimed this ticket.");
  }
  if (t.assigned_staff_id) {
    return notice(interaction, `This ticket is already claimed by <@${t.assigned_staff_id}>. A manager can transfer it with \`/transfer\`.`);
  }
  store.assignTicket(guild.id, interaction.channelId, interaction.user.id);
  // Flip the claim button to its claimed state on the panel message.
  try {
    const messages = await interaction.channel.messages.fetch({ limit: 10 });
    const panelMsg = messages.find(
      (m) => m.author.id === guild.members.me.id && m.components?.some((r) => r.components?.some((c) => c.customId === CLAIM_CUSTOM_ID)),
    );
    if (panelMsg) {
      await panelMsg.edit({ components: [ticketControls(false, { claimed: true })] }).catch(() => {});
    }
  } catch {}
  sendDM(interaction.user.id, interaction.client, "Ticket Assigned", `You claimed ticket **${t.panel}** in **${guild.name}**: <#${interaction.channelId}>`).catch(() => {});
  await logToChannel(guild, {
    embeds: [embed("Ticket claimed", `**${t.panel}** ticket <#${interaction.channelId}> claimed by <@${interaction.user.id}>`)],
  });
  const text = `<@${t.ticket_user_id}> <@${interaction.user.id}> has claimed this ticket.`;
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content: text, allowedMentions: { users: [t.ticket_user_id, interaction.user.id] } });
  return interaction.reply({ content: text, allowedMentions: { users: [t.ticket_user_id, interaction.user.id] } });
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

  // Auto-learn from the ticket conversation (if enabled for this guild)
  if (isLearningEnabled(guild.id)) {
    try {
      const result = await learnFromClosedTicket(guild, interaction.channel, t);
      if (result.learned > 0) {
        await logToChannel(guild, {
          embeds: [
            embed(
              "Auto-learning",
              `Extracted ${result.learned} potential knowledge item(s) from this ticket for staff review. Use \`/learn\` to curate.`,
            ),
          ],
        });
      }
    } catch (e) {
      console.error("[tickets] auto-learn failed:", e.message);
    }
  }

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
// transcript. The transcript is attached to the configured ticket transcript
// channel, the mod-log channel, and DMed to the ticket creator together with a
// 1-5 star rating form. HTML because it preserves names, timestamps, colours
// and attachments without any dependency.
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
  const fileName = `transcript-${ticketRow.panel}-${channel.id}.html`;
  const caption =
    `📄 Transcript for **${ticketRow.panel}** ticket \`${channel.name}\` (${status}${actor ? ` by <@${actor.id}>` : ""})`;

  // Configured ticket transcript channel (set via /settings ticket_transcripts).
  const transcriptChannelId = store.settings(guild.id)?.ticket_transcript_channel_id;
  if (transcriptChannelId) {
    const ch = guild.channels.cache.get(transcriptChannelId);
    if (ch?.isTextBased()) {
      await ch
        .send({ content: caption, files: [transcriptAttachment(html, fileName)], allowedMentions: { parse: [] } })
        .catch((e) => console.error("[tickets] transcript channel:", e.message));
    }
  }

  // Mod-log channel (previous behaviour, kept as a fallback/archive).
  await logToChannel(guild, {
    content: caption,
    files: [transcriptAttachment(html, fileName)],
    allowedMentions: { parse: [] },
  });

  // DM the ticket creator the transcript plus a rating form.
  if (ticketRow.ticket_user_id) {
    await sendTicketRatingDM(guild.client, ticketRow, html, fileName, channel.name);
  }
}

function transcriptAttachment(html, name) {
  return new AttachmentBuilder(Buffer.from(html, "utf8"), { name });
}

function ratingRow() {
  const row = new ActionRowBuilder();
  for (let stars = 1; stars <= 5; stars++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${RATING_CUSTOM_ID}|${stars}`)
        .setLabel("⭐".repeat(stars))
        .setStyle(stars >= 4 ? ButtonStyle.Success : stars === 3 ? ButtonStyle.Secondary : ButtonStyle.Danger),
    );
  }
  return row;
}

// DMs the ticket creator their transcript and asks them to rate the support
// they received. Ratings are logged to the transcript channel and mod-log.
async function sendTicketRatingDM(client, ticketRow, html, fileName, channelName) {
  const user = await client.users.fetch(ticketRow.ticket_user_id).catch(() => null);
  if (!user) return;
  try {
    await user.send({
      content:
        `📄 Here is the transcript of your **${ticketRow.panel}** ticket \`${channelName}\`.\n` +
        `How would you rate the support you received?`,
      files: [transcriptAttachment(html, fileName)],
      components: [ratingRow()],
    });
  } catch {
    // The user has DMs closed — nothing we can do.
  }
}

async function handleRatingInteraction(interaction) {
  // The rating buttons live in the user's DMs, so the guild comes from the
  // ticket row instead of the interaction.
  const stars = Number(interaction.customId.slice(RATING_CUSTOM_ID.length + 1));
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
  const row = store.db
    .prepare(
      "SELECT * FROM tickets WHERE ticket_user_id=? AND status='CLOSED' ORDER BY closed_at DESC LIMIT 1",
    )
    .get(interaction.user.id);
  const rating = store.saveTicketRating(row?.guild_id, row?.channel_id, interaction.user.id, stars);
  await interaction
    .update({
      content:
        `📄 Transcript attached above.\n` +
        (stars >= 4
          ? `Thank you! Your **${stars}⭐** rating means a lot to the support team. 💚`
          : `Thank you for your **${stars}⭐** rating — we're sorry the support didn't fully meet your expectations. Your feedback helps us improve.`),
      components: [],
    })
    .catch(() => {});
  if (rating && row) {
    const guild = interaction.client.guilds.cache.get(row.guild_id);
    if (guild) {
      const desc =
        `<@${interaction.user.id}> rated their **${row.panel}** ticket \`${row.channel_id}\` **${"⭐".repeat(stars)}** (${stars}/5).`;
      const transcriptChannelId = store.settings(row.guild_id)?.ticket_transcript_channel_id;
      const ch = transcriptChannelId ? guild.channels.cache.get(transcriptChannelId) : null;
      if (ch?.isTextBased()) await ch.send({ embeds: [embed("Ticket rating", desc)], allowedMentions: { parse: [] } }).catch(() => {});
      await logToChannel(guild, { embeds: [embed("Ticket rating", desc)], allowedMentions: { parse: [] } });
    }
  }
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
  if (!interaction.guildId) return false;

  // Select-menu picks on the Components V2 panel.
  if (interaction.isStringSelectMenu() && interaction.customId === PANEL_SELECT_CUSTOM_ID) {
    const panel = interaction.values[0];
    await openTicket(interaction, panel).catch((e) =>
      console.error("[tickets] open:", e.message),
    );
    return true;
  }

  // Modal submits from the required-question form — create the ticket with the
  // answers filled into the welcome embed.
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${MODAL_CUSTOM_ID}|`)) {
    const panel = interaction.customId.slice(MODAL_CUSTOM_ID.length + 1);
    await interaction.deferReply({ flags: 64 });
    const answers = [];
    for (let i = 0; i < 5; i++) {
      const v = interaction.fields.getTextInputValue(`q${i}`);
      if (v) answers.push(v);
    }
    await createTicket(interaction, panel, answers).catch((e) => {
      console.error("[tickets] open:", e.message);
      interaction.editReply({ content: `I could not create the ticket: ${e.message}` }).catch(() => {});
    });
    return true;
  }

  if (!interaction.isButton()) return false;
  const id = interaction.customId;
  if (id.startsWith(`${RATING_CUSTOM_ID}|`)) {
    await handleRatingInteraction(interaction).catch((e) =>
      console.error("[tickets] rating:", e.message),
    );
    return true;
  }
  if (id === CLAIM_CUSTOM_ID) {
    await claimTicket(interaction).catch((e) =>
      console.error("[tickets] claim button:", e.message),
    );
    return true;
  }
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

// `/panel` — post the Components V2 ticket panel in the current channel.
async function runPanelCommand(interaction) {
  const panels = store.listTicketPanels(interaction.guildId).filter((p) => p.enabled);
  if (!panels.length)
    return {
      content: "No ticket panels are configured for this server.",
      ephemeral: true,
    };
  return buildPanelPayload(panels);
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
