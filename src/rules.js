const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const RULES_URL = "https://wiki.theysix.tech/w/discord/theysix-discord-rules";
const WELCOME_URL = "https://wiki.theysix.tech/w/discord/welcome-to-theysix-discord";
const rules = [
  ["Respect & Behaviour", "Treat other members with kindness and consideration.\n\n• Harassment, intimidation, personal attacks, slander, hate speech, and discrimination are prohibited.\n• Keep disagreements civil; do not target members or stir up hostility.\n• Give constructive criticism without insults or abuse."],
  ["Profiles & Impersonation", "Keep usernames, avatars, and profiles appropriate for the community.\n\n• Do not impersonate staff or another member.\n• Do not use hateful, explicit, or deliberately disruptive profile content.\n• Do not use fake identities to deceive or scam members."],
  ["Appropriate Content", "TheySix is a family-friendly community.\n\n• Do not share NSFW or adult content in messages, images, links, or profiles.\n• Do not share graphic or shocking content to provoke others.\n• Keep discussions suitable for a general audience."],
  ["Channels & Communication", "Use each channel for its intended purpose.\n\n• Keep posts relevant to the channel and follow its description or pinned instructions.\n• Move unrelated discussion to an appropriate channel.\n• Help keep information easy to find for other members."],
  ["Spam & Disruption", "Avoid behaviour that disrupts discussion or server security.\n\n• Do not flood messages, reactions, emojis, or mentions.\n• Do not repeatedly join and leave to evade security checks.\n• Avoid needless staff pings and duplicate support requests."],
  ["Privacy & Safety", "Protect yourself and other members.\n\n• Do not share another person's private information without permission.\n• Do not send phishing links, malware, or deceptive downloads.\n• Report concerning behaviour privately with relevant evidence."],
  ["Creative Work & Downloads", "Respect the creators of Minecraft farms, worlds, schematics, and other shared work.\n\n• Follow the creator's license and attribution requirements.\n• Do not claim another creator's work as your own.\n• Follow Minecraft's EULA and Usage Guidelines when using Minecraft assets or services."],
  ["Sharing & Feedback", "Share useful builds, questions, and feedback in the appropriate channels.\n\n• Explain the project or problem clearly.\n• Include the version, Download Number, and evidence when asking for help.\n• Give respectful, actionable feedback rather than insults."],
  ["Advertising & Self-Promotion", "Minecraft creators may share builds and videos in <#1390278045121904670>.\n\n• Commercial shops, paid services, and paid promotions are not allowed, including in self-promotion.\n• Do not advertise commercial content in other channels or DMs to members.\n• Keep community sharing relevant and helpful."],
  ["Staff Mentions & Escalation", "Use support channels before pinging staff.\n\n• You may ping up to two Helpers once; prefer Helpers without LOA or SLOA tags.\n• If no Helper replies after several hours, you may ping a Moderator once.\n• Do not mass-ping staff or use protected roles without a valid reason."],
  ["Emergency Role", "Reserve the emergency role for genuinely urgent issues.\n\n• Use normal support routes first where possible.\n• The expected response time is 1–8 hours, not an immediate guarantee.\n• Misuse may bring a warning; a third warning may result in a ban."],
  ["Support & Modmail", "Use the appropriate support type for a genuine issue.\n\n• DM Mihulish, choose a topic, answer its questions, and continue in the private channel it creates.\n• Provide useful context and evidence; update an open request instead of making duplicates.\n• Do not open requests just to test or disrupt support."],
  ["Platform Policies & Moderation", "Follow [Discord's Terms](https://discord.com/terms), [Community Guidelines](https://discord.com/guidelines), [Minecraft's EULA](https://www.minecraft.net/eula), and [Usage Guidelines](https://www.minecraft.net/usage-guidelines).\n\n• Follow reasonable staff instructions.\n• Staff consider context, severity, and history when enforcing rules.\n• Raise concerns about moderation respectfully through management modmail."],
];

