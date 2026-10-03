import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  Message,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { Track } from 'shoukaku';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createErrorEmbed } from '../../utils/embeds';
import { formatDuration } from '../../utils/progressbar';
import { paginateQueue } from '../../utils/queuePagination';
import { logger } from '../../utils/logger';

function trackLabel(track: Track): string {
  const title = track.info.title.slice(0, 80).replace(/[\\[\]()]/g, '\\$&');
  const uri = track.info.uri;
  const label = uri && /^https?:\/\//i.test(uri) && uri.length <= 200
    ? `[${title}](${uri})`
    : title;
  return `${label} | \`${formatDuration(track.info.length)}\``;
}

const queueCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Melihat daftar antrean lagu saat ini.'),
  aliases: ['q', 'list', 'antrean'],
  execute: async (ctx: Context, client) => {
    const guildId = ctx.guildId!;
    const queue = client.queues.get(guildId);
    if (!queue || (!queue.current && queue.tracks.length === 0)) {
      await ctx.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar atau antrean kosong.')], flags: MessageFlags.Ephemeral });
      return;
    }

    let page = 0;
    const buildView = (requestedPage: number, expired = false) => {
      const activeQueue = client.queues.get(guildId);
      const tracks = activeQueue?.tracks || [];
      const current = activeQueue?.current;
      const result = paginateQueue(tracks, requestedPage);
      page = result.page;
      const totalDuration = tracks.reduce((sum, track) => sum + track.info.length, current?.info.length || 0);

      const lines = result.items.map((track, index) =>
        `${result.startIndex + index + 1}. ${trackLabel(track)}`);
      const description = [
        '**Sedang Diputar:**',
        current ? trackLabel(current) : '*Tidak ada lagu yang sedang diputar.*',
        '',
        '**Antrean Selanjutnya:**',
        lines.length ? lines.join('\n') : '*Tidak ada lagu berikutnya di antrean.*',
      ].join('\n');

      const footer = tracks.length
        ? `Halaman ${result.page + 1}/${result.totalPages} • Lagu ${result.startIndex + 1}–${result.startIndex + result.items.length} dari ${tracks.length}`
        : 'Halaman 1/1 • Antrean berikutnya kosong';
      const embed = new EmbedBuilder()
        .setTitle(`📑 Antrean Lagu di ${ctx.guild?.name || 'server ini'}`)
        .setDescription(description)
        .setColor('#D4AF37')
        .setFooter({ text: `${footer} | Total Lagu: ${tracks.length + (current ? 1 : 0)} | Total Durasi: ${formatDuration(totalDuration)} | Loop: ${activeQueue?.loop || 'NONE'}` });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('queue:previous')
          .setLabel('◀ Sebelumnya')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(expired || !result.hasPrevious),
        new ButtonBuilder()
          .setCustomId('queue:next')
          .setLabel('Berikutnya ▶')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(expired || !result.hasNext),
      );

      return { embeds: [embed], components: [row] };
    };

    const response = await ctx.reply({ ...buildView(page), withResponse: true });
    const message = (response.resource?.message || response) as Message;
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, idle: 15 * 60_000 });
    let navigation: Promise<void> = Promise.resolve();

    collector.on('collect', async (interaction) => {
      if (interaction.user.id !== ctx.author.id) {
        await interaction.reply({ content: '❌ Hanya pemanggil perintah yang dapat membalik halaman antrean ini. Gunakan `/queue` atau `.queue` untuk membuka antrean sendiri.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return;
      }

      try {
        await interaction.deferUpdate();
      } catch (error) {
        logger.warn({ error, guildId }, 'Gagal mengakui tombol antrean');
        return;
      }

      navigation = navigation.then(async () => {
        const nextPage = page + (interaction.customId === 'queue:next' ? 1 : -1);
        await message.edit(buildView(nextPage));
      }).catch((error) => {
        logger.warn({ error, guildId }, 'Gagal memperbarui halaman antrean');
      });
      await navigation;
    });

    collector.on('end', () => {
      void navigation.then(() => message.edit(buildView(page, true))).catch(() => {});
    });
  },
};

export default queueCommand;
