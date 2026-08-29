import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const resumeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Melanjutkan lagu yang sedang dijeda.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    if (!(await hasDJPermissions(interaction))) {
      await interaction.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], ephemeral: true });
      return;
    }

    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue || !queue.current) {
      await interaction.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar.')], ephemeral: true });
      return;
    }

    if (!queue.player.paused) {
      await interaction.reply({ embeds: [createErrorEmbed('Musik tidak sedang dijeda.')], ephemeral: true });
      return;
    }

    queue.player.setPaused(false);
    await interaction.reply({ embeds: [createSuccessEmbed('▶️ Musik dilanjutkan.')] });
  },
};

export default resumeCommand;
