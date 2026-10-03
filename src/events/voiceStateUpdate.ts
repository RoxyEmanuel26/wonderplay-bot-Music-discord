import { VoiceState } from 'discord.js';
import { Event } from '../structures/Event';
import { AureliaClient } from '../structures/AureliaClient';
import { logger } from '../utils/logger';
import { playbackSessionService } from '../services/PlaybackSessionService';

const disconnectChecks = new Map<string, NodeJS.Timeout>();
const DISCONNECT_CONFIRMATION_MS = 2500;

const voiceStateUpdateEvent: Event<'voiceStateUpdate'> = {
  name: 'voiceStateUpdate',
  execute: async (oldState: VoiceState, newState: VoiceState, client: AureliaClient) => {
    if (oldState.id !== client.user?.id) return;

    const guildId = oldState.guild.id;
    const pending = disconnectChecks.get(guildId);
    if (pending) clearTimeout(pending);
    disconnectChecks.delete(guildId);

    if (newState.channelId) return;

    // Discord may briefly report channel=null while voice reconnects. Confirm the
    // bot is still out before deleting a persistent queue/session.
    disconnectChecks.set(guildId, setTimeout(() => {
      disconnectChecks.delete(guildId);
      void (async () => {
        const guild = client.guilds.cache.get(guildId);
        const botChannelId = guild?.members.me?.voice.channelId;
        if (botChannelId) {
          logger.info({ guildId, botChannelId }, 'Ignored transient bot voice disconnect during reconnection');
          return;
        }

        const queue = client.queues.get(guildId);
        if (queue) {
          queue.dispose();
          await client.shoukaku.leaveVoiceChannel(guildId).catch(() => undefined);
          client.queues.delete(guildId);
        }
        await playbackSessionService.delete(guildId);
        logger.info({ guildId }, 'Confirmed external bot voice disconnect; playback session removed');
      })().catch((error) => {
        logger.error({ error, guildId }, 'Failed to clean up confirmed bot voice disconnect');
      });
    }, DISCONNECT_CONFIRMATION_MS));
  },
};

export default voiceStateUpdateEvent;
