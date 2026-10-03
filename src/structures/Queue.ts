import { Player, Track } from 'shoukaku';
import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
  SendableChannels,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { AureliaClient } from './AureliaClient';
import { logger } from '../utils/logger';
import { createBaseEmbed, createErrorEmbed } from '../utils/embeds';
import { formatDuration, createProgressBar } from '../utils/progressbar';
import { playbackSessionService } from '../services/PlaybackSessionService';
import {
  lyricsService,
  LyricsRateLimitError,
  splitLyrics,
  stripSyncedTimestamps,
} from '../services/LyricsService';

export type PlaybackState = 'PLAYING' | 'PAUSED' | 'RECOVERING' | 'IDLE';

export interface QueueSnapshot {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string | null;
  nodeName: string | null;
  current: Track | null;
  tracks: Track[];
  history: Track[];
  loop: 'NONE' | 'TRACK' | 'QUEUE';
  volume: number;
  paused: boolean;
  positionMs: number;
  filters: unknown;
  status: 'ACTIVE' | 'RECOVERING';
}

export class Queue {
  public tracks: Track[] = [];
  public history: Track[] = [];
  public current: Track | null = null;
  public player: Player;
  public client: AureliaClient;
  public textChannel: SendableChannels;
  public guildId: string;
  public loop: 'NONE' | 'TRACK' | 'QUEUE' = 'NONE';
  public state: PlaybackState = 'IDLE';
  public recoveryReason: string | null = null;

  private operation: Promise<void> = Promise.resolve();
  private panelOperation: Promise<void> = Promise.resolve();
  private attemptedNodes = new Set<string>();
  private controlMessages = new Map<string, Message>();
  private panelTimer: NodeJS.Timeout | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private checkpointTimer: NodeJS.Timeout | null = null;
  private recoveryAttempt = 0;
  private disposed = false;
  private queueRevision = 0;
  private playbackGeneration = 0;
  private lastNonZeroVolume = 100;
  private lastAction: { userId: string; label: string; timestamp: number } | null = null;
  private disconnecting = false;
  private currentFilter = 'none';
  private expectedMigrationCloseUntil = 0;
  private alternativeRecoveryAttempted = false;
  private retryablePlaybackFailure: string | null = null;
  private readonly lyricsCooldowns = new Map<string, number>();

  constructor(client: AureliaClient, player: Player, textChannel: SendableChannels, guildId: string) {
    this.client = client;
    this.player = player;
    this.textChannel = textChannel;
    this.guildId = guildId;
    const checkpointMs = Math.max(1000, Number(process.env.PLAYBACK_CHECKPOINT_INTERVAL_MS) || 5000);
    this.checkpointTimer = setInterval(() => playbackSessionService.schedule(this), checkpointMs);

    this.player.on('end', (event) => {
      const generationAtEvent = this.playbackGeneration;
      logger.info({
        guildId: this.guildId,
        reason: event.reason,
        encoded: event.track.encoded,
        generation: this.playbackGeneration,
        node: this.player.node.name,
        remaining: this.tracks.length,
      }, 'Received Lavalink track-end event');
      if (event.reason === 'replaced' || event.reason === 'stopped') {
        return;
      }
      this.runDetached(async () => {
        if (!this.isCurrentEvent(event.track.encoded, 'end', generationAtEvent)) return;
        if (event.reason === 'loadFailed') {
          await this.recoverPlayback('loadFailed');
          return;
        }
        await this.advanceCurrent('natural-end');
      });
    });

    this.player.on('exception', (event) => {
      logger.error({ guildId: this.guildId, track: this.current, exception: event.exception }, 'Lavalink Player Exception');
      const encodedAtEvent = this.current?.encoded;
      const generationAtEvent = this.playbackGeneration;
      const exceptionMessage = [event.exception?.message, event.exception?.cause]
        .filter((value): value is string => typeof value === 'string')
        .join('\n');
      if (this.current && this.isYouTubeTrack(this.current) && this.isYoutubeSourceUnavailable(exceptionMessage)) {
        this.retryablePlaybackFailure = 'YouTube menolak stream pada semua client; menunggu autentikasi/node pulih';
      }
      this.runDetached(async () => {
        if (!encodedAtEvent || !this.isCurrentEvent(encodedAtEvent, 'exception', generationAtEvent)) return;
        await this.recoverPlayback('exception');
      });
    });

    this.player.on('stuck', (event) => {
      const generationAtEvent = this.playbackGeneration;
      logger.warn({ guildId: this.guildId, track: this.current, thresholdMs: event.thresholdMs }, 'Lavalink Player Stuck');
      this.runDetached(async () => {
        if (!this.isCurrentEvent(event.track.encoded, 'stuck', generationAtEvent)) return;
        await this.recoverPlayback('stuck');
      });
    });

    this.player.on('closed', (event) => {
      const connectionChannelId = this.client.shoukaku.connections.get(this.guildId)?.channelId;
      const discordChannelId = this.client.guilds.cache.get(this.guildId)?.members.me?.voice.channelId;
      const stillInVoice = Boolean(connectionChannelId || discordChannelId);
      logger.info({
        guildId: this.guildId,
        code: event.code,
        reason: event.reason,
        disconnecting: this.disconnecting,
        stillInVoice,
        node: this.player.node.name,
      }, 'Lavalink player closed');
      if (this.expectedMigrationCloseUntil >= Date.now()) {
        this.expectedMigrationCloseUntil = 0;
        logger.info({
          guildId: this.guildId,
          code: event.code,
          node: this.player.node.name,
        }, 'Ignored expected player close emitted by a Lavalink node migration');
        return;
      }
      if (!this.disconnecting && stillInVoice) {
        logger.warn({ guildId: this.guildId }, 'Queue retained while Lavalink migrates or reconnects the player');
        this.beginRecovery(`player-closed:${event.code}`);
        return;
      }
      this.dispose();
      this.client.queues.delete(this.guildId);
    });
  }

