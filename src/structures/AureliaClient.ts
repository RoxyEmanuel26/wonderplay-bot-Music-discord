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
    const lavaHost = process.env.LAVALINK_HOST || 'localhost';
    const lavaPort = process.env.LAVALINK_PORT || '2333';
    const lavaUrl = process.env.LAVALINK_URL || `${lavaHost}:${lavaPort}`;

    const nodes = [
      {
        name: 'LocalNode',
        url: lavaUrl,
        auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
        secure: lavaPort === '443' || process.env.LAVALINK_SECURE === 'true',
      },
    ];

    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(this), nodes, {
      resume: true,
      resumeTimeout: 30000,
      reconnectTries: 5,
    });

    this.shoukaku.on('ready', (name) => logger.info(`Lavalink Node: ${name} is now connected`));
    this.shoukaku.on('error', (name, error) => logger.warn(`Lavalink Node: ${name} gagal tersambung atau error: ${error.message}`));
    this.shoukaku.on('close', (name, code, reason) => logger.warn(`Lavalink Node: ${name} closed with code ${code}. Reason: ${reason || 'No reason'}`));
    this.shoukaku.on('disconnect', (name, count) => logger.warn(`Lavalink Node: ${name} disconnected. Count: ${count}`));
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
