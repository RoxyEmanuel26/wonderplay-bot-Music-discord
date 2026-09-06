import { SlashCommandBuilder, TextChannel, AutocompleteInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
import { Context } from '../../structures/Context';
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
  aliases: ['p'],
  autocomplete: async (interaction: AutocompleteInteraction, client) => {
    const focusedValue = interaction.options.getFocused();
    if (!focusedValue) return await interaction.respond([]);

    try {
      const resolved = await client.resolveTrack(`ytsearch:${focusedValue}`);
      if (!resolved || !resolved.result || !resolved.result.data || resolved.result.loadType !== 'search') {
        return await interaction.respond([]);
      }

      const tracks = Array.isArray(resolved.result.data) ? resolved.result.data : [];
      const choices = tracks.slice(0, 5).map(tr => ({
        name: `${tr.info.title.slice(0, 80)} - ${tr.info.author.slice(0, 15)}`,
        value: tr.info.uri || tr.info.title,
      }));
      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
  },
  execute: async (ctx: Context, client) => {
    const query = ctx.isInteraction ? ctx.interaction!.options.getString('query', true) : ctx.args.join(' ');
    if (!query) {
      await ctx.reply({ embeds: [createErrorEmbed('Mohon berikan judul lagu atau link.')], ephemeral: true });
      return;
    }

    const lang = await getLanguage(ctx.guildId!);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const member = ctx.member as any;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await ctx.reply({ embeds: [createErrorEmbed(t('noVoiceChannel', lang))], ephemeral: true });
      return;
    }

    const hasActiveNode = client.shoukaku?.nodes && Array.from(client.shoukaku.nodes.values()).some(n => n.state === 1);
    if (!hasActiveNode) {
      await ctx.reply({ embeds: [createErrorEmbed(t('noNode', lang))], ephemeral: true });
      return;
    }

    await ctx.deferReply();

    const formattedQuery = query.startsWith('http') ? query : `ytsearch:${query}`;
    const resolved = await client.resolveTrack(formattedQuery);

    if (!resolved || !resolved.result || !resolved.result.data) {
      await ctx.followUp({ embeds: [createErrorEmbed('Lagu tidak ditemukan di seluruh node audio atau terjadi galat!')] });
      return;
    }

    const result = resolved.result;

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
        await ctx.followUp({ embeds: [createErrorEmbed('Gagal bergabung ke saluran suara. Pastikan bot memiliki izin untuk bergabung dan berbicara di saluran tersebut.')] });
        return;
      }
    }

    if (result.loadType === 'playlist') {
      const playlistData = result.data as { info: { name: string }; tracks: any[] };
      const tracks = playlistData.tracks || [];
      
      if (tracks.length === 0) {
        await ctx.followUp({ embeds: [createErrorEmbed('Playlist kosong atau tidak dapat dimuat.')] });
        return;
      }

      for (const tr of tracks) {
        queue.enqueue(tr);
      }

      const playlistName = playlistData.info?.name || 'Playlist';
      await ctx.followUp({
        embeds: [createSuccessEmbed(`Berhasil menambahkan **${tracks.length}** lagu dari playlist **${playlistName}** ke antrean! 🎶`)],
      });
      return;
    }

    let track;
    if (result.loadType === 'search' || result.loadType === 'track') {
      track = Array.isArray(result.data) ? result.data[0] : result.data;
    }

    if (!track) {
      await ctx.followUp({ embeds: [createErrorEmbed('Gagal memuat lagu.')] });
      return;
    }

    queue.enqueue(track);
    await ctx.followUp({ embeds: [createSuccessEmbed(`${t('addedToQueue', lang)}:\n**[${track.info.title}](${track.info.uri})**`)] });
  },
};

export default playCommand;
