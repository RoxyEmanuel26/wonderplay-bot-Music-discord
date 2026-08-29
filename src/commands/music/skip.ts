import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const skipCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Melewati lagu yang sedang diputar.'),
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

    queue.skip();
    await interaction.reply({ embeds: [createSuccessEmbed('⏭️ Lagu berhasil dilewati.')] });
  },
};

export default skipCommand;
