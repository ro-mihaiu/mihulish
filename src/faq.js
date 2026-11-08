const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const WIKI = "https://wiki.theysix.tech/w";
const STAFF = "https://theysix.tech/staff";
function section(title, entries) {
  return new EmbedBuilder().setColor(0x5865f2).setTitle(title)
    .setDescription(entries.map(([question, answer]) => `❯ **${question}**\n${answer}`).join("\n\n"));
}
function link(label, url) { return new ButtonBuilder().setLabel(label).setURL(url).setStyle(ButtonStyle.Link); }
function faqPayload() {
  return {
    embeds: [
      new EmbedBuilder().setColor(0x5865f2).setTitle("⛏️ TheySix • Frequently Asked Questions")
        .setDescription("A quick guide to farm downloads, troubleshooting, community access, and the team. For detailed instructions, browse the [TheySix Wiki](https://wiki.theysix.tech/w).\n\n🌐 [Website](https://theysix.tech) • 📚 [Wiki](https://wiki.theysix.tech/w) • 💬 [Support guide](https://wiki.theysix.tech/w/discord/using-theysix-support)"),
      section("📌 General & Community", [
        ["What is TheySix?", "A Minecraft community sharing farm designs, tutorials, world downloads, and Java schematics."],
        ["Where are announcements and events?", "Check the server's announcement and event channels. [Start with the Discord welcome guide](https://wiki.theysix.tech/w/discord/welcome-to-theysix-discord)."],
        ["Why can't I see worlds or schematics?", "Open the server menu and enable **Show All Channels**. Some permissions also unlock as you gain levels."],
        ["Where are the community rules?", "Read the [TheySix Discord rules](https://wiki.theysix.tech/w/discord/theysix-discord-rules) or use `/rules`."],
      ]),
      section("📥 Farm Downloads", [
        ["What is a Download Number (DN)?", "A number used to look up a farm's archive entry. Find it in the video description or on the farm page."],
        ["How do I get a world or schematic?", "Use `/dn` with the number, or search the [farm archive](https://theysix.tech/#farms). World files are in worlds; Java schematics are in schematics."],
        ["Why is there no schematic link?", "Some farms have only a world file. You can open the world and [create a schematic](https://wiki.theysix.tech/w/java/how-to-create-a-schematic)."],
        ["How do I install a download?", "Use the [Java world guide](https://wiki.theysix.tech/w/java/how-to-use-a-world-folder), [Litematica guide](https://wiki.theysix.tech/w/java/how-to-use-a-litematica-file-and-add-it-in-minecraft-java), or [Bedrock world guide](https://wiki.theysix.tech/w/bedrock/installing-bedrock-worlds-and-converting-formats)."],
      ]),
      section("🔧 Troubleshooting & Support", [
        ["Why is my farm not working?", "Watch the tutorial for setup details, check the Minecraft version, AFK position, chunk loading, and whether other players affect the mob cap. [Read the farm FAQ](https://wiki.theysix.tech/w/discord/discord-faq-and-farm-downloads)."],
        ["Where should I ask for help?", "Use `/ticket create` and choose Java or Bedrock. Include the farm's DN, version, and what you tried. [Support guide](https://wiki.theysix.tech/w/discord/using-theysix-support)."],
        ["How do I report a bug or user?", "Use `/ticket create` and choose **Report Bug** or **Report User**. Include steps to reproduce or relevant evidence."],
        ["Which shaders or resource packs are recommended?", "The community FAQ mentions Complementary shaders, Better Leaves Addon, Crops 3D, and VanillaTweaks. Settings depend on version and hardware."],
      ]),
      section("🛡️ Staff & Contributions", [
        ["Who is on the current team?", `See the [active staff directory](${STAFF}) for roles, profiles, and Discord handles.`],
        ["Where are former team members listed?", "The [retired staff directory](https://theysix.tech/staff/retired) recognizes previous contributors."],
        ["How do I apply for staff?", "Use `/ticket create` and choose **Staff Apply** when applications are available."],
        ["How do I contact management or propose a partnership?", "Open a **Management** or **Partnership** modmail with `/ticket create`."],
      ]).setFooter({ text: "TheySix • Build, learn, and share | Need help? Open modmail" }),
    ],
    components: [new ActionRowBuilder().addComponents(
      link("Wiki", WIKI), link("Farm Archive", "https://theysix.tech/#farms"),
      link("Active Staff", STAFF), link("Retired Staff", "https://theysix.tech/staff/retired"),
    )],
  };
}
module.exports = { faqPayload };
