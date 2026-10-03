import { Prisma } from '@prisma/client';
import { Track } from 'shoukaku';
import { db } from '../database/db';
import { logger } from '../utils/logger';
import type { AureliaClient } from '../structures/AureliaClient';
import type { Queue, QueueSnapshot } from '../structures/Queue';

const SAVE_DEBOUNCE_MS = 400;

export function isDiscordSnowflake(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

function persistenceEnabled() {
  return process.env.PLAYBACK_PERSISTENCE_ENABLED !== 'false';
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asTracks(value: Prisma.JsonValue | null): Track[] {
  return Array.isArray(value) ? value as unknown as Track[] : [];
}

function asTrack(value: Prisma.JsonValue | null): Track | null {
  if (!value || Array.isArray(value) || typeof value !== 'object') return null;
  const candidate = value as unknown as Track;
  return typeof candidate.encoded === 'string' && candidate.info ? candidate : null;
}

export class PlaybackSessionService {
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private restoring = false;

  schedule(queue: Queue) {
    if (!persistenceEnabled()) return;
    const existing = this.pending.get(queue.guildId);
    if (existing) clearTimeout(existing);
    this.pending.set(queue.guildId, setTimeout(() => {
      this.pending.delete(queue.guildId);
      void this.save(queue);
    }, SAVE_DEBOUNCE_MS));
  }

  cancel(guildId: string) {
    const timer = this.pending.get(guildId);
    if (timer) clearTimeout(timer);
    this.pending.delete(guildId);
  }

  async save(queue: Queue) {
    if (!persistenceEnabled()) return;
    const snapshot = queue.toSnapshot();
    if (!snapshot) return;
    await this.write(snapshot).catch((error) => {
      logger.error({ error, guildId: queue.guildId }, 'Failed to persist playback session');
    });
  }

  private async write(snapshot: QueueSnapshot) {
    const current = snapshot.current === null ? Prisma.JsonNull : toJson(snapshot.current);
    const tracks = toJson(snapshot.tracks);
    const history = toJson(snapshot.history);
    const filters = snapshot.filters === null ? Prisma.JsonNull : toJson(snapshot.filters);
    await db.playbackSession.upsert({
      where: { guildId: snapshot.guildId },
      create: {
        ...snapshot,
        current,
        tracks,
        history,
        filters,
      },
      update: {
        ...snapshot,
        current,
        tracks,
        history,
        filters,
      },
    });
  }

  async markDisconnecting(guildId: string) {
    const timer = this.pending.get(guildId);
    if (timer) clearTimeout(timer);
    this.pending.delete(guildId);
    await db.playbackSession.updateMany({
      where: { guildId },
      data: { status: 'DISCONNECTING' },
    });
  }

  async delete(guildId: string) {
    this.cancel(guildId);
    await db.playbackSession.deleteMany({ where: { guildId } }).catch((error) => {
      logger.warn({ error, guildId }, 'Failed to delete playback session');
    });
  }

  async flush(queues: Iterable<Queue>) {
    if (!persistenceEnabled()) return;
    await Promise.all([...queues].map((queue) => this.save(queue)));
  }

  async restoreAll(client: AureliaClient) {
    if (!persistenceEnabled() || this.restoring || process.env.PLAYBACK_RECOVERY_ENABLED === 'false') return;
    this.restoring = true;
    try {
      await db.playbackSession.deleteMany({ where: { status: 'DISCONNECTING' } });
      const sessions = await db.playbackSession.findMany({
        where: { status: { in: ['ACTIVE', 'RECOVERING'] } },
      });

      for (const session of sessions) {
        if (!isDiscordSnowflake(session.guildId) || !isDiscordSnowflake(session.voiceChannelId)) {
          logger.warn({
            guildId: session.guildId,
            voiceChannelId: session.voiceChannelId,
          }, 'Deleting invalid playback session snapshot');
          await this.delete(session.guildId);
          continue;
        }
        if (client.queues.has(session.guildId)) continue;
        try {
          const guild = await client.guilds.fetch(session.guildId);
          const voice = await guild.channels.fetch(session.voiceChannelId);
          if (!voice?.isVoiceBased()) {
            await this.delete(session.guildId);
            continue;
          }

          const textCandidates = [session.textChannelId, session.voiceChannelId, process.env.MUSIC_REQUEST_CHANNEL_ID]
            .filter(isDiscordSnowflake);
          let textChannel = null;
          for (const id of textCandidates) {
            const channel = guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null);
            if (channel?.isSendable()) {
              textChannel = channel;
              break;
            }
          }
          if (!textChannel) {
            logger.warn({ guildId: session.guildId }, 'Playback session has no sendable control channel; keeping snapshot for a later retry');
            continue;
          }

          const player = await client.shoukaku.joinVoiceChannel({
            guildId: session.guildId,
            channelId: session.voiceChannelId,
            shardId: guild.shardId,
            deaf: true,
          });
          const { Queue } = await import('../structures/Queue');
          const queue = new Queue(client, player, textChannel, session.guildId);
          client.queues.set(session.guildId, queue);
          await queue.restore({
            guildId: session.guildId,
            voiceChannelId: session.voiceChannelId,
            textChannelId: session.textChannelId,
            nodeName: session.nodeName,
            current: asTrack(session.current),
            tracks: asTracks(session.tracks),
            history: asTracks(session.history),
            loop: session.loop === 'TRACK' || session.loop === 'QUEUE' ? session.loop : 'NONE',
            volume: Math.max(0, Math.min(100, session.volume)),
            paused: session.paused,
            positionMs: Math.max(0, session.positionMs),
            filters: session.filters,
            status: session.status === 'RECOVERING' ? 'RECOVERING' : 'ACTIVE',
          });
          logger.info({ guildId: session.guildId, voiceChannelId: session.voiceChannelId }, 'Playback session restored');
        } catch (error) {
          const partialQueue = client.queues.get(session.guildId);
          if (partialQueue) {
            partialQueue.dispose();
            client.queues.delete(session.guildId);
          }
          await client.shoukaku.leaveVoiceChannel(session.guildId).catch(() => undefined);
          logger.error({ error, guildId: session.guildId }, 'Failed to restore playback session; snapshot retained');
        }
      }
    } finally {
      this.restoring = false;
    }
  }
}

export const playbackSessionService = new PlaybackSessionService();
