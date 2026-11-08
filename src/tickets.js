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
const { sendDM } = require("./utils");
const fs = require("node:fs");
const path = require("node:path");

const PANEL_CUSTOM_ID = "ticket_open";
const PANEL_SELECT_CUSTOM_ID = "ticket_open_select";
const MODAL_CUSTOM_ID = "ticket_modal";
const WIKI_URL = "https://wiki.theysix.tech/w/discord/using-theysix-support";
const CLOSE_CUSTOM_ID = "ticket_close";
const REOPEN_CUSTOM_ID = "ticket_reopen";
const DELETE_CUSTOM_ID = "ticket_delete";
const CLAIM_CUSTOM_ID = "ticket_claim";
const REPORT_MESSAGE_CUSTOM_ID = "ticket_report_message";

// Tracks the panel message a user last interacted with, so the modal-submit
// handler can reset the select menu after the form is filled in. A user can
// only have one open modal at a time, so user_id is a sufficient key.
const pendingPanelReset = new Map();
const dmSessions = new Map();
const dmActiveTickets = new Map();
const DM_SELECT_ID = "modmail_dm_type";
const DM_TICKET_SELECT_ID = "modmail_dm_channel";

// ---------- helpers ----------

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatUptime(ms) {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return `${days} days, ${hours % 24}h, ${minutes % 60}m, ${seconds % 60}s`;
}

function supportCategoryId(guildId) {
  return store.settings(guildId)?.support_category_id || null;
}

function ticketRowForChannel(guildId, channelId) {
  return store.ticket(guildId, channelId);
}
function canManageTicket(interaction) {
  const managerRole = store.settings(interaction.guildId || interaction.guild.id)?.manager_role_id;
  return store.isStaff(interaction.guildId || interaction.guild.id, interaction.user.id) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
    (managerRole && interaction.member?.roles?.cache?.has(managerRole));
}

