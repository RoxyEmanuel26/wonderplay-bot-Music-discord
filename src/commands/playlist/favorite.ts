import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
import { db } from '../../database/db';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';

const favoriteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('favorite')
    .setDescription('Menyimpan lagu yang sedang diputar ke favoritmu.'),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const queue = client.queues.get(interaction.guildId!);
    
    if (!queue || !queue.current) {
      await interaction.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar untuk ditambahkan ke favorit.')], ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const track = queue.current;
    
    // Check if already favorited
    const existing = await db.favorite.findFirst({
      where: {
        userId: interaction.user.id,
        trackUri: track.info.uri || track.info.title,
      }
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
  },
};

export default favoriteCommand;
