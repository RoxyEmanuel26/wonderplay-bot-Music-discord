import {  SlashCommandBuilder, TextChannel  } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { db } from '../../database/db';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { Queue } from '../../structures/Queue';

const favoriteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('favorite')
    .setDescription('Mengelola daftar lagu favoritmu.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Menyimpan lagu yang sedang diputar ke favoritmu.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Melihat semua lagu favoritmu.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('play')
        .setDescription('Memutar seluruh lagu di daftar favoritmu.')
    ),
  aliases: ['fav'],
  execute: async (ctx: Context, client) => {
    const subcommand = ctx.isInteraction ? ctx.interaction!.options.getSubcommand() : ctx.args[0];
    if (!subcommand) {
      await ctx.reply({ embeds: [createErrorEmbed('Mohon pilih aksi: `add`, `list`, atau `play`.')], ephemeral: true });
      return;
    }
    await ctx.deferReply({ ephemeral: subcommand !== 'play' });

    if (subcommand === 'add') {
      const queue = client.queues.get(ctx.guildId!);
      if (!queue || !queue.current) {
        await ctx.followUp({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar untuk ditambahkan ke favorit.')] });
        return;
      }

      const track = queue.current;
      const existing = await db.favorite.findFirst({
        where: { userId: ctx.author.id, trackUri: track.info.uri || track.info.title }
      });

      if (existing) {
        await ctx.followUp({ embeds: [createErrorEmbed('Lagu ini sudah ada di daftar favoritmu.')] });
        return;
      }

      await db.favorite.create({
        data: {
          userId: ctx.author.id,
          title: track.info.title,
          trackUri: track.info.uri || track.info.title,
        }
      });
      await ctx.followUp({ embeds: [createSuccessEmbed(`Berhasil menyimpan **${track.info.title}** ke favorit!❤️`)] });
      return;

    } else if (subcommand === 'list') {
      const favorites = await db.favorite.findMany({ where: { userId: ctx.author.id } });
      if (favorites.length === 0) {
        await ctx.followUp({ embeds: [createErrorEmbed('Daftar favoritmu masih kosong.')] });
        return;
      }
      
      const desc = favorites.map((f, i) => `${i + 1}. **${f.title}**`).join('\n');
      await ctx.followUp({ embeds: [createSuccessEmbed(`**Lagu Favoritmu:**\n${desc}`)] });
      return;

    } else if (subcommand === 'play') {
      const favorites = await db.favorite.findMany({ where: { userId: ctx.author.id } });
      if (favorites.length === 0) {
        await ctx.followUp({ embeds: [createErrorEmbed('Daftar favoritmu masih kosong.')] });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const member = ctx.member as any;
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        await ctx.followUp({ embeds: [createErrorEmbed('Kamu harus berada di voice channel terlebih dahulu!')] });
        return;
      }

      const hasActiveNode = client.shoukaku?.nodes && Array.from(client.shoukaku.nodes.values()).some(n => n.state === 1);
      if (!hasActiveNode) {
        await ctx.followUp({ embeds: [createErrorEmbed('Tidak ada node audio Lavalink yang tersedia saat ini.')] });
        return;
      }

      let queue = client.queues.get(ctx.guildId!);
      if (!queue) {
        try {
          const player = await client.shoukaku.joinVoiceChannel({
            guildId: ctx.guildId!,
            channelId: voiceChannel.id,
            shardId: ctx.guild?.shardId ?? 0,
            deaf: true,
          });
          queue = new Queue(client, player, ctx.channel as TextChannel, ctx.guildId!);
          client.queues.set(ctx.guildId!, queue);
        } catch {
          await ctx.followUp({ embeds: [createErrorEmbed('Gagal bergabung ke saluran suara. Periksa izin bot.')] });
          return;
        }
      }

      let loaded = 0;
      for (const fav of favorites) {
        const query = fav.trackUri.startsWith('http') ? fav.trackUri : `ytsearch:${fav.trackUri}`;
        const resolved = await client.resolveTrack(query);
        if (resolved && resolved.result && resolved.result.data) {
          const resData = resolved.result.data;
          const track = resolved.result.loadType === 'playlist' ? (resData as any).tracks[0] : (Array.isArray(resData) ? resData[0] : resData);
          if (track) {
            queue.enqueue(track);
            loaded++;
          }
        }
      }

      if (loaded === 0) {
        await ctx.followUp({ embeds: [createErrorEmbed('Tidak ada lagu favorit yang berhasil dimuat atau lagu tidak tersedia.')] });
        return;
      }

      await ctx.followUp({ embeds: [createSuccessEmbed(`Berhasil memuat **${loaded}** lagu favorit ke antrean!`)] });
    } else {
      await ctx.followUp({ embeds: [createErrorEmbed('Aksi tidak dikenal. Pilihan yang tersedia: `add`, `list`, atau `play`.')] });
    }
  },
};

export default favoriteCommand;