function ticketControls(closed, { claimed = false, canClaim = true } = {}) {
  const row = new ActionRowBuilder();
  if (closed) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(REOPEN_CUSTOM_ID)
        .setLabel("Reopen modmail")
        .setEmoji("🔓")
        .setStyle(ButtonStyle.Success),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(CLAIM_CUSTOM_ID)
        .setLabel(claimed ? "Claimed" : "Claim modmail")
        .setEmoji("🙋")
        .setStyle(claimed ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(claimed),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_CUSTOM_ID)
      .setLabel("Close modmail")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary),
  );
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(DELETE_CUSTOM_ID)
      .setLabel("Delete modmail")
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
  "staff-apply": {
    label: "Staff Apply", emoji: "📝", description: "Apply to join the staff team",
    info: "Tell us about your experience, availability, and why you want to help TheySix.",
    note: "Management will review your application privately.",
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
  "staff-apply": [
    "What role are you applying for?", "What relevant experience do you have?",
    "Why do you want to join our staff?", "How many hours can you help each week?",
    "What is your time zone?",
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
  { tag: "management", panels: ["staff-apply"], keywords: ["apply", "application", "staff"] },
];

// Auto-assigns the ticket to the best-matching staff member based on the
// ticket's answers. Rules are scored: the DN answer, the video link, the
// problem description and the ticket panel all contribute. Staff with a
// matching expertise tag are preferred, then the staff member with the least
// currently-claimed tickets wins (simple round-robin between equals).
// The ticket creator is never considered — they are not staff and should not
// be pinged or assigned.
function autoAssignStaff(guild, panel, answers, excludeUserId = null) {
  const staff = store.listStaff(guild.id).filter((s) => s.user_id && s.user_id !== excludeUserId);
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

// Panel metadata is keyed by panel name; `panelLabel` resolves the display
// name for any panel (falls back to the raw panel key).
function panelLabel(panel) {
  const meta = PANEL_META[panel];
  return meta ? meta.label : panel;
}

// `/panel` — post a Components V2 panel: a container with an accent color,
// welcome text, one description block per enabled panel, a Quick Select
// section with the wiki link button, and a select menu that opens a question
// form for the chosen ticket type.
function buildPanelPayload(panels) {
  const text = (content) => ({ type: 10, content });
  const divider = (spacing = 1) => ({ type: 14, divider: true, spacing });

  const welcome = text(
    "📨 **TheySix Modmail & Support**\n\n" +
    "Welcome to TheySix Support. Each request opens a private conversation with the relevant staff team. " +
    "Please select the ticket type that best matches your situation.\n\n" +
    "⚠️ **Don't open modmail for fun or just to test the system.**\n" +
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
    components: [
      {
        // Container (type 17) — the accent_color gives the panel its colored
        // side bar / background like the TheySix changelog messages.
        type: 17,
        accent_color: 0xe91e63,
        components: [
          welcome,
          divider(2),
          ...blocks,
          quickSelect,
          selectRow,
          divider(1),
          footer,
        ],
      },
    ],
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

async function reportMessage(interaction) {
  const message = interaction.targetMessage;
  if (!message || !interaction.guildId) return notice(interaction, "Choose a server message to report.");
  if (message.author?.id === interaction.user.id) return notice(interaction, "You cannot report your own message.");
  if (!supportCategoryId(interaction.guildId) || !store.listTicketPanels(interaction.guildId).some((p) => p.panel === "report" && p.enabled))
    return notice(interaction, "Report User modmail is currently unavailable.");
  const modal = new ModalBuilder()
    .setCustomId(`${REPORT_MESSAGE_CUSTOM_ID}|${message.channelId}|${message.id}|${message.author.id}`)
    .setTitle("Report this message")
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Why are you reporting this message?").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("context").setLabel("Additional context (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
    );
  return interaction.showModal(modal);
}

async function submitMessageReport(interaction) {
  const [, sourceChannelId, messageId, authorId] = interaction.customId.split("|");
  const sourceChannel = await interaction.guild.channels.fetch(sourceChannelId).catch(() => null);
  const target = await sourceChannel?.messages?.fetch(messageId).catch(() => null);
  const url = `https://discord.com/channels/${interaction.guildId}/${sourceChannelId}/${messageId}`;
  const reason = interaction.fields.getTextInputValue("reason");
  const context = interaction.fields.getTextInputValue("context") || "Not supplied";
  const evidence = `**Reported message:** [Jump to message](${url})\n**Author:** <@${authorId}>\n**Content:** ${target?.content?.slice(0, 1200) || "(message unavailable or no text)"}\n**Attachments:** ${target?.attachments?.map((a) => a.url).join(" ") || "None"}`;
  const existing = store.db.prepare("SELECT channel_id FROM tickets WHERE guild_id=? AND panel='report' AND ticket_user_id=? AND status='OPEN'")
    .get(interaction.guildId, interaction.user.id);
  const existingChannel = existing && await interaction.guild.channels.fetch(existing.channel_id).catch(() => null);
  if (existingChannel) {
    await interaction.deferReply({ flags: 64 });
    await existingChannel.send({ embeds: [embed("Additional reported message", `${evidence}\n\n**Reason:** ${reason}\n**Context:** ${context}`.slice(0, 4000))], allowedMentions: { parse: [] } });
    return interaction.editReply({ content: `Added this message to your open report: <#${existingChannel.id}>` });
  }
  return createTicket(interaction, "report", [authorId, reason, target?.createdAt?.toISOString() || "Unknown", url, context], evidence);
}

async function createTicket(interaction, panel, answers, evidence = null) {
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

  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 }); // ephemeral

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
  const restricted = ["report", "bug", "partnership", "management", "staff-apply"].includes(panel);
  const staffOverwrites = (restricted ? [] : store.listStaff(guild.id).filter((s) => s.user_id !== interaction.user.id))
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
  // Role-based visibility per panel type: java/bedrock → any staff (via individual overwrites),
  // bug → headmod+, report → mod+, partnership & management → manager+.
  // Staff configured in the bot still see every ticket regardless of panel.
  const s = store.settings(guild.id);
  const roleVisibility = {
    java: null,
    br: null,
    bug: s.headmod_role_id,
    report: s.mod_role_id,
    partnership: s.manager_role_id,
    management: s.manager_role_id,
    "staff-apply": s.manager_role_id,
  };
  const panelRoleId = roleVisibility[panel];
  if (panelRoleId) {
    staffOverwrites.push({
      id: panelRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      type: OverwriteType.Role,
    });
  }

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [...new Map([...overwriteBase, ...staffOverwrites].map((overwrite) => [overwrite.id, overwrite])).values()],
      reason: `Ticket opened by ${interaction.user.tag} (${panel})`,
    });
  } catch (e) {
    return interaction.editReply({
      content: `I could not create the ticket channel: ${e.message}`,
    });
  }

  store.saveTicket(guild.id, channel.id, panel, interaction.user.id, "OPEN");
  if (interaction.dmOnly) {
    store.db.prepare("UPDATE tickets SET dm_only=1 WHERE guild_id=? AND channel_id=?").run(guild.id, channel.id);
    dmActiveTickets.set(interaction.user.id, channel.id);
  }
  // Persist the answers so `/ticket staff helper` and the transcript can
  // match expertise tags later.
  store.saveTicketAnswers(
    guild.id,
    channel.id,
    panel,
    answers,
    PANEL_QUESTIONS[panel] || [],
  );

  // Auto-assign the ticket to the staff member whose expertise best matches
  // the answers (DN, video link, problem description). The ticket creator is
  // never considered — they are not staff and should not be pinged.
  const autoAssigned = restricted ? null : autoAssignStaff(guild, panel, answers, interaction.user.id);
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
  if (evidence) description += `**Message evidence**\n${evidence}\n\n`;
  // Farm tickets accept an optional schematic file — modals only hold five
  // fields, so the file itself is attached in the ticket instead.
  if (panel === "java" || panel === "br") {
    description += `📎 **Schematic file (optional):** if you have a schematic, attach it as a file in this ticket.\n\n`;
  }
  description += `Ask staff to close this modmail once your issue is resolved.`;
  const created = embed(`📩 ${panelLabel(panel)} modmail`, description.slice(0, 4000));
  created.setFooter({ text: `Mihulish | Modmail · #${panel}${autoAssigned ? " · auto-assigned" : ""}` });
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
    content: `Your **${panelLabel(panel)}** modmail is open: https://discord.com/channels/${guild.id}/${channel.id}\nContinue the conversation in that private channel.`,
  });
}

