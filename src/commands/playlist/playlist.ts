import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
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
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply();

    if (subcommand === 'create') {
      const name = interaction.options.getString('name', true);
      const existing = await db.playlist.findFirst({ where: { userId: interaction.user.id, name } });
      if (existing) {
        await interaction.followUp({ embeds: [createErrorEmbed(`Playlist **${name}** sudah ada.`)] });
        return;
      }

      await db.playlist.create({
        data: { userId: interaction.user.id, name },
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(`Playlist **${name}** berhasil dibuat!`)] });
      return;

    } else if (subcommand === 'list') {
      const playlists = await db.playlist.findMany({ where: { userId: interaction.user.id } });
      if (playlists.length === 0) {
        await interaction.followUp({ embeds: [createErrorEmbed('Kamu belum memiliki playlist apapun.')] });
        return;
      }
      const desc = playlists.map(p => `**${p.name}** - ${p.tracks.length} lagu`).join('\n');
      await interaction.followUp({ embeds: [createSuccessEmbed(`**Daftar Playlist-mu:**\n${desc}`)] });
      return;

    } else if (subcommand === 'add') {
      const name = interaction.options.getString('name', true);
      const queue = client.queues.get(interaction.guildId!);
      if (!queue || !queue.current) {
        await interaction.followUp({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar.')] });
        return;
      }

      const playlist = await db.playlist.findFirst({ where: { userId: interaction.user.id, name } });
      if (!playlist) {
        await interaction.followUp({ embeds: [createErrorEmbed(`Playlist **${name}** tidak ditemukan.`)] });
        return;
      }

      const trackUri = queue.current.info.uri || queue.current.info.title;
      await db.playlist.update({
        where: { id: playlist.id },
        data: { tracks: { push: trackUri } },
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(`Berhasil menambahkan **${queue.current.info.title}** ke playlist **${name}**.`)] });
      return;

    } else if (subcommand === 'play') {
      const name = interaction.options.getString('name', true);
      const playlist = await db.playlist.findFirst({ where: { userId: interaction.user.id, name } });
      
      if (!playlist || playlist.tracks.length === 0) {
        await interaction.followUp({ embeds: [createErrorEmbed(`Playlist **${name}** tidak ditemukan atau kosong.`)] });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const member = interaction.member as any;
      const voiceChannel = member?.voice?.channel;
      if (!voiceChannel) {
        await interaction.followUp({ embeds: [createErrorEmbed('Kamu harus berada di voice channel terlebih dahulu!')] });
        return;
      }

      const node = client.shoukaku.getIdealNode();
      if (!node) {
        await interaction.followUp({ embeds: [createErrorEmbed('Tidak ada node Lavalink yang tersedia saat ini.')] });
        return;
      }

      let queue = client.queues.get(interaction.guildId!);
      if (!queue) {
        const player = await client.shoukaku.joinVoiceChannel({
          guildId: interaction.guildId!,
          channelId: voiceChannel.id,
          shardId: 0,
        });
        queue = new Queue(client, player, interaction.channel as TextChannel, interaction.guildId!);
        client.queues.set(interaction.guildId!, queue);
      }

      let loaded = 0;
      for (const uri of playlist.tracks) {
        const result = await node.rest.resolve(uri.startsWith('http') ? uri : `ytsearch:${uri}`);
        if (result && result.data && result.loadType !== 'empty' && result.loadType !== 'error') {
          const track = result.loadType === 'playlist' ? result.data.tracks[0] : (Array.isArray(result.data) ? result.data[0] : result.data);
          if (track) {
            queue.enqueue(track);
            loaded++;
          }
        }
      }

      await interaction.followUp({ embeds: [createSuccessEmbed(`Berhasil memuat **${loaded}** lagu dari playlist **${name}** ke antrean!`)] });
    }
  },
};

export default playlistCommand;
