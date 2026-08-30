const { PermissionFlagsBits } = require("discord.js");
const store = require("./database");

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

function reply(message, content) {
  return message.reply({ content }).catch((error) => {
    console.error("[prefix] failed to reply:", error.message);
  });
}

async function handlePrefixMessage(message) {
  if (message.author.bot || !message.guild) return;

  const command = parsePrefixMessage(message);
  if (!command) return;

  if (command.name === "help") {
    return reply(
      message,
      "Mihulish uses slash commands as its full interface. Use `/help` for documentation or `/commands` for the command list.",
    );
  }

  if (command.name === "prefix") {
    return reply(
      message,
      "This server uses the `" + getPrefix(message.guild.id) + "` prefix.",
    );
  }

  if (command.name === "settings") {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return reply(message, "Only server administrators can change settings.");
    }

    const [newPrefix] = command.arguments;
    const currentPrefix = getPrefix(message.guild.id);

    if (!newPrefix) {
      return reply(
        message,
        "Current prefix: `" +
          currentPrefix +
          "`. Usage: `" +
          currentPrefix +
          "settings prefix <new-prefix>`",
      );
    }

    if (newPrefix.length > 5 || /\s/.test(newPrefix)) {
      return reply(
        message,
        "The prefix must be 1–5 characters and cannot contain spaces.",
      );
    }

    store.updateSettings(message.guild.id, { prefix: newPrefix });
    return reply(message, "Prefix updated to `" + newPrefix + "`.");
  }

  return reply(
    message,
    "Unknown prefix command `" +
      command.name +
      "`. Use `" +
      getPrefix(message.guild.id) +
      "help`.",
  );
}

module.exports = {
  DEFAULT_PREFIX,
  getPrefix,
  parsePrefixMessage,
  handlePrefixMessage,
};
