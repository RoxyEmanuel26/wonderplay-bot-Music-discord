import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const stopCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Menghentikan musik dan membersihkan antrean.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    if (!(await hasDJPermissions(interaction))) {
      await interaction.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], ephemeral: true });
      return;
    }

    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue) {
      await interaction.reply({ embeds: [createErrorEmbed('Bot tidak sedang berada di voice channel.')], ephemeral: true });
      return;
    }

    queue.stop();
    client.shoukaku.leaveVoiceChannel(interaction.guildId!);
    client.queues.delete(interaction.guildId!);
    
    await interaction.reply({ embeds: [createSuccessEmbed('⏹️ Musik dihentikan, antrean dibersihkan, dan bot keluar dari voice channel.')] });
  },
};

export default stopCommand;
