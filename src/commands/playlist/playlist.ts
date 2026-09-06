import {  SlashCommandBuilder, TextChannel  } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { db } from '../../database/db';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { Queue } from '../../structures/Queue';

const playlistCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Mengelola playlist custom kamu.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Membuat playlist baru.')
        .addStringOption(option => option.setName('name').setDescription('Nama playlist.').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('Melihat semua playlist-mu.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Menambahkan lagu yang sedang diputar ke playlist.')
        .addStringOption(option => option.setName('name').setDescription('Nama playlist tujuan.').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('play')
        .setDescription('Memutar sebuah playlist.')
        .addStringOption(option => option.setName('name').setDescription('Nama playlist yang ingin diputar.').setRequired(true))
    ),
  aliases: ['pl'],
  execute: async (ctx: Context, client) => {
    const subcommand = ctx.isInteraction ? ctx.interaction!.options.getSubcommand() : ctx.args[0];
    if (!subcommand) {
      await ctx.reply({ embeds: [createErrorEmbed('Mohon pilih aksi: `create`, `list`, `add`, atau `play`.')], ephemeral: true });
      return;
    }
    await ctx.deferReply();

    if (subcommand === 'create') {
      const name = ctx.isInteraction ? ctx.interaction!.options.getString('name', true) : ctx.args.slice(1).join(' ');
      if (!name) {
        await ctx.followUp({ embeds: [createErrorEmbed('Mohon tentukan nama playlist yang ingin dibuat.')] });
        return;
      }
      const existing = await db.playlist.findFirst({ where: { userId: ctx.author.id, name } });
      if (existing) {
        await ctx.followUp({ embeds: [createErrorEmbed(`Playlist **${name}** sudah ada.`)] });
        return;
      }

      await db.playlist.create({
        data: { userId: ctx.author.id, name },
      });
      await ctx.followUp({ embeds: [createSuccessEmbed(`Playlist **${name}** berhasil dibuat!`)] });
      return;

    } else if (subcommand === 'list') {
      const playlists = await db.playlist.findMany({ where: { userId: ctx.author.id } });
      if (playlists.length === 0) {
        await ctx.followUp({ embeds: [createErrorEmbed('Kamu belum memiliki playlist apapun.')] });
        return;
      }
      const desc = playlists.map(p => `**${p.name}** - ${p.tracks.length} lagu`).join('\n');
      await ctx.followUp({ embeds: [createSuccessEmbed(`**Daftar Playlist-mu:**\n${desc}`)] });
      return;

    } else if (subcommand === 'add') {
      const name = ctx.isInteraction ? ctx.interaction!.options.getString('name', true) : ctx.args.slice(1).join(' ');
      if (!name) {
        await ctx.followUp({ embeds: [createErrorEmbed('Mohon tentukan nama playlist tujuan.')] });
        return;
      }
      const queue = client.queues.get(ctx.guildId!);
      if (!queue || !queue.current) {
        await ctx.followUp({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar.')] });
        return;
      }

      const playlist = await db.playlist.findFirst({ where: { userId: ctx.author.id, name } });
      if (!playlist) {
        await ctx.followUp({ embeds: [createErrorEmbed(`Playlist **${name}** tidak ditemukan.`)] });
        return;
      }

      const trackUri = queue.current.info.uri || queue.current.info.title;
      await db.playlist.update({
        where: { id: playlist.id },
        data: { tracks: { push: trackUri } },
      });
      await ctx.followUp({ embeds: [createSuccessEmbed(`Berhasil menambahkan **${queue.current.info.title}** ke playlist **${name}**.`)] });
      return;

    } else if (subcommand === 'play') {
      const name = ctx.isInteraction ? ctx.interaction!.options.getString('name', true) : ctx.args.slice(1).join(' ');
      if (!name) {
        await ctx.followUp({ embeds: [createErrorEmbed('Mohon tentukan nama playlist yang ingin diputar.')] });
        return;
      }
      const playlist = await db.playlist.findFirst({ where: { userId: ctx.author.id, name } });
      
      if (!playlist || playlist.tracks.length === 0) {
        await ctx.followUp({ embeds: [createErrorEmbed(`Playlist **${name}** tidak ditemukan atau kosong.`)] });
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
      for (const uri of playlist.tracks) {
        const query = uri.startsWith('http') ? uri : `ytsearch:${uri}`;
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

      await ctx.followUp({ embeds: [createSuccessEmbed(`Berhasil memuat **${loaded}** lagu dari playlist **${name}** ke antrean!`)] });
    } else {
      await ctx.followUp({ embeds: [createErrorEmbed('Aksi tidak dikenal. Pilihan yang tersedia: `create`, `list`, `add`, atau `play`.')] });
    }
  },
};

export default playlistCommand;