function link(label, url) { return new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link); }
function ruleEmbed(index) {
  const [title, body] = rules[index];
  return new EmbedBuilder().setColor(0x5865f2).setTitle(`Rule ${index + 1} — ${title}`)
    .setDescription(body).setFooter({ text: "TheySix | Minecraft - https://discord.gg/theysix" }).setURL(RULES_URL);
}
function overview() {
  const menu = new StringSelectMenuBuilder().setCustomId("theysix_rules_select")
    .setPlaceholder("Guidelines & Rules")
    .addOptions(rules.map(([title], i) => ({ label: `Rule ${i + 1} — ${title}`, value: String(i) })));
  return {
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📜 TheySix | Community Rules & Guidelines")
      .setDescription("Welcome to the TheySix community!\n\nTheySix is a place to share Minecraft farms, learn from other builders, and help each other improve. To keep the community safe and useful, everyone is expected to follow these rules.\n\nSelect a guideline below, or press **View All Rules** to read every rule privately. By participating, you agree to these rules and any channel-specific instructions.\n\nThank you for helping make TheySix welcoming for everyone!\n\nhttps://discord.gg/theysix")
      .addFields({ name: "Official policies", value: "[Terms](https://wiki.theysix.tech/legal/terms) · [Privacy](https://wiki.theysix.tech/legal/privacy) · [Cookies](https://wiki.theysix.tech/legal/cookies)" })],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("theysix_rules_all").setLabel("View All Rules").setStyle(ButtonStyle.Primary), link("Full Rules", RULES_URL), link("Welcome Guide", WELCOME_URL), link("Support Guide", "https://wiki.theysix.tech/w/discord/using-theysix-support")),
      new ActionRowBuilder().addComponents(link("Discord Terms", "https://discord.com/terms"), link("Discord Guidelines", "https://discord.com/guidelines"), link("Minecraft EULA", "https://www.minecraft.net/eula"), link("Minecraft Guidelines", "https://www.minecraft.net/usage-guidelines")),
      new ActionRowBuilder().addComponents(link("TheySix Terms", "https://wiki.theysix.tech/legal/terms"), link("Privacy", "https://wiki.theysix.tech/legal/privacy"), link("Cookies", "https://wiki.theysix.tech/legal/cookies"), link("Wiki", "https://wiki.theysix.tech/w"), link("Farm Archive", "https://www.theysix.tech/#farms")),
      new ActionRowBuilder().addComponents(link("Events Server", "https://events.theysix.tech")),
    ],
  };
}
async function handleRulesSelect(interaction) {
  if (interaction.isButton() && interaction.customId === "theysix_rules_all") {
    await interaction.reply({ embeds: rules.slice(0, 9).map((_, i) => ruleEmbed(i)), ephemeral: true });
    await interaction.followUp({ embeds: [
      ...rules.slice(9).map((_, i) => ruleEmbed(i + 9)),
      new EmbedBuilder().setColor(0x5865f2).setTitle("🛡️ Moderation & Enforcement")
        .setDescription("Staff assess reports individually using the available evidence, context, severity, and history.\n\n• Minor or first-time issues may receive a warning or message removal.\n• Repeated or serious conduct may lead to restrictions, timeouts, or bans.\n• Severe misconduct may result in immediate action.\n• If you disagree with a decision, contact management respectfully through private modmail."),
      new EmbedBuilder().setColor(0x5865f2).setTitle("✨ Our Community Commitment")
        .setDescription("Build freely. Share responsibly. Respect others.\n\nRead the [full TheySix rules](https://wiki.theysix.tech/w/discord/theysix-discord-rules) and [welcome guide](https://wiki.theysix.tech/w/discord/welcome-to-theysix-discord).\n\nhttps://discord.gg/theysix"),
    ], ephemeral: true });
    return true;
  }
  if (!interaction.isStringSelectMenu() || interaction.customId !== "theysix_rules_select") return false;
  const index = Number(interaction.values[0]);
  if (!Number.isInteger(index) || index < 0 || index >= rules.length) return false;
  await interaction.reply({ embeds: [ruleEmbed(index)], ephemeral: true });
  return true;
}
module.exports = { overview, handleRulesSelect, ruleEmbed, rules };
