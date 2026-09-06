import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { Command } from './Command';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import { Shoukaku, Connectors } from 'shoukaku';
import { Queue } from './Queue';

export class AureliaClient extends Client {
  public commands: Collection<string, Command> = new Collection();
  public queues: Collection<string, Queue> = new Collection();
  public shoukaku!: Shoukaku;

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
    const customUrl = process.env.LAVALINK_URL || (customHost ? `${customHost}:${customPort}` : null);
    const customAuth = process.env.LAVALINK_PASSWORD || 'youshallnotpass';
    const customSecure = customPort === '443' || process.env.LAVALINK_SECURE === 'true';

    // Multi-Node Cluster Configuration (Auto Load Balancing & Failover)
    const nodes = [
      {
        name: 'Node-1 (MilloHost-ID)',
        url: 'lava-v4.millohost.my.id:443',
        auth: 'https://discord.gg/mjS5J2K3ep',
        secure: true,
      },
      {
        name: 'Node-2 (Serenetia-Global)',
        url: 'lavalinkv4.serenetia.com:443',
        auth: 'https://seretia.link/discord',
        secure: true,
      },
    ];

    // Tambahkan custom node dari .env jika dikonfigurasi (misal docker lokal atau VPS pribadi)
    if (customUrl && !customUrl.includes('jirayu.net')) {
      nodes.push({
        name: 'Node-3 (Custom/Local)',
        url: customUrl,
        auth: customAuth,
        secure: customSecure,
      });
    }

    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(this), nodes, {
      moveOnDisconnect: true,
      resume: true,
      resumeByLibrary: true,
      resumeTimeout: 30000,
      reconnectTries: 5,
      reconnectInterval: 5000,
      restTimeout: 10000,
    });

    this.shoukaku.on('ready', (name) => logger.info(`Lavalink Cluster: Node [${name}] siap & terhubung!`));
    this.shoukaku.on('error', (name, error) => logger.warn(`Lavalink Cluster: Node [${name}] galat: ${error.message}`));
    this.shoukaku.on('close', (name, code, reason) => logger.warn(`Lavalink Cluster: Node [${name}] terputus (Code: ${code}, Reason: ${reason || 'None'}). Otomatis failover ke node lain.`));
    this.shoukaku.on('disconnect', (name, count) => logger.warn(`Lavalink Cluster: Node [${name}] terputus sementara. Mencoba rekoneksi (Percobaan ke-${count}).`));
  }

  /**
   * Resolves a track query using the ideal node with automatic failover across all connected cluster nodes.
   */
  public async resolveTrack(query: string) {
    if (!this.shoukaku?.nodes) return null;

    const idealNode = this.shoukaku.getIdealNode();
    if (idealNode) {
      try {
        const res = await idealNode.rest.resolve(query);
        if (res && res.loadType !== 'empty' && res.loadType !== 'error') {
          return { result: res, node: idealNode };
        }
      } catch {
        logger.warn(`Resolve gagal pada node [${idealNode.name}], mengalihkan ke node cadangan...`);
      }
    }

    // Failover ke node lain yang berstatus connected (state === 1)
    for (const node of this.shoukaku.nodes.values()) {
      if (node.name === idealNode?.name || node.state !== 1) continue;
      try {
        const res = await node.rest.resolve(query);
        if (res && res.loadType !== 'empty' && res.loadType !== 'error') {
          return { result: res, node };
        }
      } catch {
        /* ignore */
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