  public enqueue(track: Track): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.tracks.push(track);
    this.queueRevision++;
    this.changed();
    return this.runExclusive(() => this.playNext());
  }

  public enqueueMany(tracks: Track[]): Promise<void> {
    if (this.disposed || tracks.length === 0) return Promise.resolve();
    this.tracks.push(...tracks);
    this.queueRevision++;
    this.changed();
    return this.runExclusive(() => this.playNext());
  }

  public play(): Promise<void> {
    return this.runExclusive(() => this.playNext());
  }

  public next(): Promise<void> {
    return this.runExclusive(() => this.advanceCurrent('manual-next'));
  }

  public skip(): Promise<void> {
    return this.runExclusive(async () => {
      if (this.disposed || !this.current) return;
      this.pushHistory(this.current);
      this.current = null;
      this.attemptedNodes.clear();
      this.queueRevision++;
      await this.playNext();
    });
  }

  public previous(): Promise<void> {
    return this.runExclusive(async () => {
      const previous = this.history.pop();
      if (!previous || this.disposed) return;
      if (this.current) this.tracks.unshift(this.current);
      this.current = null;
      this.queueRevision++;
      await this.startTrack(previous, 'previous');
    });
  }

  public jumpTo(index: number): Promise<boolean> {
    let moved = false;
    return this.runExclusive(async () => {
      const selected = this.tracks[index];
      if (!selected || this.disposed) return;
      this.tracks.splice(index, 1);
      if (this.current) this.pushHistory(this.current);
      this.current = null;
      this.queueRevision++;
      await this.startTrack(selected, 'queue-select');
      moved = true;
    }).then(() => moved);
  }

  public stop(): Promise<void> {
    return this.runExclusive(() => this.stopInternal());
  }

  public setVolume(level: number): Promise<void> {
    return this.runExclusive(async () => {
      this.requirePlayerSession('mengubah volume');
      const volume = Math.max(0, Math.min(100, level));
      await this.player.setGlobalVolume(volume);
      if (volume > 0) this.lastNonZeroVolume = volume;
      this.changed();
      this.scheduleControlPanelRefresh();
    });
  }

  public setPaused(paused: boolean): Promise<void> {
    return this.runExclusive(async () => {
      if (!this.current) {
        throw new Error('Tidak ada lagu yang dapat dijeda atau dilanjutkan.');
      }
      this.requirePlayerSession(paused ? 'menjeda musik' : 'melanjutkan musik');
      await this.player.setPaused(paused);
      this.state = paused ? 'PAUSED' : 'PLAYING';
      this.changed();
      this.scheduleControlPanelRefresh();
    });
  }

  public applyAudioFilter(value: string): Promise<void> {
    return this.applyFilter(value);
  }

  public disconnect(): Promise<void> {
    return this.runExclusive(async () => {
      if (this.disposed) return;
      this.disconnecting = true;
      await playbackSessionService.markDisconnecting(this.guildId);
      await this.stopInternal(false);
      await this.client.shoukaku.leaveVoiceChannel(this.guildId).catch((error) => {
        logger.warn({ error, guildId: this.guildId }, 'Failed to leave voice channel cleanly');
      });
      this.client.queues.delete(this.guildId);
      await playbackSessionService.delete(this.guildId);
      this.dispose();
    });
  }

  /** Keep the player on the node that produced its encoded tracks. */
  public async bindToNode(nodeName: string): Promise<boolean> {
    if (this.disposed || this.current) return false;
    if (!this.client.isLavalinkNodeHealthy(nodeName)) return false;
    if (this.player.node.name === nodeName) return this.hasUsablePlayerSession();

    this.player.track = null;
    try {
      const moved = await this.movePlayer(nodeName, 'bind-to-source-node');
      if (!moved) {
        logger.warn({ guildId: this.guildId, nodeName }, 'Could not bind player to track source node');
      }
      return moved;
    } catch (error) {
      logger.warn({ error, guildId: this.guildId, nodeName }, 'Failed to bind player to track source node');
      return false;
    }
  }

  /** Clean local state when Discord/Lavalink has already closed the player. */
  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    playbackSessionService.cancel(this.guildId);
    this.attemptedNodes.clear();
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    if (this.checkpointTimer) clearInterval(this.checkpointTimer);
    this.recoveryTimer = null;
    this.checkpointTimer = null;
    if (this.panelTimer) clearTimeout(this.panelTimer);
    this.panelTimer = null;
    void this.deleteControlPanels();
  }

  private runExclusive(operation: () => Promise<void>): Promise<void> {
    const run = this.operation.then(operation, operation);
    this.operation = run.catch((error) => {
      logger.error({ error, guildId: this.guildId }, 'Queue operation failed');
    });
    return run;
  }

  /** Queue an event-driven operation while keeping failures handled in the background. */
  private runDetached(operation: () => Promise<void>) {
    void this.runExclusive(operation).catch(() => undefined);
  }

  /**
   * Shoukaku briefly reports CONNECTED before it stores Lavalink's ready
   * session id. A Player can also retain the old Node object after a node was
   * recreated by the long-running reconnect watchdog. Refresh that reference
   * and require both values before issuing any player REST request.
   */
  private hasUsablePlayerSession(): boolean {
    const registered = this.client.shoukaku.nodes.get(this.player.node.name);
    if (
      registered
      && registered !== this.player.node
      && registered.state === 1
      && registered.sessionId
    ) {
      this.player.node = registered;
    }

    return Boolean(this.player.node.state === 1 && this.player.node.sessionId);
  }

  private isSessionUnavailableError(error: unknown): boolean {
    const candidate = error as { message?: unknown; path?: unknown; status?: unknown };
    const message = typeof candidate?.message === 'string' ? candidate.message : '';
    const path = typeof candidate?.path === 'string' ? candidate.path : '';
    return /session not found/i.test(message)
      || /\/sessions\/(?:null|undefined)(?:\/|$)/i.test(path)
      || (candidate?.status === 404 && /\/sessions\//i.test(path));
  }

  private requirePlayerSession(operation: string): void {
    if (this.hasUsablePlayerSession()) return;
    if (this.current) this.beginRecovery(`control:${operation}:session-unavailable`);
    throw new Error(`Node audio sedang menyambung kembali; belum dapat ${operation}.`);
  }

  private async playNext() {
    if (this.disposed || this.current) return;

    while (!this.disposed && !this.current && this.tracks.length > 0) {
      const track = this.tracks.shift();
      if (!track) break;
      this.queueRevision++;
      await this.startTrack(track, 'next');
    }

    if (!this.current && this.tracks.length === 0) {
      if (this.hasUsablePlayerSession()) {
        await this.player.stopTrack().catch((error) => {
          if (!this.isSessionUnavailableError(error)) {
            logger.warn({ error, guildId: this.guildId }, 'Failed to stop an empty queue');
          }
        });
      }
      this.state = 'IDLE';
      this.recoveryReason = null;
      this.changed();
      this.scheduleControlPanelRefresh(0);
    }
  }

  private async startTrack(track: Track, reason: string) {
    const previousTitle = this.current?.info.title || null;
    this.current = track;
    this.playbackGeneration++;
    this.attemptedNodes = new Set([this.player.node.name]);
    this.alternativeRecoveryAttempted = false;
    this.retryablePlaybackFailure = null;

    if (!this.hasUsablePlayerSession()) {
      logger.warn({
        guildId: this.guildId,
        node: this.player.node.name,
        reason,
        title: track.info.title,
      }, 'Playback retained until Lavalink provides a valid session id');
      this.beginRecovery('session-unavailable');
      return;
    }

    try {
      await this.player.playTrack({ track: { encoded: track.encoded } });
      this.state = this.player.paused ? 'PAUSED' : 'PLAYING';
      this.recoveryReason = null;
      this.recoveryAttempt = 0;
      logger.info({
        guildId: this.guildId,
        generation: this.playbackGeneration,
        reason,
        previousTitle,
        title: track.info.title,
        remaining: this.tracks.length,
        node: this.player.node.name,
      }, 'Playback transition completed');
      this.scheduleControlPanelRefresh();
      this.changed();
    } catch (error) {
      logger.error({ error, guildId: this.guildId, reason, track, node: this.player.node.name }, 'Failed to start Lavalink track');
      if (this.isSessionUnavailableError(error) || !this.hasUsablePlayerSession()) {
        this.beginRecovery('session-unavailable');
        return;
      }
      await this.recoverPlayback('loadFailed');
    }
  }

  private async advanceCurrent(reason: string) {
    if (this.disposed || !this.current) return;

    const finishedTrack = this.current;
    if (this.loop === 'TRACK') {
      this.current = null;
      await this.startTrack(finishedTrack, `${reason}:loop-track`);
      return;
    } else if (this.loop === 'QUEUE') {
      this.tracks.push(finishedTrack);
    }

    this.pushHistory(finishedTrack);
    this.current = null;
    this.attemptedNodes.clear();
    this.queueRevision++;
    this.changed();
    logger.info({
      guildId: this.guildId,
      reason,
      encoded: finishedTrack.encoded,
      generation: this.playbackGeneration,
      remaining: this.tracks.length,
      node: this.player.node.name,
    }, 'Advancing playback queue');
    await this.playNext();
  }

  private pushHistory(track: Track) {
    this.history.push(track);
    if (this.history.length > 50) this.history.shift();
  }

  private isCurrentEvent(encoded: string, eventType: string, generation: number): boolean {
    const matches = Boolean(
      this.current
      && this.current.encoded === encoded
      && this.playbackGeneration === generation,
    );
    if (!matches) {
      logger.debug({
        guildId: this.guildId,
        eventType,
        eventGeneration: generation,
        generation: this.playbackGeneration,
        current: this.current?.info.title,
      }, 'Ignored stale Lavalink player event');
    }
    return matches;
  }

  private async recoverPlayback(cause: string) {
    if (this.disposed || !this.current) return;

    // A reconnect watchdog can replace the Node instance while the Queue still
    // owns the previous Player reference. Synchronize it before comparing node
    // names or issuing a REST update.
    this.hasUsablePlayerSession();

    const connectedNodes = Array.from(this.client.shoukaku.nodes.values())
      .filter((node) => this.client.isLavalinkNodeHealthy(node.name));
    if (connectedNodes.length === 0) {
      this.beginRecovery(cause);
      return;
    }

    const candidates = connectedNodes
      .filter((node) => !this.attemptedNodes.has(node.name))
      .sort((a, b) => a.penalties - b.penalties);

    for (const node of candidates) {
      this.attemptedNodes.add(node.name);
      try {
        const replacement = await this.resolveTrackForNode(this.current, node.name);
        if (!replacement) {
          logger.warn({ guildId: this.guildId, node: node.name }, 'Fallback node could not resolve a compatible track');
          continue;
        }

        logger.warn(
          { guildId: this.guildId, from: this.player.node.name, to: node.name, cause },
          'Moving failed playback to a fallback Lavalink node',
        );
        // Encoded tracks are not portable when nodes use different source managers
        // or plugin versions. Resume the voice session without the old track, then
        // play the track encoded by the destination node itself.
        const position = Math.max(0, this.player.position || 0);
        this.player.track = null;
        const ready = this.player.node.name === node.name || await this.movePlayer(node.name, `recovery:${cause}`);
        if (ready) {
          this.current = replacement;
          this.playbackGeneration++;
          await this.player.playTrack({
            track: { encoded: replacement.encoded },
            position: Math.min(position, replacement.info.length || position),
            paused: this.state === 'PAUSED',
            volume: Math.min(100, this.player.volume),
          });
          this.state = this.player.paused ? 'PAUSED' : 'PLAYING';
          this.recoveryReason = null;
          this.retryablePlaybackFailure = null;
          this.recoveryAttempt = 0;
          this.scheduleControlPanelRefresh();
          logger.info({
            guildId: this.guildId,
            node: node.name,
            cause,
            encoded: replacement.encoded,
            generation: this.playbackGeneration,
            remaining: this.tracks.length,
          }, 'Playback recovered on fallback Lavalink node');
          this.changed();
          return;
        }
      } catch (error) {
        logger.warn({ error, guildId: this.guildId, node: node.name }, 'Fallback Lavalink node failed');
        if (this.isSessionUnavailableError(error)) {
          this.beginRecovery(`session-unavailable:${node.name}`);
          return;
        }
      }
    }

    // YouTube can still return valid metadata/encoded tracks while every
    // client fails later when requesting the actual audio stream. Prefer a
    // matching SoundCloud mirror before another YouTube upload: when YouTube
    // blocks the Lavalink host, every video ID usually fails in the same way.
    // This keeps a source-wide YouTube outage from stopping the entire queue.
    if (!this.alternativeRecoveryAttempted && this.isYouTubeTrack(this.current)) {
      this.alternativeRecoveryAttempted = true;
      const original = this.current;
      const position = Math.max(0, this.player.position || 0);
      for (const node of connectedNodes.sort((a, b) => a.penalties - b.penalties)) {
        try {
          const alternative = await this.resolveAlternativeTrackForNode(original, node.name);
          if (!alternative) continue;

          logger.warn({
            guildId: this.guildId,
            cause,
            originalIdentifier: original.info.identifier,
            alternativeIdentifier: alternative.info.identifier,
            from: this.player.node.name,
            to: node.name,
            source: alternative.info.sourceName,
          }, 'Original YouTube video failed on every node; using a matching cross-source mirror');

          this.player.track = null;
          const ready = this.player.node.name === node.name
            || await this.movePlayer(node.name, `youtube-alternative:${cause}`);
          if (!ready) continue;

          const mirrored: Track = {
            ...alternative,
            pluginInfo: {
              ...(alternative.pluginInfo as Record<string, unknown>),
              youtubeAlternativeFor: original.info.uri || original.info.identifier,
              playbackSource: alternative.info.uri,
            },
          };
          this.current = mirrored;
          this.attemptedNodes = new Set([node.name]);
          this.playbackGeneration++;
          await this.player.playTrack({
            track: { encoded: mirrored.encoded },
            position: Math.min(position, mirrored.info.length || position),
            paused: this.state === 'PAUSED',
            volume: Math.min(100, this.player.volume),
          });
          this.state = this.player.paused ? 'PAUSED' : 'PLAYING';
          this.recoveryReason = alternative.info.sourceName === 'soundcloud'
            ? 'Stream YouTube diblokir; audio dialihkan ke mirror SoundCloud'
            : 'Video asli diblokir YouTube; audio dialihkan ke upload yang cocok';
          this.recoveryAttempt = 0;
          this.retryablePlaybackFailure = null;
          this.scheduleControlPanelRefresh();
          this.changed();
          return;
        } catch (error) {
          logger.warn({ error, guildId: this.guildId, node: node.name }, 'Alternate YouTube recovery failed');
          if (this.isSessionUnavailableError(error)) {
            this.beginRecovery(`session-unavailable:${node.name}`);
            return;
          }
        }
      }
    }

    if (!Array.from(this.client.shoukaku.nodes.values()).some((node) => this.client.isLavalinkNodeHealthy(node.name))) {
      this.beginRecovery(cause);
      return;
    }

    if (this.retryablePlaybackFailure) {
      this.beginRecovery(this.retryablePlaybackFailure);
      return;
    }

    const failedTrack = this.current;
    this.current = null;
    this.attemptedNodes.clear();
    await this.notifyPlaybackFailure(failedTrack);
    this.changed();
    await this.playNext();
  }

  private async movePlayer(nodeName: string, reason: string): Promise<boolean> {
    const from = this.player.node.name;
    const destination = this.client.shoukaku.nodes.get(nodeName);
    if (!destination || !this.client.isLavalinkNodeHealthy(nodeName)) {
      logger.warn({ guildId: this.guildId, from, to: nodeName, reason }, 'Lavalink migration deferred until destination session is ready');
      return false;
    }
    // Shoukaku destroys the old Lavalink player during move(), which emits a
    // normal close (usually code 1000). That close belongs to this migration
    // and must not start a second recovery concurrently.
    this.expectedMigrationCloseUntil = Date.now() + 5000;
    try {
      const moved = await this.player.move(nodeName);
      logger.info({ guildId: this.guildId, from, to: nodeName, reason, moved }, 'Lavalink player move completed');
      return moved;
    } catch (error) {
      logger.warn({ error, guildId: this.guildId, from, to: nodeName, reason }, 'Lavalink player move failed');
      if (!this.client.isLavalinkNodeHealthy(nodeName)) {
        this.expectedMigrationCloseUntil = 0;
        return false;
      }
      try {
        this.player.node = destination;
        await this.player.resume({ position: Math.max(0, this.player.position), volume: Math.min(100, this.player.volume) });
        logger.info({ guildId: this.guildId, from, to: nodeName, reason }, 'Forced Lavalink migration completed without old-node REST');
        return true;
      } catch (resumeError) {
        this.expectedMigrationCloseUntil = 0;
        logger.warn({ error: resumeError, guildId: this.guildId, to: nodeName }, 'Forced Lavalink migration failed');
        return false;
      }
    }
  }

  private async resolveTrackForNode(track: Track, nodeName: string): Promise<Track | null> {
    const search = `${track.info.title} ${track.info.author}`;
    const pluginInfo = track.pluginInfo as Record<string, unknown>;
    const playbackSource = typeof pluginInfo?.playbackSource === 'string'
      ? pluginInfo.playbackSource
      : null;
    const queries = [playbackSource, track.info.uri, `ytmsearch:${search}`, `ytsearch:${search}`]
      .filter((query): query is string => Boolean(query));

    for (const query of queries) {
      const resolved = await this.client.resolveTrack(query, nodeName, false);
      const data = resolved?.result.data;
      if (!data) continue;

      if (Array.isArray(data)) {
        return data[0] || null;
      }

      const playlist = data as { tracks?: Track[] };
      if (playlist.tracks) {
        return playlist.tracks[0] || null;
      }

      return data as Track;
    }

    return null;
  }

  private isYouTubeTrack(track: Track): boolean {
    return track.info.sourceName === 'youtube'
      || /(?:youtube\.com|youtu\.be)/i.test(track.info.uri || '');
  }

  private isYoutubeSourceUnavailable(message: string): boolean {
    return /all clients failed/i.test(message)
      && /(?:requires login|no supported audio streams|sign in|confirm you(?:'|’)re not a bot)/i.test(message);
  }

  private async resolveAlternativeTrackForNode(track: Track, nodeName: string): Promise<Track | null> {
    const cleanTitle = track.info.title
      .normalize('NFKC')
      .replace(/(?:【.*?】|\[.*?\]|\(.*?\)|（.*?）|『.*?』|「.*?」)/gu, ' ')
      .replace(/\b(?:official\s*)?(?:audio|video|lyrics?|lyric video|music video|mv)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const searches = [...new Set([
      cleanTitle,
      `${cleanTitle} ${track.info.author}`.trim(),
      `${track.info.title} ${track.info.author}`.trim(),
    ].filter(Boolean))];
    if (searches.length === 0) return null;

    for (const prefix of ['scsearch:', 'ytmsearch:', 'ytsearch:']) {
      for (const search of searches) {
        const resolved = await this.client.resolveTrack(`${prefix}${search}`, nodeName, false);
        const data = resolved?.result.data;
        if (!data) continue;

        const candidates = Array.isArray(data)
          ? data
          : (data as { tracks?: Track[] }).tracks || [data as Track];
        const alternative = candidates
          .filter((candidate) => (
            candidate.info.identifier !== track.info.identifier
            && !candidate.info.isStream
          ))
          .map((candidate) => ({
            candidate,
            score: this.scoreAlternativeTrack(track, candidate),
          }))
          .filter(({ score }) => score >= 0.45)
          .sort((a, b) => b.score - a.score)[0]?.candidate;
        if (alternative) return alternative;
      }
    }

    return null;
  }

  private scoreAlternativeTrack(original: Track, candidate: Track): number {
    const normalize = (value: string) => value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\b(?:official|audio|video|lyrics?|lyric video|mv|music video|topic)\b/gi, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    const tokens = (value: string) => new Set(normalize(value).split(/\s+/).filter(Boolean));
    const originalTokens = tokens(`${original.info.title} ${original.info.author}`);
    const candidateTokens = tokens(`${candidate.info.title} ${candidate.info.author}`);
    const overlap = [...originalTokens].filter((token) => candidateTokens.has(token)).length;
    const tokenScore = originalTokens.size > 0 ? overlap / originalTokens.size : 0;
    const durationDelta = Math.abs(original.info.length - candidate.info.length);
    const durationScore = original.info.length > 0
      ? Math.max(0, 1 - durationDelta / Math.max(original.info.length, 30_000))
      : 0.5;
    return tokenScore * 0.75 + durationScore * 0.25;
  }

  private async notifyPlaybackFailure(track: Track) {
    await this.textChannel.send({
      embeds: [
        createErrorEmbed(
          `Tidak dapat memutar **${track.info.title}** dari node audio yang tersedia. ` +
          'Track dilewati agar antrean tetap berjalan.',
        ),
      ],
    }).catch((error) => {
      logger.warn({ error, guildId: this.guildId }, 'Failed to send playback failure message');
    });
  }

  private async stopInternal(persist = true) {
    if (this.disposed) return;

    this.tracks = [];
    this.history = [];
    this.current = null;
    this.loop = 'NONE';
    this.queueRevision++;
    this.attemptedNodes.clear();
    this.state = 'IDLE';
    this.recoveryReason = null;
    this.retryablePlaybackFailure = null;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;

    if (this.hasUsablePlayerSession()) {
      await this.player.stopTrack().catch((error) => {
        if (!this.isSessionUnavailableError(error)) {
          logger.warn({ error, guildId: this.guildId }, 'Failed to stop Lavalink player cleanly');
        }
      });
    }
    if (persist) this.changed();
    this.scheduleControlPanelRefresh(0);
  }

  private changed() {
    playbackSessionService.schedule(this);
  }

  private beginRecovery(reason: string) {
    if (this.disposed || this.disconnecting) return;
    this.state = 'RECOVERING';
    this.recoveryReason = reason;
    this.changed();
    this.scheduleControlPanelRefresh(0);
    if (this.recoveryTimer) return;
    const delays = [5000, 10000, 20000, 30000];
    const delay = delays[Math.min(this.recoveryAttempt, delays.length - 1)];
    this.recoveryAttempt++;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (this.current && this.retryablePlaybackFailure) {
        this.attemptedNodes.clear();
        this.alternativeRecoveryAttempted = false;
      }
      this.runDetached(() => this.current
        ? this.recoverPlayback(`retry:${reason}`)
        : this.playNext());
    }, delay);
    logger.warn({ guildId: this.guildId, reason, retryInMs: delay, current: this.current?.info.title }, 'Playback parked until a Lavalink node is available');
  }

  public handleNodeUnavailable(nodeName: string) {
    if (this.disposed || this.disconnecting || this.player.node.name !== nodeName) return;
    this.runDetached(() => this.recoverPlayback(`node-unavailable:${nodeName}`));
  }

  public handleNodeReady(nodeName: string) {
    if (this.disposed || this.state !== 'RECOVERING') return;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.attemptedNodes.delete(nodeName);
    this.runDetached(() => this.current
      ? this.recoverPlayback(`node-ready:${nodeName}`)
      : this.playNext());
  }

  public toSnapshot(): QueueSnapshot | null {
    if (this.disposed || this.disconnecting) return null;
    const voiceChannelId = this.client.shoukaku.connections.get(this.guildId)?.channelId
      || this.client.guilds.cache.get(this.guildId)?.members.me?.voice.channelId;
    if (!voiceChannelId) return null;
    return {
      guildId: this.guildId,
      voiceChannelId,
      textChannelId: this.textChannel.id,
      nodeName: this.player.node.name,
      current: this.current,
      tracks: this.tracks,
      history: this.history,
      loop: this.loop,
      volume: Math.max(0, Math.min(100, this.player.volume)),
      paused: this.player.paused,
      positionMs: Math.max(0, this.player.position || 0),
      filters: { preset: this.currentFilter },
      status: this.state === 'RECOVERING' ? 'RECOVERING' : 'ACTIVE',
    };
  }

  public async restore(snapshot: QueueSnapshot) {
    this.tracks = snapshot.tracks;
    this.history = snapshot.history.slice(-50);
    this.current = snapshot.current;
    this.loop = snapshot.loop;
    this.lastNonZeroVolume = snapshot.volume || 100;
    this.currentFilter = typeof snapshot.filters === 'object' && snapshot.filters
      && 'preset' in snapshot.filters && typeof snapshot.filters.preset === 'string'
      ? snapshot.filters.preset
      : 'none';
    this.queueRevision++;

    if (!this.current) {
      this.state = 'IDLE';
      if (this.hasUsablePlayerSession()) {
        await this.player.setGlobalVolume(snapshot.volume);
      }
      this.changed();
      this.scheduleControlPanelRefresh(0);
      return;
    }

    this.state = snapshot.status === 'RECOVERING' ? 'RECOVERING' : snapshot.paused ? 'PAUSED' : 'PLAYING';
    if (snapshot.nodeName && this.player.node.name !== snapshot.nodeName) {
      await this.movePlayer(snapshot.nodeName, 'session-restore').catch(() => false);
    }
    if (!this.hasUsablePlayerSession()) {
      this.beginRecovery('session-restore:session-unavailable');
      return;
    }
    try {
      await this.player.playTrack({
        track: { encoded: this.current.encoded },
        position: Math.min(snapshot.positionMs, this.current.info.length || snapshot.positionMs),
        paused: snapshot.paused,
        volume: snapshot.volume,
      });
      this.playbackGeneration++;
      this.state = snapshot.paused ? 'PAUSED' : 'PLAYING';
      if (this.currentFilter !== 'none') await this.applyFilter(this.currentFilter);
      this.changed();
      this.scheduleControlPanelRefresh(0);
    } catch (error) {
      logger.warn({ error, guildId: this.guildId }, 'Stored encoded track could not resume; resolving it again');
      this.attemptedNodes.clear();
      await this.recoverPlayback('session-restore');
    }
  }

  public isControlChannel(channelId: string): boolean {
    const voiceChannelId = this.client.shoukaku?.connections.get(this.guildId)?.channelId;
    return channelId === this.textChannel.id || channelId === voiceChannelId;
  }

  public scheduleControlPanelRefresh(delayMs = 500) {
    if (this.disposed) return;
    if (this.panelTimer) clearTimeout(this.panelTimer);
    this.panelTimer = setTimeout(() => {
      this.panelTimer = null;
      this.panelOperation = this.panelOperation
        .then(() => this.refreshControlPanels())
        .catch((error) => logger.warn({ error, guildId: this.guildId }, 'Control panel refresh failed'));
    }, delayMs);
  }

  public async handleControlInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction) {
    // Discord requires component interactions to be acknowledged within roughly
    // three seconds. Do this before any cache miss, REST member fetch, DB call,
    // Lavalink request, or LRCLIB request.
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

    if (!(await this.isListenerInVoice(interaction))) {
      await interaction.followUp({
        content: '❌ Kamu harus berada di voice channel yang sama dengan bot.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const action = interaction.customId;
    if (action === 'music:filter') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('music:filter-select')
        .setPlaceholder('Pilih filter audio')
        .addOptions(
          { label: 'Normal', value: 'none', emoji: '🎚️' },
          { label: 'Bassboost', value: 'bassboost', emoji: '🔊' },
          { label: 'Nightcore', value: 'nightcore', emoji: '⚡' },
          { label: 'Vaporwave', value: 'vaporwave', emoji: '🌊' },
          { label: 'Karaoke', value: 'karaoke', emoji: '🎤' },
        );
      await interaction.followUp({
        content: 'Pilih filter yang ingin diterapkan:',
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      this.setLastAction(interaction.user.id, 'membuka pilihan filter');
      this.scheduleControlPanelRefresh();
      return;
    }

    let label = 'memperbarui kontrol';

    if (action === 'music:queue' && interaction.isStringSelectMenu()) {
      const [revisionValue, indexValue] = interaction.values[0].split(':');
      const revision = Number(revisionValue);
      const index = Number(indexValue);
      if (revision !== this.queueRevision || !Number.isInteger(index) || !(await this.jumpTo(index))) {
        await interaction.followUp({
          content: '⚠️ Antrean sudah berubah. Gunakan panel terbaru.',
          flags: MessageFlags.Ephemeral,
        });
        this.scheduleControlPanelRefresh(0);
        return;
      }
      label = 'memilih lagu dari antrean';
    } else if (action === 'music:resume') {
      await this.setPaused(false);
      label = 'melanjutkan musik';
    } else if (action === 'music:previous') {
      await this.previous();
      label = 'memutar lagu sebelumnya';
    } else if (action === 'music:pause') {
      await this.setPaused(true);
      label = 'menjeda musik';
    } else if (action === 'music:next') {
      await this.skip();
      label = 'melewati lagu';
    } else if (action === 'music:loop') {
      await this.runExclusive(async () => {
        this.loop = this.loop === 'NONE' ? 'TRACK' : this.loop === 'TRACK' ? 'QUEUE' : 'NONE';
        this.changed();
      });
      label = `mengubah loop ke ${this.loop}`;
    } else if (action === 'music:volume-down' || action === 'music:volume-up') {
      const delta = action.endsWith('up') ? 10 : -10;
      const volume = Math.max(0, Math.min(100, this.player.volume + delta));
      await this.setVolume(volume);
      if (volume > 0) this.lastNonZeroVolume = volume;
      label = `mengatur volume ke ${volume}%`;
    } else if (action === 'music:seek-back' || action === 'music:seek-forward') {
      if (this.current?.info.isSeekable && !this.current.info.isStream) {
        const delta = action.endsWith('forward') ? 10000 : -10000;
        const position = Math.max(0, Math.min(this.current.info.length, this.player.position + delta));
        await this.runExclusive(async () => {
          this.requirePlayerSession('menggeser posisi lagu');
          await this.player.seekTo(position);
        });
        this.changed();
        label = `menggeser posisi ke ${formatDuration(position)}`;
      }
    } else if (action === 'music:lyrics' && this.current) {
      const sent = await this.publishLyrics(interaction);
      if (!sent) return;
      label = 'menampilkan lirik';
    } else if (action === 'music:mute') {
      const target = this.player.volume === 0 ? this.lastNonZeroVolume : 0;
      if (this.player.volume > 0) this.lastNonZeroVolume = this.player.volume;
      await this.setVolume(target);
      label = target === 0 ? 'mematikan suara' : `mengembalikan volume ke ${target}%`;
    } else if (action === 'music:shuffle') {
      await this.runExclusive(async () => {
        for (let i = this.tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
        }
        this.queueRevision++;
        this.changed();
      });
      label = 'mengacak antrean';
    } else if (action === 'music:clear') {
      await this.runExclusive(async () => {
        this.tracks = [];
        this.queueRevision++;
        this.changed();
      });
      label = 'membersihkan antrean berikutnya';
    } else if (action === 'music:filter-select' && interaction.isStringSelectMenu()) {
      await this.applyFilter(interaction.values[0]);
      label = `mengaktifkan filter ${interaction.values[0]}`;
    } else if (action === 'music:disconnect') {
      this.setLastAction(interaction.user.id, 'menghentikan musik dan mengeluarkan bot');
      await this.disconnect();
      return;
    }

    this.setLastAction(interaction.user.id, label);
    this.scheduleControlPanelRefresh();
  }

  private async isListenerInVoice(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<boolean> {
    const botChannelId = this.client.shoukaku?.connections.get(this.guildId)?.channelId
      || interaction.guild?.members.me?.voice.channelId;
    if (!botChannelId || !interaction.guild) return false;
    const member = interaction.guild.members.cache.get(interaction.user.id)
      || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    return member?.voice.channelId === botChannelId;
  }

  private async publishLyrics(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<boolean> {
    const now = Date.now();
    const cooldownUntil = this.lyricsCooldowns.get(interaction.user.id) || 0;
    if (cooldownUntil > now) {
      const seconds = Math.max(1, Math.ceil((cooldownUntil - now) / 1000));
      await interaction.followUp({
        content: `⏳ Tunggu ${seconds} detik sebelum meminta lirik lagi.`,
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    const track = this.current;
    if (!track) return false;
    const voiceChannelId = this.client.shoukaku.connections.get(this.guildId)?.channelId
      || interaction.guild?.members.me?.voice.channelId;
    const voiceChannel = voiceChannelId
      ? interaction.guild?.channels.cache.get(voiceChannelId)
        || await interaction.guild?.channels.fetch(voiceChannelId).catch(() => null)
      : null;
    const botMember = interaction.guild?.members.me;
    const permissions = voiceChannel && botMember ? voiceChannel.permissionsFor(botMember) : null;
    if (!voiceChannel?.isSendable()
      || !permissions?.has(PermissionFlagsBits.SendMessages)
      || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
      await interaction.followUp({
        content: '❌ Open chat voice tidak tersedia, atau bot tidak memiliki izin **Send Messages** dan **Embed Links** di sana.',
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }

    this.lyricsCooldowns.set(interaction.user.id, now + 10000);
    try {
      const lyrics = await lyricsService.getLyrics({
        title: track.info.title,
        artist: track.info.author,
        durationMs: track.info.length,
      });
      if (!lyrics) {
        await interaction.followUp({
          content: '🔎 Lirik untuk lagu ini tidak ditemukan di LRCLIB.',
          flags: MessageFlags.Ephemeral,
        });
        return false;
      }

      const body = lyrics.instrumental
        ? '*Track ini ditandai sebagai instrumental; tidak ada lirik vokal.*'
        : lyrics.plainLyrics?.trim() || stripSyncedTimestamps(lyrics.syncedLyrics || '');
      if (!body) {
        await interaction.followUp({
          content: '🔎 LRCLIB menemukan lagunya, tetapi tidak menyediakan teks lirik.',
          flags: MessageFlags.Ephemeral,
        });
        return false;
      }

      const pages = splitLyrics(body);
      for (let index = 0; index < pages.length; index++) {
        const embed = createBaseEmbed()
          .setTitle(`📜 ${lyrics.trackName || track.info.title}`.slice(0, 256))
          .setDescription(pages[index])
          .addFields(
            { name: 'Artis', value: (lyrics.artistName || track.info.author).slice(0, 1024), inline: true },
            { name: 'Diminta oleh', value: `<@${interaction.user.id}>`, inline: true },
          )
          .setFooter({ text: `Sumber: LRCLIB • Halaman ${index + 1}/${pages.length}` });
        await voiceChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      }
      return true;
    } catch (error) {
      logger.warn({ error, guildId: this.guildId, track: track.info.title }, 'Failed to fetch or publish lyrics');
      const message = error instanceof LyricsRateLimitError
        ? `⏳ LRCLIB sedang membatasi permintaan. Coba lagi${error.retryAfterSeconds ? ` dalam ${error.retryAfterSeconds} detik` : ' nanti'}.`
        : error instanceof Error && error.name === 'AbortError'
          ? '⌛ Permintaan lirik melewati batas waktu 5 detik. Silakan coba lagi.'
          : '❌ Gagal mengambil lirik dari LRCLIB. Silakan coba lagi.';
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
      return false;
    }
  }

  private async applyFilter(value: string) {
    await this.runExclusive(async () => {
      this.requirePlayerSession('mengubah filter');
      await this.player.clearFilters();
      this.currentFilter = value;
      if (value === 'bassboost') {
        await this.player.setEqualizer([
          { band: 0, gain: 0.6 }, { band: 1, gain: 0.67 }, { band: 2, gain: 0.67 },
          { band: 3, gain: 0.3 }, { band: 4, gain: 0.1 },
        ]);
      } else if (value === 'nightcore') {
        await this.player.setTimescale({ speed: 1.3, pitch: 1.3, rate: 1 });
      } else if (value === 'vaporwave') {
        await this.player.setTimescale({ speed: 0.85, pitch: 0.8, rate: 1 });
      } else if (value === 'karaoke') {
        await this.player.setKaraoke({ level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 });
      }
      this.changed();
    });
  }

  private setLastAction(userId: string, label: string) {
    this.lastAction = { userId, label, timestamp: Math.floor(Date.now() / 1000) };
  }

  private getControlChannels(): SendableChannels[] {
    const channels = new Map<string, SendableChannels>([[this.textChannel.id, this.textChannel]]);
    const voiceChannelId = this.client.shoukaku?.connections.get(this.guildId)?.channelId;
    const voiceChannel = voiceChannelId
      ? this.client.guilds.cache.get(this.guildId)?.channels.cache.get(voiceChannelId)
      : null;
    if (voiceChannel?.isSendable()) channels.set(voiceChannel.id, voiceChannel);
    return [...channels.values()];
  }

  private async refreshControlPanels() {
    if (this.disposed) return;
    const components = this.buildControlComponents();
    const position = this.current ? Math.max(0, Math.min(this.player.position || 0, this.current.info.length)) : 0;
    const title = this.current?.info.uri
      ? `[${this.current.info.title}](${this.current.info.uri})`
      : this.current?.info.title || '*Tidak ada lagu. Bot tetap berada di voice channel.*';
    const action = this.lastAction
      ? `<@${this.lastAction.userId}> ${this.lastAction.label} • <t:${this.lastAction.timestamp}:R>`
      : 'Belum ada aksi kontrol.';
    const voiceChannelId = this.client.shoukaku.connections.get(this.guildId)?.channelId;
    const voiceChannel = voiceChannelId
      ? this.client.guilds.cache.get(this.guildId)?.channels.cache.get(voiceChannelId)
      : null;
    const bitrate = voiceChannel?.isVoiceBased() ? Math.round(voiceChannel.bitrate / 1000) : null;
    const source = this.current
      ? (this.current.pluginInfo as Record<string, unknown>)?.spotifyMirror ? 'Spotify metadata → YouTube mirror' : this.current.info.sourceName
      : '-';
    const quality = bitrate ? `${bitrate} kbps${bitrate < 96 ? ' ⚠️ rendah' : ''}` : 'Tidak diketahui';
    const progress = this.current
      ? `\`${formatDuration(position)}\` ${createProgressBar(position, this.current.info.length, 15)} \`${formatDuration(this.current.info.length)}\``
      : '';
    const embed = createBaseEmbed()
      .setTitle('🎶 Now Playing & Music Controls')
      .setDescription(`**${title}**${this.current ? `\n👤 ${this.current.info.author}\n${progress}` : ''}`)
      .addFields(
        { name: 'Status', value: this.state, inline: true },
        { name: 'Node', value: this.player.node.name, inline: true },
        { name: 'Sumber audio', value: String(source), inline: true },
        { name: 'Antrean', value: `${this.tracks.length} lagu`, inline: true },
        { name: 'Volume', value: `${this.player.volume}%`, inline: true },
        { name: 'Loop', value: this.loop, inline: true },
        { name: 'Bitrate voice', value: quality, inline: true },
        ...(this.recoveryReason ? [{ name: 'Recovery', value: this.recoveryReason.slice(0, 1024) }] : []),
        { name: 'Aksi terakhir', value: action },
      )
      .setThumbnail(this.current?.info.artworkUrl || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=256&h=256')
      .setFooter({ text: '▶ Resume • ⏮ Previous • ⏸ Pause • ⏭ Next • 🔁 Loop • gunakan tombol lain untuk volume, seek, queue, filter, dan disconnect' });

    const targets = this.getControlChannels();
    const targetIds = new Set(targets.map((channel) => channel.id));
    for (const [channelId, oldMessage] of [...this.controlMessages]) {
      if (!targetIds.has(channelId)) {
        await oldMessage.delete().catch(() => null);
        this.controlMessages.delete(channelId);
      }
    }

    for (const channel of targets) {
      const oldMessage = this.controlMessages.get(channel.id);
      try {
        const newMessage = await channel.send({ embeds: [embed], components, allowedMentions: { parse: [] } });
        this.controlMessages.set(channel.id, newMessage);
        if (oldMessage && oldMessage.id !== newMessage.id) await oldMessage.delete().catch(() => null);
      } catch (error) {
        logger.warn({ error, guildId: this.guildId, channelId: channel.id }, 'Cannot publish music control panel');
      }
    }
  }

  private buildControlComponents() {
    const hasCurrent = Boolean(this.current);
    const seekDisabled = !this.current?.info.isSeekable || Boolean(this.current?.info.isStream);
    const queueSelect = new StringSelectMenuBuilder()
      .setCustomId('music:queue')
      .setPlaceholder(this.tracks.length ? `Pilih lagu antrean (${this.tracks.length})` : 'Antrean kosong')
      .setDisabled(this.tracks.length === 0);
    const options = this.tracks.slice(0, 25).map((track, index) => new StringSelectMenuOptionBuilder()
      .setLabel(track.info.title.slice(0, 100))
      .setDescription(`${track.info.author} • ${formatDuration(track.info.length)}`.slice(0, 100))
      .setValue(`${this.queueRevision}:${index}`));
    queueSelect.addOptions(options.length ? options : [{ label: 'Antrean kosong', value: `${this.queueRevision}:-1` }]);

    const button = (id: string, emoji: string, disabled = false, style = ButtonStyle.Secondary) =>
      new ButtonBuilder().setCustomId(`music:${id}`).setEmoji(emoji).setStyle(style).setDisabled(disabled);

    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(queueSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('resume', '▶️', !hasCurrent || !this.player.paused),
        button('previous', '⏮️', this.history.length === 0),
        button('pause', '⏸️', !hasCurrent || this.player.paused),
        button('next', '⏭️', this.tracks.length === 0),
        button('loop', '🔁', !hasCurrent, this.loop === 'NONE' ? ButtonStyle.Secondary : ButtonStyle.Primary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('volume-down', '🔉', this.player.volume <= 0),
        button('seek-back', '⏪', seekDisabled),
        button('lyrics', '📜', !hasCurrent),
        button('seek-forward', '⏩', seekDisabled),
        button('volume-up', '🔊', this.player.volume >= 100),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('mute', this.player.volume === 0 ? '🔇' : '🔈'),
        button('shuffle', '🔀', this.tracks.length < 2),
        button('clear', '🗑️', this.tracks.length === 0),
        button('filter', '🎚️', !hasCurrent),
        button('disconnect', '⏹️', false, ButtonStyle.Danger),
      ),
    ];
  }

  private async deleteControlPanels() {
    if (this.panelTimer) clearTimeout(this.panelTimer);
    this.panelTimer = null;
    const messages = [...this.controlMessages.values()];
    this.controlMessages.clear();
    await Promise.all(messages.map((message) => message.delete().catch(() => null)));
  }
}
