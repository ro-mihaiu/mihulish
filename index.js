require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', message => {
  if (message.author.bot) return;

  if (message.content === '.ping') {
    message.channel.send('Pong!');
  } else if (message.content === '.hello') {
    message.channel.send(`Hello, ${message.author.username}!`);
  }
});

client.login(process.env.DISCORD_TOKEN);
