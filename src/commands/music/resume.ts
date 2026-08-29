import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';

const resumeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Melanjutkan pemutaran lagu yang dijeda.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue || !queue.current) {
      await interaction.reply({ content: 'Tidak ada lagu yang sedang diputar.', ephemeral: true });
      return;
    }

    if (!queue.player.paused) {
      await interaction.reply({ content: 'Pemutaran sedang berlangsung (tidak dijeda).', ephemeral: true });
      return;
    }

    queue.player.setPaused(false);
    await interaction.reply('▶️ Lagu dilanjutkan.');
  },
};

export default resumeCommand;
