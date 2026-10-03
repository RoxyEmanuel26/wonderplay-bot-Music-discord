import { DiscordAPIError, Events, Interaction, MessageFlags } from 'discord.js';
import { Event } from '../structures/Event';
import { Context } from '../structures/Context';
import { logger } from '../utils/logger';
import { t, getLanguage, Language } from '../utils/i18n';

import { checkCooldown } from '../utils/cooldown';

const interactionCreateEvent: Event<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  execute: async (interaction: Interaction, client) => {
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith('music:')) {
      const queue = interaction.guildId ? client.queues.get(interaction.guildId) : null;
      if (!queue) {
        await interaction.reply({ content: '❌ Sesi musik sudah berakhir.', flags: MessageFlags.Ephemeral });
        return;
      }
      try {
        await queue.handleControlInteraction(interaction);
      } catch (error) {
        if (isUnknownInteraction(error)) {
          logger.warn({ customId: interaction.customId, guildId: interaction.guildId }, 'Music control interaction expired before acknowledgement');
          return;
        }
        logger.error(error, `Error executing music control ${interaction.customId}`);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ Kontrol musik gagal dijalankan.', flags: MessageFlags.Ephemeral }).catch(() => null);
        } else {
          await interaction.followUp({ content: '❌ Kontrol musik gagal dijalankan.', flags: MessageFlags.Ephemeral }).catch(() => null);
        }
      }
    } else if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        logger.warn(`No command matching ${interaction.commandName} was found.`);
        return;
      }

      // Sistem Cooldown Redis (Mencegah Spam Slash Command)
      const isSpamming = await checkCooldown(interaction.user.id, command.data.name, 3000);
      if (isSpamming) {
        // Balas sementara (ephemeral) jika terkena cooldown, lalu abaikan
        await interaction.reply({ content: '⏳ Mohon tunggu sebentar sebelum menggunakan perintah ini lagi.', flags: MessageFlags.Ephemeral });
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
          if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({ content: errorMsg });
          } else {
            await interaction.followUp({ content: errorMsg, flags: MessageFlags.Ephemeral });
          }
        } else {
          await interaction.reply({ content: errorMsg, flags: MessageFlags.Ephemeral });
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

function isUnknownInteraction(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === 10062
    || Boolean(error && typeof error === 'object' && 'code' in error && error.code === 10062);
}

export default interactionCreateEvent;
