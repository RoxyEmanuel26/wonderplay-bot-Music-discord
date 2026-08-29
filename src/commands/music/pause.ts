import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';

const pauseCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Menjeda lagu yang sedang diputar.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue || !queue.current) {
      await interaction.reply({ content: 'Tidak ada lagu yang sedang diputar.', ephemeral: true });
      return;
    }

    if (queue.player.paused) {
      await interaction.reply({ content: 'Pemutaran sudah dijeda.', ephemeral: true });
      return;
    }

    queue.player.setPaused(true);
    await interaction.reply('⏸️ Lagu dijeda.');
  },
};

export default pauseCommand;
