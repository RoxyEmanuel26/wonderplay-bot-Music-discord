import { VoiceState } from 'discord.js';
import { Event } from '../structures/Event';
import { AureliaClient } from '../structures/AureliaClient';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import { t, Language } from '../utils/i18n';

const timeouts = new Map<string, NodeJS.Timeout>();

const voiceStateUpdateEvent: Event<'voiceStateUpdate'> = {
  name: 'voiceStateUpdate',
  execute: async (oldState: VoiceState, newState: VoiceState, client: AureliaClient) => {
    // If the bot itself left/was kicked, clean up the queue
    if (oldState.id === client.user?.id && !newState.channelId) {
      const queue = client.queues.get(oldState.guild.id);
      if (queue) {
        queue.stop();
        client.shoukaku.leaveVoiceChannel(oldState.guild.id);
        client.queues.delete(oldState.guild.id);
      }
      return;
    }

    const queue = client.queues.get(oldState.guild.id);
    if (!queue) return;

    // Check if the bot is in a voice channel
    const botVoiceChannel = oldState.guild.members.me?.voice.channel;
    if (!botVoiceChannel) return;

    // Count humans in the bot's voice channel
    const humansInVC = botVoiceChannel.members.filter(m => !m.user.bot).size;

    if (humansInVC === 0) {
      // Everyone left the bot's channel
      try {
        const settings = await db.guildSettings.findUnique({ where: { guildId: oldState.guild.id } });
        
        if (!settings || !settings.mode247) {
          // If already counting down, ignore
          if (timeouts.has(oldState.guild.id)) return;

          logger.info(`[VoiceState] Bot is alone in ${oldState.guild.id}. mode247 is false. Starting 60s leave timeout.`);
          
          const timeout = setTimeout(() => {
            const q = client.queues.get(oldState.guild.id);
            if (q) {
              q.stop();
              client.shoukaku.leaveVoiceChannel(oldState.guild.id);
              client.queues.delete(oldState.guild.id);
              
              const lang = (settings?.language as Language) || 'id';
              q.textChannel.send(t('autoLeaveAlone', lang));
              logger.info(`[VoiceState] Left empty VC in ${oldState.guild.id}.`);
            }
            timeouts.delete(oldState.guild.id);
          }, 60000); // 60 seconds

          timeouts.set(oldState.guild.id, timeout);
        }
      } catch (err) {
        logger.error(err, 'Failed to handle voiceStateUpdate for empty VC');
      }
    } else {
      // Someone joined back, cancel the timeout if it exists
      if (timeouts.has(oldState.guild.id)) {
        clearTimeout(timeouts.get(oldState.guild.id)!);
        timeouts.delete(oldState.guild.id);
        logger.info(`[VoiceState] User joined VC in ${oldState.guild.id}. Canceled leave timeout.`);
      }
    }
  },
};

export default voiceStateUpdateEvent;
