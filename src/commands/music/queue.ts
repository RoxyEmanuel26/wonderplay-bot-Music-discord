import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createErrorEmbed } from '../../utils/embeds';
import { formatDuration } from '../../utils/progressbar';

const queueCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Melihat daftar antrean lagu saat ini.'),
  aliases: ['q'],
  execute: async (ctx: Context, client) => {
    const queue = client.queues.get(ctx.guildId!);
    if (!queue || !queue.current) {
      await ctx.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar atau antrean kosong.')], flags: MessageFlags.Ephemeral });
      return;
    }

    const currentTrack = queue.current;
    const upcoming = queue.tracks.slice(0, 10);
    const totalDuration = queue.tracks.reduce((acc, t) => acc + t.info.length, currentTrack.info.length);

    let description = `**Sedang Diputar:**\n[${currentTrack.info.title.slice(0, 100)}](${currentTrack.info.uri || ''}) | \`${formatDuration(currentTrack.info.length)}\`\n\n**Antrean Selanjutnya:**\n`;
    
    if (upcoming.length === 0) {
      description += `*Tidak ada lagu berikutnya di antrean.*`;
    } else {
      description += upcoming.map((t, i) => `${i + 1}. [${t.info.title.slice(0, 100)}](${t.info.uri || ''}) | \`${formatDuration(t.info.length)}\``).join('\n');
      if (queue.tracks.length > 10) {
        description += `\n*...dan ${queue.tracks.length - 10} lagu lainnya.*`;
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`📑 Antrean Lagu di ${ctx.guild?.name}`)
      .setDescription(description.slice(0, 4096))
      .setColor('#D4AF37')
      .setFooter({ text: `Total Lagu: ${queue.tracks.length + 1} | Total Durasi: ${formatDuration(totalDuration)} | Loop: ${queue.loop}` });

    await ctx.reply({ embeds: [embed] });
  },
};

export default queueCommand;
