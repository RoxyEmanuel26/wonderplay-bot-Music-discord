import { Events, Interaction } from 'discord.js';
import { Event } from '../structures/Event';
import { logger } from '../utils/logger';

const interactionCreateEvent: Event<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  execute: async (interaction: Interaction, client) => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        logger.warn(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction, client);
      } catch (error) {
        logger.error(error, `Error executing ${interaction.commandName}`);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'There was an error while executing this command!', flags: 'Ephemeral' });
        } else {
          await interaction.reply({ content: 'There was an error while executing this command!', flags: 'Ephemeral' });
        }
      }
    } else if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);

      if (!command || !command.autocomplete) {
        return;
      }

      try {
        await command.autocomplete(interaction, client);
      } catch (error) {
        logger.error(error, `Error executing autocomplete for ${interaction.commandName}`);
      }
    }
  },
};

export default interactionCreateEvent;
