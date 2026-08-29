import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../../structures/Command';
import { createErrorEmbed } from '../../utils/embeds';
import { createProgressBar, formatDuration } from '../../utils/progressbar';

const npCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('np')
    .setDescription('Menampilkan lagu yang sedang diputar saat ini beserta durasinya.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue || !queue.current) {
      await interaction.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar.')], ephemeral: true });
      return;
    }

    const currentTrack = queue.current;
    const currentPosition = queue.player.position || 0;
    const totalDuration = currentTrack.info.length;
    
    const progressBar = createProgressBar(currentPosition, totalDuration, 15);
    const timeString = `\`${formatDuration(currentPosition)}\` ${progressBar} \`${formatDuration(totalDuration)}\``;

    const embed = new EmbedBuilder()
      .setTitle('🎶 Now Playing')
      .setDescription(`[**${currentTrack.info.title}**](${currentTrack.info.uri || ''})\n\n${timeString}`)
      .setColor('#D4AF37')
      .setThumbnail(currentTrack.info.artworkUrl || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=256&h=256')
      .setFooter({ text: `Volume: ${queue.player.filters.volume ? Math.round(queue.player.filters.volume * 100) : 100}% | Loop: ${queue.loop}` });

    await interaction.reply({ embeds: [embed] });
  },
};

export default npCommand;
