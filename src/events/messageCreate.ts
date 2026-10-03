import { Message, PermissionsBitField, TextChannel } from 'discord.js';
import { Event } from '../structures/Event';
import { logger } from '../utils/logger';
import { Context } from '../structures/Context';
import { t, getLanguage, Language } from '../utils/i18n';

import { checkCooldown } from '../utils/cooldown';

const PREFIX = process.env.PREFIX || process.env.DEFAULT_PREFIX || '!';
const MUSIC_REQUEST_CHANNEL_ID = process.env.MUSIC_REQUEST_CHANNEL_ID || '1343831026316742688';

function normalizeMusicRequest(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  const angleBracketUrl = normalized.match(/^<(https?:\/\/[^>\s]+)>$/i);
  if (angleBracketUrl) return angleBracketUrl[1];

  const markdownUrl = normalized.match(/^\[(https?:\/\/[^\]\s]+)\]\((https?:\/\/[^)\s]+)\)$/i);
  return markdownUrl?.[2] || normalized;
}

const messageCreateEvent: Event<'messageCreate'> = {
  name: 'messageCreate',
  execute: async (message: Message, client) => {
    if (!message.guildId) return;

    const activeQueue = client.queues.get(message.guildId);
    if (message.author.id !== client.user?.id && activeQueue?.isControlChannel(message.channelId)) {
      activeQueue.scheduleControlPanelRefresh();
    }

    if (message.author.bot) return;

    const content = message.content.trim();
    if (!content) return;

    const isPrefixCommand = content.startsWith(PREFIX);
    const isMusicRequest = !isPrefixCommand && message.channelId === MUSIC_REQUEST_CHANNEL_ID;
    if (!isPrefixCommand && !isMusicRequest) return;

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

    const args = isMusicRequest
      ? [normalizeMusicRequest(content)]
      : content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = isMusicRequest ? 'play' : args.shift()?.toLowerCase();

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
      client.queues.get(message.guildId)?.scheduleControlPanelRefresh();
    } catch (error) {
      logger.error(error, `Error executing message command ${commandName}`);
      
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
