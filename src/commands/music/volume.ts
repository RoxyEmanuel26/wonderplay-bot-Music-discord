import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const volumeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Mengatur volume musik (1-200).')
    .addIntegerOption(option => 
      option.setName('level')
        .setDescription('Tingkat volume')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(200)
    ),
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

    const level = interaction.options.getInteger('level', true);
    queue.player.setGlobalVolume(level);
    
    await interaction.reply({ embeds: [createSuccessEmbed(`🔊 Volume diatur ke **${level}%**.`)] });
  },
};

export default volumeCommand;
