import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';

const skipCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Melewati lagu yang sedang diputar.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue || !queue.current) {
      await interaction.reply({ content: 'Tidak ada lagu yang sedang diputar untuk dilewati.', ephemeral: true });
      return;
    }

    queue.player.stopTrack(); // Emits 'end' event on the player, triggering next()
    await interaction.reply('⏭️ Lagu dilewati!');
  },
};

export default skipCommand;
