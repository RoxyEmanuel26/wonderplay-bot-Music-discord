import { Message, PermissionsBitField, TextChannel } from 'discord.js';
import { Event } from '../structures/Event';
import { logger } from '../utils/logger';
import { Context } from '../structures/Context';
import { t, getLanguage, Language } from '../utils/i18n';

import { checkCooldown } from '../utils/cooldown';

const PREFIX = process.env.PREFIX || '!';

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

    // Sistem Cooldown Redis (Mencegah Spam Prefix)
    const isSpamming = await checkCooldown(message.author.id, command.data.name, 3000);
    if (isSpamming) return; // Abaikan pesan spam

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
