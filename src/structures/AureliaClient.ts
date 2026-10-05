import { Client, Collection, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { Command } from './Command';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import {
  Shoukaku,
  Connectors,
  type NodeOption,
  type Player,
  type Track,
  type VoiceChannelOptions,
} from 'shoukaku';
import { Queue } from './Queue';
import { playbackSessionService } from '../services/PlaybackSessionService';
import { LavalinkNodeRanker, lavalinkSource } from './LavalinkNodeRanker';
import { PUBLIC_LAVALINK_NODES } from '../config/lavalinkNodes';

export class AureliaClient extends Client {
  public commands: Collection<string, Command> = new Collection();
  public queues: Collection<string, Queue> = new Collection();
  public shoukaku!: Shoukaku;
  private readonly unhealthyLavalinkNodes = new Set<string>();
  private discordReady = false;
  private restorationStarted = false;
  private readonly nodeReconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly lavalinkNodeConfigs = new Map<string, NodeOption>();
  private readonly nodeReconnectCycles = new Map<string, number>();
  private readonly nodeRanker = new LavalinkNodeRanker();
  private readonly voiceJoinOperations = new Map<string, Promise<Player>>();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  public async start(token: string) {
    this.initShoukaku();
    this.loadEvents();
    this.loadCommands();
    await this.login(token);
  }

  private initShoukaku() {
    const reconnectTries = readIntegerEnv('LAVALINK_RECONNECT_TRIES', 12, 1, 1000);
    const reconnectIntervalSeconds = readIntegerEnv('LAVALINK_RECONNECT_INTERVAL_SECONDS', 5, 1, 300);
    const restTimeoutSeconds = readIntegerEnv('LAVALINK_REST_TIMEOUT_SECONDS', 12, 3, 60);
    // Ignore legacy LAVALINK_URL/PASSWORD/PRIVATE_ONLY values injected by old
    // hosting panels. This bot intentionally never registers a private node.
    const nodes = PUBLIC_LAVALINK_NODES.map((node) => ({ ...node }));

    for (const node of nodes) this.lavalinkNodeConfigs.set(node.name, { ...node });

    logger.info({
      mode: 'public-only',
      reconnectTries,
      reconnectIntervalSeconds,
      restTimeoutSeconds,
      configuredNodes: nodes.map((node) => node.name),
    }, 'Mode Lavalink publik saja aktif');

    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(this), nodes, {
      moveOnDisconnect: false,
      resume: true,
      resumeByLibrary: true,
      resumeTimeout: 30000,
      reconnectTries,
      // Shoukaku expects seconds here, not milliseconds.
      reconnectInterval: reconnectIntervalSeconds,
      // Shoukaku multiplies this value by 1000 internally: it is seconds.
      restTimeout: restTimeoutSeconds,
      nodeResolver: (availableNodes) => {
        const connected = Array.from(availableNodes.values())
          .filter((node) => (
            node.state === 1
            && Boolean(node.sessionId)
            && !this.unhealthyLavalinkNodes.has(node.name)
          ));
        return connected.sort((a, b) => this.compareLavalinkNodes(a, b))[0];
      },
    });

    this.shoukaku.on('ready', async (name) => {
      this.clearNodeReconnect(name);
      this.nodeReconnectCycles.delete(name);
      this.unhealthyLavalinkNodes.delete(name);
      const node = this.shoukaku.nodes.get(name);
      const info = node ? await node.rest.getLavalinkInfo().catch((error) => {
        logger.warn({ error, node: name }, 'Tidak dapat mengambil /v4/info dari Lavalink');
        return undefined;
      }) : undefined;
      if (node && info) node.info = info;
      const plugins = info?.plugins.map((plugin) => `${plugin.name}:${plugin.version}`) || [];
      const sources = info?.sourceManagers || [];
      logger.info(
        { node: name, version: info?.version.semver, plugins, sources },
        'Lavalink node siap dan terhubung',
      );

      for (const queue of this.queues.values()) queue.handleNodeReady(name);
      void this.tryRestorePlaybackSessions();

    });
    this.shoukaku.on('error', (name, error) => {
      this.unhealthyLavalinkNodes.add(name);
      this.nodeRanker.failure(name, '*');
      const authenticationRejected = /(?:401|403|unauthori[sz]ed|authentication)/i.test(error.message);
      logger.warn({ node: name, error: error.message, authenticationRejected }, authenticationRejected
        ? 'Autentikasi node Lavalink publik ditolak; konfigurasi akses operator mungkin berubah'
        : 'Lavalink node ditandai unhealthy');
      for (const queue of this.queues.values()) queue.handleNodeUnavailable(name);
      this.scheduleNodeReconnect(name);
    });
    this.shoukaku.on('reconnecting', (name, reconnectsLeft, intervalSeconds) => {
      logger.warn({ node: name, reconnectsLeft, intervalSeconds }, 'Mencoba menyambungkan ulang node Lavalink');
    });
    this.shoukaku.on('close', (name, code, reason) => {
      this.unhealthyLavalinkNodes.add(name);
      this.nodeRanker.failure(name, '*');
      logger.warn(`Lavalink Cluster: Node [${name}] terputus (Code: ${code}, Reason: ${reason || 'None'}). Pemulihan otomatis dimulai.`);
      for (const queue of this.queues.values()) queue.handleNodeUnavailable(name);
      this.scheduleNodeReconnect(name);
    });
    this.shoukaku.on('disconnect', (name, movedPlayers) => {
      this.unhealthyLavalinkNodes.add(name);
      this.nodeRanker.failure(name, '*');
      logger.warn({ node: name, movedPlayers }, 'Siklus rekoneksi Lavalink habis; retry jangka panjang dijadwalkan');
      for (const queue of this.queues.values()) queue.handleNodeUnavailable(name);
      this.scheduleNodeReconnect(name);
    });
  }

  private clearNodeReconnect(name: string) {
    const timer = this.nodeReconnectTimers.get(name);
    if (timer) clearTimeout(timer);
    this.nodeReconnectTimers.delete(name);
  }

  private scheduleNodeReconnect(name: string) {
    if (this.nodeReconnectTimers.has(name)) return;
    const delayMs = readIntegerEnv('LAVALINK_RECONNECT_CYCLE_DELAY_MS', 30000, 5000, 3600000);
    const timer = setTimeout(() => {
      this.nodeReconnectTimers.delete(name);
      void this.runNodeReconnectCycle(name);
    }, delayMs);
    this.nodeReconnectTimers.set(name, timer);
    logger.warn({ node: name, retryInMs: delayMs }, 'Watchdog menjadwalkan siklus rekoneksi Lavalink tanpa batas');
  }

  private async runNodeReconnectCycle(name: string) {
    const existing = this.shoukaku.nodes.get(name);
    if (existing?.state === 1 && existing.sessionId) {
      this.clearNodeReconnect(name);
      return;
    }

    // Shoukaku sets CONNECTED immediately before assigning the session id from
    // Lavalink's ready payload. Do not start a competing websocket during that
    // short window; keep the watchdog alive until REST requests are safe.
    if (existing?.state === 1 && !existing.sessionId) {
      this.scheduleNodeReconnect(name);
      return;
    }

    // A node that is already CONNECTING/DISCONNECTING owns its current retry
    // cycle. Poll it again later instead of creating a competing websocket.
    if (existing && existing.state !== 3) {
      this.scheduleNodeReconnect(name);
      return;
    }

    const cycle = (this.nodeReconnectCycles.get(name) || 0) + 1;
    this.nodeReconnectCycles.set(name, cycle);
    try {
      if (existing) {
        logger.warn({ node: name, cycle }, 'Watchdog memulai ulang koneksi node Lavalink');
        await existing.connect();
      } else {
        const config = this.lavalinkNodeConfigs.get(name);
        if (!config) {
          logger.error({ node: name }, 'Konfigurasi node Lavalink tidak ditemukan; watchdog tidak dapat membuat ulang node');
          return;
        }
        // Shoukaku 4.3 removes a Node from its map after its finite internal
        // retries are exhausted. Re-adding it starts a fresh finite cycle; the
        // watchdog will repeat this forever until a ready event is received.
        logger.warn({ node: name, cycle }, 'Watchdog membuat ulang node Lavalink yang telah dihapus Shoukaku');
        this.shoukaku.addNode({ ...config });
      }
    } catch (error) {
      logger.warn({ error, node: name, cycle }, 'Siklus rekoneksi Lavalink watchdog gagal');
    } finally {
      if (!this.isLavalinkNodeHealthy(name)) this.scheduleNodeReconnect(name);
    }
  }

  public markDiscordReady() {
    this.discordReady = true;
    void this.tryRestorePlaybackSessions();
  }

  public isLavalinkNodeHealthy(name: string): boolean {
    const node = this.shoukaku.nodes.get(name);
    return Boolean(
      node
      && node.state === 1
      && node.sessionId
      && !this.unhealthyLavalinkNodes.has(name),
    );
  }

  public compareLavalinkNodes(
    a: { name: string; penalties: number },
    b: { name: string; penalties: number },
    source = '*',
    preferredNodeName?: string,
  ): number {
    const score = (node: { name: string; penalties: number }) => {
      const config = this.lavalinkNodeConfigs.get(node.name);
      const sources = this.shoukaku?.nodes.get(node.name)?.info?.sourceManagers;
      return this.nodeRanker.score({
        name: node.name,
        penalties: node.penalties,
        secure: config?.secure,
        sources,
        preference: Math.max(0, Array.from(this.lavalinkNodeConfigs.keys()).indexOf(node.name)) * 20,
      }, source) - (node.name === preferredNodeName ? 8 : 0);
    };
    return score(a) - score(b) || a.name.localeCompare(b.name);
  }

  public recordLavalinkPlaybackFailure(name: string, source: string): void {
    this.nodeRanker.failure(name, source);
  }

  public recordLavalinkPlaybackSuccess(name: string, source: string): void {
    this.nodeRanker.success(name, source);
  }

  public hasReadyLavalinkNode(): boolean {
    return Array.from(this.shoukaku.nodes.values())
      .some((node) => this.isLavalinkNodeHealthy(node.name));
  }

  /**
   * Joins Discord voice without letting an orphaned Shoukaku connection block
   * the guild forever. Every caller for the same guild shares one operation,
   * so simultaneous message/slash requests cannot create duplicate players.
   */
  public async joinVoiceChannelSafely(options: VoiceChannelOptions): Promise<Player> {
    const pending = this.voiceJoinOperations.get(options.guildId);
    if (pending) return pending;

    const operation = this.performVoiceJoin(options);
    this.voiceJoinOperations.set(options.guildId, operation);
    try {
      return await operation;
    } finally {
      if (this.voiceJoinOperations.get(options.guildId) === operation) {
        this.voiceJoinOperations.delete(options.guildId);
      }
    }
  }

  /** Returns a useful Discord-facing explanation instead of blaming every failure on permissions. */
  public voiceJoinErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/(?:missing permissions|missing access|50013|forbidden|connect permission|speak permission)/i.test(message)) {
      return 'Bot tidak memiliki izin **Connect** dan/atau **Speak** pada voice channel tersebut. Periksa override izin channel, bukan hanya role server.';
    }
    if (/(?:channel is full|user limit|voice channel full)/i.test(message)) {
      return 'Voice channel sudah penuh dan bot tidak dapat bergabung.';
    }
    if (/(?:voice channel is unavailable|unknown channel|10003)/i.test(message)) {
      return 'Voice channel tujuan tidak lagi tersedia atau tidak terlihat oleh bot.';
    }
    if (/(?:existing connection|session|endpoint|voice connection|not established|timed? ?out|closed)/i.test(message)) {
      return 'Koneksi voice Discord sebelumnya tidak selesai dengan benar. State lama sudah dibersihkan, tetapi handshake ulang masih gagal; coba kirim request sekali lagi.';
    }
    return 'Gagal bergabung ke voice channel karena koneksi Discord voice gagal. Alasan teknis lengkap sudah dicatat di console bot.';
  }

  private async performVoiceJoin(options: VoiceChannelOptions): Promise<Player> {
    const guild = this.guilds.cache.get(options.guildId);
    const targetChannel = guild
      ? guild.channels.cache.get(options.channelId)
        || await guild.channels.fetch(options.channelId).catch(() => null)
      : null;
    if (guild && !targetChannel?.isVoiceBased()) {
      throw new Error('Voice channel is unavailable');
    }
    if (guild?.members.me && targetChannel?.isVoiceBased()) {
      const permissions = targetChannel.permissionsFor(guild.members.me);
      if (!permissions.has(PermissionFlagsBits.Connect)) {
        throw new Error('Missing Connect permission');
      }
      if (!permissions.has(PermissionFlagsBits.Speak)) {
        throw new Error('Missing Speak permission');
      }
    }

    const existingConnection = this.shoukaku.connections.get(options.guildId);
    const existingPlayer = this.shoukaku.players.get(options.guildId);
    const botVoiceChannelId = this.guilds.cache.get(options.guildId)?.members.me?.voice.channelId;
    const existingNodeName = existingPlayer?.node.name;
    const connectionIsReady = Boolean(
      existingConnection
      && existingPlayer
      && existingConnection.channelId === options.channelId
      && (!botVoiceChannelId || botVoiceChannelId === options.channelId)
      && existingConnection.state === 1
      && existingConnection.sessionId
      && existingConnection.serverUpdate
      && existingNodeName
      && this.isLavalinkNodeHealthy(existingNodeName),
    );

    if (connectionIsReady && existingPlayer) {
      logger.info({
        guildId: options.guildId,
        channelId: options.channelId,
        node: existingNodeName,
      }, 'Menggunakan kembali koneksi voice yang masih sehat');
      return existingPlayer;
    }

    if (existingConnection || existingPlayer) {
      logger.warn({
        guildId: options.guildId,
        requestedChannelId: options.channelId,
        discordChannelId: botVoiceChannelId,
        connectionChannelId: existingConnection?.channelId,
        connectionState: existingConnection?.state,
        hasVoiceSession: Boolean(existingConnection?.sessionId),
        hasVoiceServerUpdate: Boolean(existingConnection?.serverUpdate),
        hasPlayer: Boolean(existingPlayer),
        node: existingNodeName,
      }, 'Membersihkan koneksi voice Shoukaku yang basi atau tidak lengkap');
      await this.shoukaku.leaveVoiceChannel(options.guildId).catch((error) => {
        logger.debug({ error, guildId: options.guildId }, 'Pembersihan koneksi voice lama mengembalikan error yang aman diabaikan');
      });
    }

    try {
      return await this.shoukaku.joinVoiceChannel(options);
    } catch (firstError) {
      if (!isRetryableVoiceJoinError(firstError)) {
        logger.error({
          error: firstError,
          guildId: options.guildId,
          channelId: options.channelId,
          discordChannelId: botVoiceChannelId,
        }, 'Discord voice join gagal');
        throw firstError;
      }

      logger.warn({
        error: firstError,
        guildId: options.guildId,
        channelId: options.channelId,
      }, 'Voice join pertama gagal karena state/handshake; membersihkan state dan mencoba sekali lagi');
      await this.shoukaku.leaveVoiceChannel(options.guildId).catch(() => undefined);

      try {
        return await this.shoukaku.joinVoiceChannel(options);
      } catch (retryError) {
        logger.error({
          error: retryError,
          firstError,
          guildId: options.guildId,
          channelId: options.channelId,
          discordChannelId: this.guilds.cache.get(options.guildId)?.members.me?.voice.channelId,
        }, 'Discord voice join tetap gagal setelah pembersihan state dan retry');
        throw retryError;
      }
    }
  }

  private async tryRestorePlaybackSessions() {
    if (this.restorationStarted || !this.discordReady || process.env.PLAYBACK_RECOVERY_ENABLED === 'false') return;
    if (!this.hasReadyLavalinkNode()) return;
    this.restorationStarted = true;
    await playbackSessionService.restoreAll(this).catch((error) => {
      logger.error({ error }, 'Playback session restoration failed');
      this.restorationStarted = false;
    });
  }

  /**
   * Resolves a track query using the ideal node with automatic failover across all connected cluster nodes.
   */
  public async resolveTrack(query: string, preferredNodeName?: string, allowFallback = true) {
    if (!this.shoukaku?.nodes) return null;

    const source = lavalinkSource(query);
    let connectedNodes = Array.from(this.shoukaku.nodes.values())
      .filter((node) => this.isLavalinkNodeHealthy(node.name))
      .sort((a, b) => this.compareLavalinkNodes(a, b, source, preferredNodeName));

    if (preferredNodeName && !allowFallback) {
      connectedNodes = connectedNodes.filter((node) => node.name === preferredNodeName);
    }

    for (const node of connectedNodes) {
      const startedAt = Date.now();
      try {
        const res = await node.rest.resolve(query);
        this.nodeRanker.resolveLatency(node.name, Date.now() - startedAt);
        if (res && res.loadType !== 'empty' && res.loadType !== 'error') {
          const tag = (track: Track): Track => ({
            ...track,
            pluginInfo: {
              ...(track.pluginInfo && typeof track.pluginInfo === 'object' ? track.pluginInfo : {}),
              encodedNode: node.name,
            },
          });
          if (res.loadType === 'track') return { result: { ...res, data: tag(res.data) }, node };
          if (res.loadType === 'search') return { result: { ...res, data: res.data.map(tag) }, node };
          return { result: { ...res, data: { ...res.data, tracks: res.data.tracks.map(tag) } }, node };
        }
        if (res?.loadType === 'error') this.nodeRanker.failure(node.name, source);
      } catch (error) {
        this.nodeRanker.failure(node.name, source);
        logger.warn({ error, node: node.name, query }, 'Resolve gagal; mencoba node Lavalink berikutnya');
      }
    }

    return null;
  }

  private loadCommands() {
    const commandsPath = path.join(__dirname, '..', 'commands');
    const commandFolders = fs.readdirSync(commandsPath);

    for (const folder of commandFolders) {
      const folderPath = path.join(commandsPath, folder);
      if (!fs.statSync(folderPath).isDirectory()) continue;

      const commandFiles = fs.readdirSync(folderPath).filter(
        (file) => file.endsWith('.ts') || file.endsWith('.js'),
      );

      for (const file of commandFiles) {
        const filePath = path.join(folderPath, file);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const commandModule = require(filePath);
        const command: Command = commandModule.default || commandModule;

        if (command && 'data' in command && 'execute' in command) {
          this.commands.set(command.data.name, command);
          logger.info(`Loaded command: ${command.data.name}`);
        } else {
          logger.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
      }
    }
  }

  private loadEvents() {
    const eventsPath = path.join(__dirname, '..', 'events');
    const eventFiles = fs.readdirSync(eventsPath).filter(
      (file) => file.endsWith('.ts') || file.endsWith('.js'),
    );

    for (const file of eventFiles) {
      const filePath = path.join(eventsPath, file);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const eventModule = require(filePath);
      const event = eventModule.default || eventModule;

      if (event && event.name) {
        if (event.once) {
          this.once(event.name, (...args) => event.execute(...args, this));
        } else {
          this.on(event.name, (...args) => event.execute(...args, this));
        }
        logger.info(`Loaded event: ${event.name}`);
      }
    }
  }
}

function readIntegerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function isRetryableVoiceJoinError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:existing connection|session|endpoint|voice connection|not established|timed? ?out|disconnected|closed)/i.test(message);
}
