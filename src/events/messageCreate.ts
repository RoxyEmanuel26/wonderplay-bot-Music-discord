import { Events, Message, PermissionsBitField, Collection, TextChannel } from 'discord.js';
import { Event } from '../structures/Event';
import { logger } from '../utils/logger';
import { Context } from '../structures/Context';
import { t, getLanguage, Language } from '../utils/i18n';

const PREFIX = process.env.PREFIX || '!';

// Cooldown storage: Map<CommandName, Collection<UserId, Timestamp>>
const cooldowns = new Collection<string, Collection<string, number>>();

const messageCreateEvent: Event<'messageCreate'> = {
  name: 'messageCreate',
  execute: async (message: Message, client) => {
    if (message.author.bot || !message.guildId) return;
    if (!message.content.startsWith(PREFIX)) return;

    // Pengecekan Izin Dasar Bot (Send Messages & Embed Links)
    if (message.guild && message.guild.members.me) {
      const channel = message.channel as TextChannel;
      const botPermissions = channel.permissionsFor(message.guild.members.me);
      
      if (!botPermissions || !botPermissions.has(PermissionsBitField.Flags.SendMessages)) {
        // Jangan lakukan apa-apa jika bot bahkan tidak bisa mengirim pesan
        return;
      }
      if (!botPermissions.has(PermissionsBitField.Flags.EmbedLinks)) {
        await channel.send('❌ Bot membutuhkan izin **Embed Links** untuk berfungsi dengan baik di saluran ini.').catch(() => {});
        return;
      }
    }

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();

    if (!commandName) return;

    let command = client.commands.get(commandName);
    if (!command) {
      command = client.commands.find((cmd) => cmd.aliases && cmd.aliases.includes(commandName));
    }
    if (!command) return;

    // Sistem Cooldown (Mencegah Spam Prefix)
    if (!cooldowns.has(command.data.name)) {
      cooldowns.set(command.data.name, new Collection());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(command.data.name)!;
    const cooldownAmount = 3000; // 3 detik per command per user

    if (timestamps.has(message.author.id)) {
      const expirationTime = timestamps.get(message.author.id)! + cooldownAmount;
      if (now < expirationTime) {
        // Jangan spam balas, abaikan saja request spam tersebut
        return;
      }
    }

    timestamps.set(message.author.id, now);
    setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

    const ctx = new Context(message, args);

    try {
      await command.execute(ctx, client);
    } catch (error) {
      logger.error(error, `Error executing prefix command ${commandName}`);
      
      let lang: Language = 'id';
      if (message.guildId) {
        lang = await getLanguage(message.guildId);
      }

      const errorMsg = t('errorExecuting', lang);
      await ctx.reply({ content: errorMsg }).catch(() => {});
    }
  },
};

export default messageCreateEvent;
