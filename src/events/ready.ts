import { Events, REST, Routes } from 'discord.js';
import { Event } from '../structures/Event';
import { logger } from '../utils/logger';

const readyEvent: Event<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute: async (clientReady, client) => {
    logger.info(`Logged in as ${clientReady.user.tag}!`);
    logger.info(`Loaded ${client.commands.size} commands in memory.`);

    if (process.env.DEPLOY_ON_READY === 'true') {
      try {
        const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
        const body = client.commands.map(cmd => cmd.data.toJSON());
        
        logger.info('Started refreshing application (/) commands...');
        await rest.put(
          Routes.applicationCommands(clientReady.user.id),
          { body }
        );
        logger.info(`Successfully reloaded ${body.length} application (/) commands globally.`);
      } catch (error) {
        logger.error(error, 'Failed to refresh application (/) commands');
      }
    } else {
      logger.info('Slash commands deployment skipped on startup (Gunakan "npm run deploy" untuk memperbarui command).');
    }
  },
};

export default readyEvent;