function openDmTickets(guildId, userId) {
  return store.db.prepare("SELECT * FROM tickets WHERE guild_id=? AND ticket_user_id=? AND status='OPEN' AND dm_only=1 ORDER BY created_at DESC").all(guildId, userId);
}
async function sendDmTypeMenu(message, guild) {
  const panels = store.listTicketPanels(guild.id).filter((p) => p.enabled);
  if (!panels.length) return message.reply("Modmail is currently unavailable.");
  const menu = new StringSelectMenuBuilder().setCustomId(DM_SELECT_ID).setPlaceholder("Choose a support topic")
    .addOptions(panels.map((p) => ({ label: panelLabel(p.panel), value: p.panel, description: PANEL_META[p.panel]?.description || "Contact staff" })));
  await message.reply({ content: "Hi! Choose the type of modmail you want to open. I’ll ask a few questions before sending it to staff.", components: [new ActionRowBuilder().addComponents(menu)] });
}
async function handleDmTypeSelect(interaction) {
  const guild = interaction.client.guilds.cache.get(process.env.DISCORD_GUILD_ID || "985227944236568606");
  if (!guild || !await guild.members.fetch(interaction.user.id).catch(() => null))
    return interaction.reply({ content: "You need to be in the TheySix server to open modmail." });
  const panel = interaction.values[0];
  if (!store.listTicketPanels(guild.id).some((p) => p.panel === panel && p.enabled))
    return interaction.reply({ content: "That modmail type is unavailable. DM me again to choose another." });
  const existing = store.db.prepare("SELECT channel_id FROM tickets WHERE guild_id=? AND ticket_user_id=? AND panel=? AND status='OPEN'").get(guild.id, interaction.user.id, panel);
  if (existing)
    return interaction.reply({ content: `You already have an open **${panelLabel(panel)}** conversation: https://discord.com/channels/${guild.id}/${existing.channel_id}` });
  dmSessions.set(interaction.user.id, { guildId: guild.id, panel, answers: [], at: Date.now() });
  return interaction.reply({ content: `**${panelLabel(panel)}** — please answer the following questions one message at a time. Type **cancel** to stop.\n\n**1/${PANEL_QUESTIONS[panel].length}** ${PANEL_QUESTIONS[panel][0]}` });
}
async function handleDmTicketSelect(interaction) {
  const guild = interaction.client.guilds.cache.get(process.env.DISCORD_GUILD_ID || "985227944236568606");
  const ticket = guild && openDmTickets(guild.id, interaction.user.id).find((t) => t.channel_id === interaction.values[0]);
  if (!ticket) return interaction.reply({ content: "That conversation is no longer open. DM me again to choose one." });
  dmActiveTickets.set(interaction.user.id, ticket.channel_id);
  return interaction.reply({ content: `Selected **${panelLabel(ticket.panel)}**: https://discord.com/channels/${guild.id}/${ticket.channel_id}\nContinue in that private channel.` });
}
async function handleModmailDm(message) {
  if (message.guild || message.author.bot) return false;
  const guild = message.client.guilds.cache.get(process.env.DISCORD_GUILD_ID || "985227944236568606");
  if (!guild || !await guild.members.fetch(message.author.id).catch(() => null)) {
    await message.reply("Join the TheySix Discord server before opening modmail.").catch(() => {});
    return true;
  }
  await message.react("📬").catch(() => {});
  const content = message.content.trim();
  const session = dmSessions.get(message.author.id);
  if (content.toLowerCase() === "cancel") {
    dmSessions.delete(message.author.id);
    await message.reply("Modmail setup cancelled. DM me again when you want to start.");
    return true;
  }
  if (session && Date.now() - session.at < 15 * 60 * 1000) {
    if (!content) return message.reply("Please send a text answer to continue.");
    session.answers.push(content.slice(0, 1000));
    session.at = Date.now();
    const questions = PANEL_QUESTIONS[session.panel];
    if (session.answers.length < questions.length)
      return message.reply(`**${session.answers.length + 1}/${questions.length}** ${questions[session.answers.length]}`);
    dmSessions.delete(message.author.id);
    await message.reply("Thanks. I’m opening your private conversation with staff now.");
    const fake = { guild, guildId: guild.id, user: message.author, client: message.client, dmOnly: true,
      deferred: true, replied: false, editReply: ({ content: reply }) => message.author.send(reply) };
    await createTicket(fake, session.panel, session.answers);
    return true;
  }
  dmSessions.delete(message.author.id);
  const open = openDmTickets(guild.id, message.author.id);
  const active = open.find((t) => t.channel_id === dmActiveTickets.get(message.author.id)) || (open.length === 1 ? open[0] : null);
  if (active && content.toLowerCase() !== "new") {
    const channel = await guild.channels.fetch(active.channel_id).catch(() => null);
    if (channel) {
      await message.reply(`Your **${panelLabel(active.panel)}** modmail is open. Continue here: https://discord.com/channels/${guild.id}/${channel.id}`);
      return true;
    }
  }
  if (open.length > 1 && content.toLowerCase() !== "new") {
    const menu = new StringSelectMenuBuilder().setCustomId(DM_TICKET_SELECT_ID).setPlaceholder("Choose an open conversation")
      .addOptions(open.slice(0, 25).map((t) => ({ label: panelLabel(t.panel), value: t.channel_id, description: `Opened ${new Date(t.created_at).toLocaleDateString()}` })));
    await message.reply({ content: "You have multiple open conversations. Choose which one to continue, or type **new** to start another topic.", components: [new ActionRowBuilder().addComponents(menu)] });
    return true;
  }
  await sendDmTypeMenu(message, guild);
  return true;
}

