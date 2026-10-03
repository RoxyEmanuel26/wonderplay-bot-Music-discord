import { SlashCommandBuilder, TextChannel, AutocompleteInteraction, MessageFlags } from 'discord.js';
import { Command } from '../../structures/Command';
import { Context } from '../../structures/Context';
import { Queue } from '../../structures/Queue';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { t, getLanguage } from '../../utils/i18n';
import {
  parseSpotifyUrl,
  spotifyFallbackService,
  SpotifyAuthorizationError,
} from '../../services/SpotifyFallbackService';

const guildPlayOperations = new Map<string, Promise<void>>();

async function runGuildPlayOperation(guildId: string, operation: () => Promise<void>): Promise<void> {
  const previous = guildPlayOperations.get(guildId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  guildPlayOperations.set(guildId, current);

  try {
    await current;
  } finally {
    if (guildPlayOperations.get(guildId) === current) {
      guildPlayOperations.delete(guildId);
    }
  }
}

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
      const resolved = await client.resolveTrack(`ytmsearch:${focusedValue}`)
        || await client.resolveTrack(`ytsearch:${focusedValue}`);
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
      await ctx.reply({ embeds: [createErrorEmbed('Mohon berikan judul lagu atau link.')], flags: MessageFlags.Ephemeral });
      return;
    }

    // Acknowledge slash interactions before Redis/PostgreSQL, node selection,
    // Spotify OAuth, or Lavalink REST can consume Discord's response window.
    await ctx.deferReply();

    const lang = await getLanguage(ctx.guildId!);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const member = ctx.member as any;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      await ctx.reply({ embeds: [createErrorEmbed(t('noVoiceChannel', lang))], flags: MessageFlags.Ephemeral });
      return;
    }

    const hasActiveNode = client.shoukaku?.nodes && Array.from(client.shoukaku.nodes.values()).some(n => n.state === 1);
    if (!hasActiveNode) {
      await ctx.reply({ embeds: [createErrorEmbed(t('noNode', lang))], flags: MessageFlags.Ephemeral });
      return;
    }

    await runGuildPlayOperation(ctx.guildId!, async () => {
      let queue = client.queues.get(ctx.guildId!);
      const activeVoiceChannelId = client.shoukaku?.connections.get(ctx.guildId!)?.channelId
        || ctx.guild?.members.me?.voice.channelId;

      if (queue && activeVoiceChannelId && activeVoiceChannelId !== voiceChannel.id) {
        await ctx.followUp({
          embeds: [createErrorEmbed(`Bot sedang digunakan di <#${activeVoiceChannelId}>. Bergabunglah ke voice channel tersebut untuk menambahkan lagu.`)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const spotifyReference = parseSpotifyUrl(query);
      const resolved = query.startsWith('http')
        ? await client.resolveTrack(query, queue?.player.node.name, true)
        : await client.resolveTrack(`ytmsearch:${query}`, queue?.player.node.name, true)
          || await client.resolveTrack(`ytsearch:${query}`, queue?.player.node.name, true);

      const spotifyMirror = !resolved && spotifyReference?.type === 'track'
        ? await spotifyFallbackService.resolveTrack(client, spotifyReference, queue?.player.node.name)
        : null;

      let spotifyCollection = null;
      if (!resolved && spotifyReference && spotifyReference.type !== 'track') {
        try {
          spotifyCollection = await spotifyFallbackService.resolveCollection(
            client,
            spotifyReference,
            queue?.player.node.name,
          );
        } catch (error) {
          const detail = error instanceof SpotifyAuthorizationError
            ? error.message
            : 'Gagal membaca playlist Spotify melalui OAuth. Silakan periksa log bot.';
          await ctx.followUp({ embeds: [createErrorEmbed(detail)] });
          return;
        }
      }

      if ((!resolved || !resolved.result || !resolved.result.data) && !spotifyMirror && !spotifyCollection) {
        const detail = spotifyReference && spotifyReference.type !== 'track'
          ? 'Playlist/album Spotify memerlukan LavaSrc dengan Spotify API yang aktif. Track tunggal tetap bisa memakai mirror YouTube tanpa Premium.'
          : 'Lagu tidak ditemukan di seluruh node audio atau terjadi galat!';
        await ctx.followUp({ embeds: [createErrorEmbed(detail)] });
        return;
      }

      const result = resolved?.result;
      const sourceNodeName = spotifyMirror?.nodeName || spotifyCollection?.nodeName || resolved?.node.name;

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

          if (!sourceNodeName || !(await queue.bindToNode(sourceNodeName))) {
            await queue.disconnect();
            await ctx.followUp({ embeds: [createErrorEmbed('Node audio tidak dapat diselaraskan dengan sumber track. Silakan coba lagi.')] });
            return;
          }
        } catch {
          await ctx.followUp({ embeds: [createErrorEmbed('Gagal bergabung ke saluran suara. Pastikan bot memiliki izin untuk bergabung dan berbicara di saluran tersebut.')] });
          return;
        }
      }

      if (result?.loadType === 'playlist') {
        const playlistData = result.data as { info: { name: string }; tracks: any[] };
        const tracks = playlistData.tracks || [];

        if (tracks.length === 0) {
          await ctx.followUp({ embeds: [createErrorEmbed('Playlist kosong atau tidak dapat dimuat.')] });
          return;
        }

        await queue.enqueueMany(tracks);

        const playlistName = playlistData.info?.name || 'Playlist';
        await ctx.followUp({
          embeds: [createSuccessEmbed(`Berhasil menambahkan **${tracks.length}** lagu dari playlist **${playlistName}** ke antrean! 🎶`)],
        });
        queue.scheduleControlPanelRefresh();
        return;
      }

      if (spotifyCollection) {
        await queue.enqueueMany(spotifyCollection.tracks);
        const skippedNote = spotifyCollection.skipped > 0
          ? ` ${spotifyCollection.skipped} track dilewati karena tidak menemukan audio yang cocok.`
          : '';
        await ctx.followUp({
          embeds: [createSuccessEmbed(
            `Berhasil menambahkan **${spotifyCollection.tracks.length}** lagu dari **${spotifyCollection.name}** melalui Spotify OAuth → YouTube Music.${skippedNote}`,
          )],
        });
        queue.scheduleControlPanelRefresh();
        return;
      }

      let track = spotifyMirror?.track;
      if (!track && result && (result.loadType === 'search' || result.loadType === 'track')) {
        track = Array.isArray(result.data) ? result.data[0] : result.data;
      }

      if (!track) {
        await ctx.followUp({ embeds: [createErrorEmbed('Gagal memuat lagu.')] });
        return;
      }

      await queue.enqueue(track);
      const mirrorNote = (track.pluginInfo as Record<string, unknown>)?.spotifyMirror ? '\n*Audio dimirror dari YouTube Music berdasarkan metadata Spotify.*' : '';
      await ctx.followUp({ embeds: [createSuccessEmbed(`${t('addedToQueue', lang)}:\n**[${track.info.title}](${track.info.uri})**${mirrorNote}`)] });
      queue.scheduleControlPanelRefresh();
    });
  },
};

export default playCommand;
