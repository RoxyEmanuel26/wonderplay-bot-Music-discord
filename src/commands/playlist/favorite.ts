import { MessageFlags, SlashCommandBuilder, TextChannel } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { db } from '../../database/db';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { Queue } from '../../structures/Queue';
import { parseSpotifyUrl, spotifyFallbackService } from '../../services/SpotifyFallbackService';
import { Track } from 'shoukaku';

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
  aliases: ['fav', 'favs', 'favorit'],
  execute: async (ctx: Context, client) => {
    const subcommand = ctx.isInteraction ? ctx.interaction!.options.getSubcommand() : ctx.args[0];
    if (!subcommand) {
      await ctx.reply({ embeds: [createErrorEmbed('Mohon pilih aksi: `add`, `list`, atau `play`.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await ctx.deferReply(subcommand !== 'play' ? { flags: MessageFlags.Ephemeral } : undefined);

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
      
      const shown = favorites.slice(0, 50);
      const desc = shown.map((f, i) => `${i + 1}. **${f.title.slice(0, 80)}**`).join('\n')
        + (favorites.length > shown.length ? `\n*...dan ${favorites.length - shown.length} favorit lainnya.*` : '');
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

      const hasActiveNode = client.hasReadyLavalinkNode();
      if (!hasActiveNode) {
        await ctx.followUp({ embeds: [createErrorEmbed('Tidak ada node audio Lavalink yang tersedia saat ini.')] });
        return;
      }

      let queue = client.queues.get(ctx.guildId!);
      const activeVoiceChannelId = client.shoukaku.connections.get(ctx.guildId!)?.channelId
        || ctx.guild?.members.me?.voice.channelId;
      if (queue && activeVoiceChannelId && activeVoiceChannelId !== voiceChannel.id) {
        await ctx.followUp({ embeds: [createErrorEmbed(`Bot sedang digunakan di <#${activeVoiceChannelId}>. Bergabunglah ke voice channel tersebut.`)] });
        return;
      }
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

      const loadedTracks: Track[] = [];
      for (const fav of favorites) {
        const query = fav.trackUri.startsWith('http') ? fav.trackUri : `ytmsearch:${fav.trackUri}`;
        const resolved = await client.resolveTrack(query, queue.player.node.name, true)
          || (!fav.trackUri.startsWith('http') ? await client.resolveTrack(`ytsearch:${fav.trackUri}`, queue.player.node.name, true) : null);
        const spotifyRef = parseSpotifyUrl(fav.trackUri);
        const mirror = !resolved && spotifyRef?.type === 'track'
          ? await spotifyFallbackService.resolveTrack(client, spotifyRef, queue.player.node.name)
          : null;
        if (resolved && resolved.result && resolved.result.data) {
          const resData = resolved.result.data;
          const track = resolved.result.loadType === 'playlist' ? (resData as any).tracks[0] : (Array.isArray(resData) ? resData[0] : resData);
          if (track) {
            loadedTracks.push(track);
          }
        } else if (mirror) {
          loadedTracks.push(mirror.track);
        }
      }

      if (loadedTracks.length === 0) {
        await ctx.followUp({ embeds: [createErrorEmbed('Tidak ada lagu favorit yang berhasil dimuat atau lagu tidak tersedia.')] });
        return;
      }

      await queue.enqueueMany(loadedTracks);
      await ctx.followUp({ embeds: [createSuccessEmbed(`Berhasil memuat **${loadedTracks.length}** lagu favorit ke antrean!`)] });
    } else {
      await ctx.followUp({ embeds: [createErrorEmbed('Aksi tidak dikenal. Pilihan yang tersedia: `add`, `list`, atau `play`.')] });
    }
  },
};

export default favoriteCommand;
