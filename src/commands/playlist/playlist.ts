import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
import { db } from '../../database/db';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';

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
    ),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const subcommand = interaction.options.getSubcommand();
    await interaction.deferReply();

    if (subcommand === 'create') {
      const name = interaction.options.getString('name', true);
      const playlist = await db.playlist.create({
        data: {
          userId: interaction.user.id,
          name: name,
        },
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(`Playlist **${name}** berhasil dibuat dengan ID: \`${playlist.id}\``)] });
    } else if (subcommand === 'list') {
      const playlists = await db.playlist.findMany({ where: { userId: interaction.user.id } });
      if (playlists.length === 0) {
        await interaction.followUp({ embeds: [createErrorEmbed('Kamu belum memiliki playlist apapun.')] });
        return;
      }
      
      const desc = playlists.map(p => `**${p.name}** - ${p.tracks.length} lagu (\`${p.id}\`)`).join('\n');
      await interaction.followUp({ embeds: [createSuccessEmbed(`**Daftar Playlist-mu:**\n${desc}`)] });
    }
  },
};

export default playlistCommand;