// ---------- claim ----------

// Claim via the 🙋 button inside the ticket. Staff-only; updates the welcome
// message buttons so the claim is visible to everyone in the channel.
async function claimTicket(interaction) {
  const guild = interaction.guild;
  if (!canManageTicket(interaction)) {
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
  const mentionIds = [...new Set([t.ticket_user_id, interaction.user.id].filter(Boolean))];
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content: text, allowedMentions: { users: mentionIds } });
  return interaction.reply({ content: text, allowedMentions: { users: mentionIds } });
}

// ---------- close ----------

async function closeTicket(interaction, { viaCommand = false, reason = null } = {}) {
  const guild = interaction.guild;
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t || t.status !== "OPEN") {
    const message = "This is not a recognized open ticket.";
    return viaCommand ? { error: message } : notice(interaction, message);
  }
  // Closing is a staff action; the ticket owner asks staff or uses the claim.
  if (
    !viaCommand &&
    !canManageTicket(interaction)
  ) {
    return notice(interaction, "Only staff can close a ticket.");
  }
  if (!viaCommand && !interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });

  await generateAndPostTranscript(guild, interaction.channel, t, "closed", interaction.user);
  if (["java", "br", "bug"].includes(t.panel)) {
    const { learnFromClosedTicket, isLearningEnabled } = require("./ticket-learning");
    if (isLearningEnabled(guild.id))
      await learnFromClosedTicket(guild, interaction.channel, t).catch((e) => console.error("[tickets] learning:", e.message));
  }

  // Rename with the closed- prefix — the ChannelUpdate handler in index.js
  // will mark the ticket CLOSED and strip the claim automatically.
  store.saveTicket(guild.id, interaction.channelId, t.panel, t.ticket_user_id, "CLOSED");
  try {
    await interaction.channel.setName(`closed-${interaction.channel.name}`, `Closed by ${interaction.user.tag}`);
  } catch {
    // Fallback if the rename fails (permissions/rate limits).
    store.saveTicket(guild.id, interaction.channelId, t.panel, t.ticket_user_id, "CLOSED");
  }

  const reply = embed(
    "Modmail closed",
    `This ticket has been closed by <@${interaction.user.id}>.${
      reason ? `\n**Reason:** ${reason}` : ""
    }\n` +
    `Staff can reopen or delete it below.`,
  );
  reply.setFooter({ text: "Mihulish | Modmail" });
  // Staff can reopen the ticket from this closed notice (the original welcome
  // message's controls are also still available, but this gives staff a
  // second entry point right next to the transcript).
  await interaction.channel.send({
    embeds: [reply],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(REOPEN_CUSTOM_ID)
          .setLabel("Reopen modmail")
          .setEmoji("🔓")
          .setStyle(ButtonStyle.Success),
      ),
    ],
  });

  await logToChannel(guild, {
    embeds: [
      embed("Ticket closed",
        `**${t.panel}** ticket <#${interaction.channelId}> closed by <@${interaction.user.id}>.${
          reason ? `\n**Reason:** ${reason}` : ""
        }`),
    ],
  });

  if (t.dm_only && t.ticket_user_id) {
    const owner = interaction.client ? await interaction.client.users.fetch(t.ticket_user_id).catch(() => null) : null;
    if (owner) await owner.send(`Your **${panelLabel(t.panel)}** modmail has been closed.${reason ? ` Reason: ${reason}` : ""} DM me again to open a new conversation.`).catch(() => {});
    dmActiveTickets.delete(t.ticket_user_id);
  }

  if (!viaCommand) await interaction.editReply({ content: "Modmail closed." });
  return { ok: true };
}

