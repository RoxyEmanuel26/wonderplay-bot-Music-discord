import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';

const queueCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Menampilkan antrean lagu saat ini.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue || (!queue.current && queue.tracks.length === 0)) {
      await interaction.reply({ content: 'Antrean kosong.', ephemeral: true });
      return;
    }

    const currentTitle = queue.current ? queue.current.info.title : 'None';
    const upNext = queue.tracks.slice(0, 10).map((track, i) => `${i + 1}. ${track.info.title}`).join('\n');
    
    const response = `**Now Playing:**\n${currentTitle}\n\n**Up Next:**\n${upNext || 'Kosong'}\n\n*(Total antrean: ${queue.tracks.length})*`;

    await interaction.reply({ content: response });
  },
};

export default queueCommand;
