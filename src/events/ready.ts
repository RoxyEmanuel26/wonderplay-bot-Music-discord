import { Events } from 'discord.js';
import { Event } from '../structures/Event';
import { logger } from '../utils/logger';

const readyEvent: Event<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute: async (clientReady, client) => {
    logger.info(`Logged in as ${clientReady.user.tag}!`);
    logger.info(`Loaded ${client.commands.size} commands.`);
  },
};

export default readyEvent;
