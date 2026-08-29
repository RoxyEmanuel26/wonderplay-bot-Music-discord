import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';

const stopCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Menghentikan pemutaran dan menghapus antrean.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue) {
      await interaction.reply({ content: 'Tidak ada lagu yang sedang diputar.', ephemeral: true });
      return;
    }

    queue.stop();
    client.shoukaku.leaveVoiceChannel(interaction.guildId!);
    client.queues.delete(interaction.guildId!);

    await interaction.reply('⏹️ Pemutaran dihentikan, antrean dihapus, dan bot keluar dari voice channel.');
  },
};

export default stopCommand;
