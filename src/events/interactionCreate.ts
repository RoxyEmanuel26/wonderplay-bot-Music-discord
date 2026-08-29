import { Events, Interaction } from 'discord.js';
import { Event } from '../structures/Event';
import { Context } from '../structures/Context';
import { logger } from '../utils/logger';
import { t, getLanguage, Language } from '../utils/i18n';

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
        const ctx = new Context(interaction);
        await command.execute(ctx, client);
      } catch (error) {
        logger.error(error, `Error executing ${interaction.commandName}`);
        
        let lang: Language = 'id';
        if (interaction.guildId) {
          lang = await getLanguage(interaction.guildId);
        }

        const errorMsg = t('errorExecuting', lang);
        
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMsg, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMsg, ephemeral: true });
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
