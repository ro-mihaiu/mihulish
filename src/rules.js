const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const RULES_URL = "https://wiki.theysix.tech/w/discord/theysix-discord-rules";
const WELCOME_URL = "https://wiki.theysix.tech/w/discord/welcome-to-theysix-discord";
const rules = [
  ["Respect and behaviour", "Treat people with kindness. Disagreements are fine; harassment, intimidation, personal attacks, slander, hate, and discrimination are not."],
  ["Channels and communication", "Post in the channel that fits the subject. Read channel descriptions and pinned instructions. Keep discussions useful and searchable."],
  ["Family-friendly content", "Do not post NSFW or adult content in messages, images, links, or profiles. Keep shared material suitable for the whole community."],
  ["Spam and disruption", "Do not flood messages, reactions, emojis, or mentions. Avoid repeated joins and leaves or other behaviour that disrupts the server or triggers its security systems."],
  ["Advertising and self-promotion", "Minecraft creators may share builds and YouTube videos in <#1390278045121904670>. Commercial shops, paid services, and paid promotions are prohibited, including there and in DMs to members."],
  ["Staff mentions and support", "Use support channels first. You may ping up to two Helpers once, preferably without LOA or SLOA tags. If nobody responds after several hours, you may ping a Moderator once. Do not mass-ping staff."],
  ["Emergency and protected roles", "Use the emergency role only for genuinely urgent issues. Its expected response time is 1–8 hours. Misuse may receive warnings; a third warning may result in a ban. Do not ping protected roles without a valid reason."],
  ["Privacy and safety", "Protect your own and other members' private information. Report threatening, deceptive, or unsafe activity through the appropriate support route."],
  ["Profiles and impersonation", "Usernames, avatars, and profiles must follow Discord policies and these community rules. Do not impersonate staff or other members."],
  ["Creative work and downloads", "Respect creators' ownership and licenses. Use world files, schematics, and other downloads according to the creator's terms and Minecraft's policies."],
  ["Support requests", "Open a real support request in the appropriate category. Provide useful context and evidence. Update an existing request instead of opening duplicates or test requests."],
  ["Discord and Minecraft policies", "Follow Discord's Terms and Community Guidelines and Minecraft's EULA and Usage Guidelines. Community rules do not override those policies."],
  ["Moderation and enforcement", "Follow reasonable staff instructions. Staff assess context and severity, and may act on harmful conduct not listed word for word. Raise concerns with management through private modmail."],
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
      .setDescription("Welcome to the TheySix community. Choose a rule below to read it on its own. These rules cover everyone in the server. Read the full rules and welcome guide for the complete current guidance.\n\n**Be respectful. Share responsibly. Keep support useful.**\n\n> The rules are not fixed, and may be updated at any time. Check the pinned messages in <#995779585339822090> for the latest version.")
      .addFields({ name: "TheySix | Minecraft - Official policies", value: "[Terms](https://wiki.theysix.tech/legal/terms)) · [Privacy](https://wiki.theysix.tech/legal/privacy) · [Cookies](https://wiki.theysix.tech/legal/cookies)" })],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(link("Full Rules", RULES_URL), link("Welcome Guide", WELCOME_URL), link("Support Guide", "https://wiki.theysix.tech/w/discord/using-theysix-support")),
      new ActionRowBuilder().addComponents(link("Discord Terms", "https://discord.com/terms"), link("Discord Privacy", "https://discord.com/privacy"), link("Discord Guidelines", "https://discord.com/guidelines")),
      new ActionRowBuilder().addComponents(link("Minecraft EULA", "https://www.minecraft.net/eula"), link("Minecraft Guidelines", "https://www.minecraft.net/usage-guidelines")),
      new ActionRowBuilder().addComponents(link("Events Server", "https://events.theysix.tech"), link("Wiki", "https://wiki.theysix.tech/w"), link("Farm Archive", "https://www.theysix.tech/#farms")),
    ],
  };
}
async function handleRulesSelect(interaction) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== "theysix_rules_select") return false;
  const index = Number(interaction.values[0]);
  if (!Number.isInteger(index) || index < 0 || index >= rules.length) return false;
  await interaction.reply({ embeds: [ruleEmbed(index)], ephemeral: true });
  return true;
}
module.exports = { overview, handleRulesSelect, rules };
