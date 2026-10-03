import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { Command } from './Command';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { Shoukaku, Connectors, type NodeOption } from 'shoukaku';
import { Queue } from './Queue';
import { playbackSessionService } from '../services/PlaybackSessionService';

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
    const customHost = process.env.LAVALINK_HOST;
    const customPort = process.env.LAVALINK_PORT || '2333';
    const rawCustomUrl = process.env.LAVALINK_URL?.trim() || (customHost ? `${customHost.trim()}:${customPort}` : null);
    const customSecure = process.env.LAVALINK_SECURE?.trim().toLowerCase() === 'true'
      || Boolean(rawCustomUrl && /^(?:https|wss):\/\//i.test(rawCustomUrl))
      || Boolean(rawCustomUrl && /:443\/?$/i.test(rawCustomUrl));
    const customUrl = rawCustomUrl
      ?.replace(/^(?:https?|wss?):\/\//i, '')
      .replace(/\/+$/, '');
    const customAuth = process.env.LAVALINK_PASSWORD?.trim() || 'youshallnotpass';
    const reconnectTries = readIntegerEnv('LAVALINK_RECONNECT_TRIES', 12, 1, 1000);
    const reconnectIntervalSeconds = readIntegerEnv('LAVALINK_RECONNECT_INTERVAL_SECONDS', 5, 1, 300);
    const customNodeName = 'Node-1 (Custom/Local)';
    // Private-only is the safe default and also protects deployments where a
    // hosting panel still injects an old LAVALINK_USE_PUBLIC_NODES=true value.
    const privateOnly = process.env.LAVALINK_PRIVATE_ONLY?.trim().toLowerCase() !== 'false';
    const publicNodesRequested = process.env.LAVALINK_USE_PUBLIC_NODES?.trim().toLowerCase() === 'true';
    const usePublicNodes = !privateOnly && publicNodesRequested;

    // Multi-Node Cluster Configuration (Auto Load Balancing & Failover)
    const nodes = [];

    // Prioritaskan node milik sendiri. Node publik hanya berfungsi sebagai cadangan.
    if (customUrl && !customUrl.includes('jirayu.net')) {
      nodes.push({
        name: customNodeName,
        url: customUrl,
        auth: customAuth,
        secure: customSecure,
      });
    }

    if (usePublicNodes) {
      nodes.push(
        {
          name: 'Node-2 (MilloHost-ID)',
          url: 'lava-v4.millohost.my.id:443',
          auth: 'https://discord.gg/mjS5J2K3ep',
          secure: true,
        },
        {
          name: 'Node-3 (Serenetia-Global)',
          url: 'lavalinkv4.serenetia.com:443',
          auth: 'https://seretia.link/discord',
          secure: true,
        },
      );
    }

    if (nodes.length === 0) {
      throw new Error('Tidak ada Lavalink node yang dikonfigurasi. Isi LAVALINK_URL untuk menggunakan Lavalink pribadi.');
    }

    for (const node of nodes) this.lavalinkNodeConfigs.set(node.name, { ...node });

    logger.info({
      customNodeConfigured: Boolean(customUrl),
      privateOnly,
      publicFallbackEnabled: usePublicNodes,
      authenticationConfigured: customAuth.length > 0,
      reconnectTries,
      reconnectIntervalSeconds,
      configuredNodes: nodes.map((node) => node.name),
    }, usePublicNodes
      ? 'Lavalink pribadi diprioritaskan dengan fallback node publik'
      : 'Mode Lavalink pribadi saja aktif');

    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(this), nodes, {
      moveOnDisconnect: false,
      resume: true,
      resumeByLibrary: true,
      resumeTimeout: 30000,
      reconnectTries,
      // Shoukaku expects seconds here, not milliseconds.
      reconnectInterval: reconnectIntervalSeconds,
      restTimeout: 10000,
      nodeResolver: (availableNodes) => {
        const connected = Array.from(availableNodes.values())
          .filter((node) => (
            node.state === 1
            && Boolean(node.sessionId)
            && !this.unhealthyLavalinkNodes.has(node.name)
          ));
        return connected.find((node) => node.name === customNodeName)
          || connected.sort((a, b) => a.penalties - b.penalties)[0];
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

      if (name === customNodeName && !plugins.some((plugin) => plugin.startsWith('lavasrc-plugin:'))) {
        logger.warn(
          { node: name, plugins },
          'Node Lavalink custom tidak memuat LavaSrc; URL Spotify tidak dapat di-resolve pada node ini',
        );
      }
    });
    this.shoukaku.on('error', (name, error) => {
      this.unhealthyLavalinkNodes.add(name);
      const authenticationRejected = /(?:401|403|unauthori[sz]ed|authentication)/i.test(error.message);
      logger.warn({ node: name, error: error.message, authenticationRejected }, authenticationRejected
        ? 'Autentikasi Lavalink ditolak; samakan LAVALINK_PASSWORD bot dengan LAVALINK_SERVER_PASSWORD pada server Lavalink'
        : 'Lavalink node ditandai unhealthy');
      for (const queue of this.queues.values()) queue.handleNodeUnavailable(name);
      this.scheduleNodeReconnect(name);
    });
    this.shoukaku.on('reconnecting', (name, reconnectsLeft, intervalSeconds) => {
      logger.warn({ node: name, reconnectsLeft, intervalSeconds }, 'Mencoba menyambungkan ulang node Lavalink');
    });
    this.shoukaku.on('close', (name, code, reason) => {
      this.unhealthyLavalinkNodes.add(name);
      logger.warn(`Lavalink Cluster: Node [${name}] terputus (Code: ${code}, Reason: ${reason || 'None'}). Pemulihan otomatis dimulai.`);
      for (const queue of this.queues.values()) queue.handleNodeUnavailable(name);
      this.scheduleNodeReconnect(name);
    });
    this.shoukaku.on('disconnect', (name, movedPlayers) => {
      this.unhealthyLavalinkNodes.add(name);
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

  public hasReadyLavalinkNode(): boolean {
    return Array.from(this.shoukaku.nodes.values())
      .some((node) => this.isLavalinkNodeHealthy(node.name));
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

    const idealNode = this.shoukaku.getIdealNode();
    let connectedNodes = Array.from(this.shoukaku.nodes.values())
      .filter((node) => this.isLavalinkNodeHealthy(node.name))
      .sort((a, b) => {
        if (a.name === preferredNodeName) return -1;
        if (b.name === preferredNodeName) return 1;
        if (a.name === idealNode?.name) return -1;
        if (b.name === idealNode?.name) return 1;
        return a.penalties - b.penalties;
      });

    if (preferredNodeName && !allowFallback) {
      connectedNodes = connectedNodes.filter((node) => node.name === preferredNodeName);
    }

    for (const node of connectedNodes) {
      try {
        const res = await node.rest.resolve(query);
        if (res && res.loadType !== 'empty' && res.loadType !== 'error') {
          return { result: res, node };
        }
      } catch (error) {
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