// ---------- reopen ----------

async function reopenTicket(interaction) {
  const guild = interaction.guild;
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t || t.status !== "CLOSED") return notice(interaction, "This ticket is not closed.");

  if (!canManageTicket(interaction))
    return notice(interaction, "Only staff can reopen a ticket.");

  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });
  try {
    const name = interaction.channel.name.replace(/^closed-/, "");
    await interaction.channel.setName(name, `Reopened by ${interaction.user.tag}`);
  } catch {
    store.saveTicket(guild.id, interaction.channelId, t.panel, t.ticket_user_id, "OPEN");
  }
  await interaction.editReply({ content: "Modmail reopened." });
  await logToChannel(guild, {
    embeds: [embed("Ticket reopened", `**${t.panel}** ticket <#${interaction.channelId}> reopened by <@${interaction.user.id}>`)],
  });
}

// ---------- delete ----------

async function deleteTicket(interaction) {
  const guild = interaction.guild;
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t) return notice(interaction, "This is not a recognized ticket.");
  if (!canManageTicket(interaction))
    return notice(interaction, "Only staff can delete a ticket.");
  // Tickets must be closed before they can be deleted, so a transcript always
  // exists first.
  if (t.status !== "CLOSED")
    return notice(interaction, "Close the ticket first — tickets can only be deleted once closed.");

  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: 64 });

  // The transcript was already generated when the ticket was closed.
  // Deleting just logs the action and removes the channel.
  await logToChannel(guild, {
    embeds: [
      embed("Ticket deleted",
        `**${t.panel}** ticket <#${interaction.channelId}> deleted by <@${interaction.user.id}>`),
    ],
  });

  await interaction.editReply({ content: "Deleting ticket in 5 seconds…" });
  setTimeout(() => {
    interaction.channel.delete(`Ticket deleted by ${interaction.user.tag}`).catch(() => { });
  }, 5000);
}

// ---------- transcript ----------

