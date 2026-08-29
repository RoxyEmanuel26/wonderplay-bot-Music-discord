import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel, AutocompleteInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
import { Queue } from '../../structures/Queue';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { t, getLanguage } from '../../utils/i18n';

const playCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Memutar lagu atau menambahkannya ke antrean.')
    .addStringOption((option) =>
      option.setName('query')
        .setDescription('Judul lagu atau link.')
        .setRequired(true)
        .setAutocomplete(true)
    ),
  autocomplete: async (interaction: AutocompleteInteraction, client) => {
    const focusedValue = interaction.options.getFocused();
    if (!focusedValue) return await interaction.respond([]);

    const node = client.shoukaku.getIdealNode();
    if (!node) return await interaction.respond([]);

    try {
      const result = await node.rest.resolve(`ytsearch:${focusedValue}`);
      if (!result || !result.data || result.loadType !== 'search') {
        return await interaction.respond([]);
      }

      const tracks = Array.isArray(result.data) ? result.data : [];
      const choices = tracks.slice(0, 5).map(tr => ({
        name: `${tr.info.title.slice(0, 80)} - ${tr.info.author.slice(0, 15)}`,
        value: tr.info.uri || tr.info.title,
      }));
      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
  },
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const query = interaction.options.getString('query', true);
    const lang = await getLanguage(interaction.guildId!);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const member = interaction.member as any;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await interaction.reply({ embeds: [createErrorEmbed(t('noVoiceChannel', lang))], ephemeral: true });
      return;
    }

    const node = client.shoukaku.getIdealNode();
    if (!node) {
      await interaction.reply({ embeds: [createErrorEmbed(t('noNode', lang))], ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const result = await node.rest.resolve(query.startsWith('http') ? query : `ytsearch:${query}`);
    if (!result || !result.data || result.loadType === 'empty' || result.loadType === 'error') {
      await interaction.followUp({ embeds: [createErrorEmbed('Lagu tidak ditemukan atau terjadi kesalahan!')] });
      return;
    }

    let track;
    if (result.loadType === 'playlist') {
      track = result.data.tracks[0];
    } else if (result.loadType === 'search' || result.loadType === 'track') {
      track = Array.isArray(result.data) ? result.data[0] : result.data;
    }

    if (!track) {
      await interaction.followUp({ embeds: [createErrorEmbed('Gagal memuat lagu.')] });
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

    queue.enqueue(track);
    await interaction.followUp({ embeds: [createSuccessEmbed(`${t('addedToQueue', lang)}:\n**[${track.info.title}](${track.info.uri})**`)] });
  },
};

export default playCommand;
