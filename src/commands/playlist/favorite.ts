import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
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
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: subcommand !== 'play' });

    if (subcommand === 'add') {
      const queue = client.queues.get(interaction.guildId!);
      if (!queue || !queue.current) {
        await interaction.followUp({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar untuk ditambahkan ke favorit.')] });
        return;
      }

      const track = queue.current;
      const existing = await db.favorite.findFirst({
        where: { userId: interaction.user.id, trackUri: track.info.uri || track.info.title }
      });

      if (existing) {
        await interaction.followUp({ embeds: [createErrorEmbed('Lagu ini sudah ada di daftar favoritmu.')] });
        return;
      }

      await db.favorite.create({
        data: {
          userId: interaction.user.id,
          title: track.info.title,
          trackUri: track.info.uri || track.info.title,
        }
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(`Berhasil menyimpan **${track.info.title}** ke favorit!❤️`)] });
      return;

    } else if (subcommand === 'list') {
      const favorites = await db.favorite.findMany({ where: { userId: interaction.user.id } });
      if (favorites.length === 0) {
        await interaction.followUp({ embeds: [createErrorEmbed('Daftar favoritmu masih kosong.')] });
        return;
      }
      
      const desc = favorites.map((f, i) => `${i + 1}. **${f.title}**`).join('\n');
      await interaction.followUp({ embeds: [createSuccessEmbed(`**Lagu Favoritmu:**\n${desc}`)] });
      return;

    } else if (subcommand === 'play') {
      const favorites = await db.favorite.findMany({ where: { userId: interaction.user.id } });
      if (favorites.length === 0) {
        await interaction.followUp({ embeds: [createErrorEmbed('Daftar favoritmu masih kosong.')] });
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
      for (const fav of favorites) {
        const result = await node.rest.resolve(fav.trackUri.startsWith('http') ? fav.trackUri : `ytsearch:${fav.trackUri}`);
        if (result && result.data && result.loadType !== 'empty' && result.loadType !== 'error') {
          const track = result.loadType === 'playlist' ? result.data.tracks[0] : (Array.isArray(result.data) ? result.data[0] : result.data);
          if (track) {
            queue.enqueue(track);
            loaded++;
          }
        }
      }

      await interaction.followUp({ embeds: [createSuccessEmbed(`Berhasil memuat **${loaded}** lagu favorit ke antrean!`)] });
    }
  },
};

export default favoriteCommand;