// Fetches the whole channel history (up to 2000 messages), renders an HTML
// transcript, and posts a branded embed to the configured transcript channel.
async function generateAndPostTranscript(guild, channel, ticketRow, status, actor) {
  let messages = [];
  try {
    let lastId;
    for (let round = 0; round < 100; round++) {
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

  // Keep one complete local record per conversation and regenerate the combined
  // JSONL corpus, so reopening and closing a conversation does not duplicate it.
  try {
    const dir = path.resolve(process.env.MODMAIL_TRANSCRIPT_DIR || "./data/modmail-transcripts");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const record = {
      guildId: guild.id, channelId: channel.id, ticketId: ticketRow.id,
      type: ticketRow.panel, ownerId: ticketRow.ticket_user_id,
      createdAt: ticketRow.created_at, closedAt: Date.now(),
      messages: messages.map((m) => ({
        id: m.id, authorId: m.author?.id, author: m.author?.tag,
        at: m.createdTimestamp, content: m.content,
        attachments: [...m.attachments.values()].map((a) => ({ name: a.name, url: a.url })),
      })),
    };
    fs.writeFileSync(path.join(dir, `${channel.id}.json`), JSON.stringify(record, null, 2), { mode: 0o600 });
    const combined = fs.readdirSync(dir).filter((name) => name.endsWith(".json"))
      .map((name) => JSON.stringify(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"))))
      .join("\n");
    fs.writeFileSync(path.join(dir, "corpus.jsonl"), combined + "\n", { mode: 0o600 });
  } catch (e) {
    console.error("[tickets] local transcript:", e.message);
  }

  const html = renderTranscript(guild, channel, ticketRow, status, actor, messages);
  const fileName = `transcript-${ticketRow.panel}-${channel.id}.html`;

  const transcriptChannelId = store.settings(guild.id)?.ticket_transcript_channel_id;
  if (!transcriptChannelId) return html;

  const ch = guild.channels.cache.get(transcriptChannelId);
  if (!ch?.isTextBased()) return html;

  const owner = await guild.members.fetch(ticketRow.ticket_user_id).catch(() => null);
  const ownerTag = owner ? owner.user.tag : (ticketRow.ticket_user_id ? `<@${ticketRow.ticket_user_id}>` : "unknown");
  const uptime = formatUptime(Date.now() - ticketRow.created_at);
  const closingReason = actor ? `Closed by <@${actor.id}>` : status;
  const claimedBy = ticketRow.assigned_staff_id
    ? (await guild.members.fetch(ticketRow.assigned_staff_id).catch(() => null))?.user.tag || `<@${ticketRow.assigned_staff_id}>`
    : "Unclaimed";

  const transcriptEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("TheySix | Minecraft")
    .setThumbnail(guild.iconURL({ size: 64 }) || undefined)
    .setDescription(`Modmail has been ${status}`)
    .addFields(
      { name: "\u{1F464} Ticket Owner", value: ownerTag, inline: true },
      { name: "\u{1F3AB} Ticket ID", value: `closed-${channel.name}`, inline: true },
      { name: "\u{1F553} Uptime", value: uptime, inline: true },
      { name: "\u{1F534} Closing reason", value: closingReason, inline: true },
      { name: "\u{1F4DC} Web Transcript", value: "[Click here](https://discord.com/channels/" + guild.id + "/" + channel.id + ") to view the full transcript", inline: false },
    )
    .setFooter({ text: `Claimed by ${claimedBy} \u2022 Mihulish Modmail` })
    .setTimestamp();

  await ch
    .send({
      embeds: [transcriptEmbed],
      files: [new AttachmentBuilder(Buffer.from(html, "utf8"), { name: fileName })],
      allowedMentions: { parse: [] },
    })
    .catch((e) => console.error("[tickets] transcript channel:", e.message));

  return html;
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
  if (interaction.isStringSelectMenu() && interaction.customId === DM_TICKET_SELECT_ID) {
    await handleDmTicketSelect(interaction);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === DM_SELECT_ID) {
    await handleDmTypeSelect(interaction);
    return true;
  }
  if (!interaction.guildId) return false;
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${REPORT_MESSAGE_CUSTOM_ID}|`)) {
    await submitMessageReport(interaction);
    return true;
  }

  // Select-menu picks on the Components V2 panel.
  if (interaction.isStringSelectMenu() && interaction.customId === PANEL_SELECT_CUSTOM_ID) {
    const panel = interaction.values[0];
    // Remember which panel message this user picked from, so the modal
    // submit handler can reset the select menu afterwards.
    pendingPanelReset.set(interaction.user.id, interaction.message.id);
    await openTicket(interaction, panel).catch((e) =>
      console.error("[tickets] open:", e.message),
    );
    return true;
  }

  // Modal submits from the required-question form — create the ticket with the
  // answers filled into the welcome embed. createTicket() defers the
  // interaction itself, so we don't defer here.
  if (interaction.isModalSubmit() && interaction.customId.startsWith(`${MODAL_CUSTOM_ID}|`)) {
    const panel = interaction.customId.slice(MODAL_CUSTOM_ID.length + 1);
    const answers = [];
    for (let i = 0; i < 5; i++) {
      const v = interaction.fields.getTextInputValue(`q${i}`);
      if (v) answers.push(v);
    }
    await createTicket(interaction, panel, answers).catch((e) => {
      console.error("[tickets] open:", e.message);
      interaction.editReply({ content: `I could not create the ticket: ${e.message}` }).catch(() => {});
    });
    // Reset the select menu on the original panel message so the user can
    // pick again (e.g. re-select Java after filling the form).
    const panelMsgId = pendingPanelReset.get(interaction.user.id);
    pendingPanelReset.delete(interaction.user.id);
    if (panelMsgId) {
      try {
        const panelMsg = await interaction.guild.messages.fetch(panelMsgId).catch(() => null);
        if (panelMsg?.author?.id === interaction.client.user.id) {
          const panels = store.listTicketPanels(interaction.guildId).filter((p) => p.enabled);
          if (panels.some((p) => p.panel === panel)) {
            await panelMsg.edit(buildPanelPayload(panels)).catch(() => {});
          }
        }
      } catch {}
    }
    return true;
  }

  if (!interaction.isButton()) return false;
  const id = interaction.customId;
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
    !canManageTicket(interaction)
  ) {
    return { content: "Only staff can close tickets.", ephemeral: true };
  }
  const reason = interaction.options.getString("reason")?.trim() || null;
  const result = await closeTicket(interaction, { viaCommand: true, reason });
  if (result?.error) return { content: result.error, ephemeral: true };
  return {
    content: "Ticket closed. Transcript has been saved.",
    ephemeral: true,
  };
}

const CLOSE_REQUEST_APPROVE_CUSTOM_ID = "ticket_close_request_approve";
const CLOSE_REQUEST_REJECT_CUSTOM_ID = "ticket_close_request_reject";

// `/closerequest` — a ticket owner requests closure with a reason and an
// optional time limit (in hours). Staff can approve or reject; when approved
// the ticket closes immediately if no limit was given, or auto-closes once
// the limit elapses.
async function runCloseRequestCommand(interaction) {
  const guild = interaction.guild;
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t || t.status !== "OPEN") {
    return { content: "Run this inside an open ticket channel.", ephemeral: true };
  }
  // Only the ticket owner may request closure.
  if (t.ticket_user_id && t.ticket_user_id !== interaction.user.id) {
    return { content: "Only the ticket owner can request closure.", ephemeral: true };
  }
  const reason = interaction.options.getString("reason", true).trim();
  const limit = interaction.options.getInteger("limit"); // optional — null when omitted
  if (limit !== null && (limit < 1 || limit > 720)) {
    return { content: "Limit must be between 1 and 720 hours.", ephemeral: true };
  }
  store.createCloseRequest(guild.id, interaction.channelId, interaction.user.id, reason, limit);
  const dueAt = limit ? Date.now() + limit * 3600 * 1000 : Date.now();
  // Post a staff-facing review message with approve/reject buttons.
  try {
    await interaction.channel.send({
      content: `Closure request from <@${interaction.user.id}> — **${reason}**${
        limit ? `\nAuto-close in **${limit}h** (<t:${Math.floor(dueAt / 1000)}:f>) if approved.` : "\nIf approved, this ticket will close immediately."
      }`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${CLOSE_REQUEST_APPROVE_CUSTOM_ID}|${interaction.channelId}`)
            .setLabel("Approve")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${CLOSE_REQUEST_REJECT_CUSTOM_ID}|${interaction.channelId}`)
            .setLabel("Reject")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });
  } catch {}
  return {
    content: `Your closure request has been submitted. A staff member will review it.${
      limit ? ` If approved, this ticket will auto-close in **${limit}h** (<t:${Math.floor(dueAt / 1000)}:f>).` : " If approved, this ticket will close immediately."
    }`,
    ephemeral: true,
  };
}

// Staff review via approve/reject buttons posted by /closerequest.
async function handleCloseRequestButton(interaction) {
  if (!interaction.isButton()) return false;
  if (
    interaction.customId !== CLOSE_REQUEST_APPROVE_CUSTOM_ID &&
    interaction.customId !== CLOSE_REQUEST_REJECT_CUSTOM_ID
  )
    return false;
  const guild = interaction.guild;
  if (!guild) return false;
  const t = ticketRowForChannel(guild.id, interaction.channelId);
  if (!t || t.status !== "OPEN") {
    await interaction.reply({ content: "This ticket is no longer open.", ephemeral: true }).catch(() => {});
    return true;
  }
  if (!store.isStaff(guild.id, interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({ content: "Only staff can review closure requests.", ephemeral: true }).catch(() => {});
    return true;
  }
  const row = store.getCloseRequest(guild.id, interaction.channelId);
  if (!row) {
    await interaction.reply({ content: "There is no pending closure request for this ticket.", ephemeral: true }).catch(() => {});
    return true;
  }
  const approved = interaction.customId === CLOSE_REQUEST_APPROVE_CUSTOM_ID;
  store.resolveCloseRequest(guild.id, interaction.channelId, approved ? "approved" : "rejected", interaction.user.id);
  // When no limit was given, close the ticket right away instead of
  // scheduling it for the sweep.
  if (approved && !row.limit_hours) {
    const fakeInteraction = {
      guild,
      client: interaction.client,
      channelId: interaction.channelId,
      channel: interaction.channel,
      user: { id: row.requested_by, tag: "ticket owner" },
      memberPermissions: { has: () => false },
      deferReply: async () => ({}),
      editReply: async () => ({}),
      reply: async () => ({}),
    };
    try {
      await closeTicket(fakeInteraction, { viaCommand: true, reason: row.reason });
    } catch (e) {
      console.error("[close-request] immediate close:", e.message);
    }
    await interaction.reply({ content: "Closure request **approved** — ticket closed.", ephemeral: true }).catch(() => {});
    return true;
  }
  const dueAt = row.created_at + row.limit_hours * 3600 * 1000;
  await interaction.reply({
    content: approved
      ? `Closure request **approved**. This ticket will auto-close in **${row.limit_hours}h** (<t:${Math.floor(dueAt / 1000)}:f>).`
      : "Closure request **rejected**. The ticket remains open.",
    ephemeral: true,
  }).catch(() => {});
  return true;
}

// Sweep: auto-close tickets whose approved close request has elapsed.
async function processExpiredCloseRequests(client) {
  const guilds = client.guilds.cache;
  let closed = 0;
  for (const guild of guilds.values()) {
    const expired = store.expireCloseRequests(guild.id);
    for (const row of expired) {
      const channel = guild.channels.cache.get(row.channel_id);
      if (!channel) continue;
      const t = ticketRowForChannel(guild.id, row.channel_id);
      if (!t || t.status !== "OPEN") continue;
      // Build a minimal interaction-like object. closeTicket() with
      // viaCommand=true only needs guild, channelId, channel and user (the
      // transcript actor); it skips deferReply/editReply entirely.
      const fakeInteraction = {
        guild,
        client,
        channelId: row.channel_id,
        channel,
        user: { id: row.requested_by, tag: "ticket owner" },
        memberPermissions: { has: () => false },
        deferReply: async () => ({}),
        editReply: async () => ({}),
        reply: async () => ({}),
      };
      try {
        await closeTicket(fakeInteraction, { viaCommand: true, reason: row.reason });
        closed++;
      } catch (e) {
        console.error("[tickets] auto-close:", e.message);
      }
    }
  }
  return closed;
}

module.exports = {
  handleModmailDm,
  reportMessage,
  openTicket,
  closeTicket,
  reopenTicket,
  deleteTicket,
  claimTicket,
  handleTicketInteraction,
  runPanelCommand,
  runCloseCommand,
  runCloseRequestCommand,
  handleCloseRequestButton,
  processExpiredCloseRequests,
  CLOSE_REQUEST_APPROVE_CUSTOM_ID,
  CLOSE_REQUEST_REJECT_CUSTOM_ID,
  ticketControls,
  PANEL_QUESTIONS,
  AUTO_ASSIGN_RULES,
};
