import { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder, ComponentType, MessageFlags } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const filterCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('filter')
    .setDescription('Mengatur filter audio untuk lagu yang sedang diputar.'),
  aliases: ['f'],
  execute: async (ctx: Context, client) => {
    await ctx.deferReply({ flags: MessageFlags.Ephemeral });
    if (!await hasDJPermissions(ctx.interaction || ctx.message as any)) {
      await ctx.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], flags: MessageFlags.Ephemeral });
      return;
    }

    const queue = client.queues.get(ctx.guildId!);
    
    if (!queue || !queue.current) {
      await ctx.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar.')], flags: MessageFlags.Ephemeral });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId('select_filter')
      .setPlaceholder('Pilih filter audio...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Matikan Filter')
          .setDescription('Kembali ke suara normal.')
          .setValue('none'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Bassboost')
          .setDescription('Meningkatkan frekuensi bass.')
          .setValue('bassboost'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Nightcore')
          .setDescription('Mempercepat tempo dan pitch (suara tupai: any).')
          .setValue('nightcore'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Vaporwave')
          .setDescription('Memperlambat tempo dan pitch (suara berat).')
          .setValue('vaporwave'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Karaoke')
          .setDescription('Menghilangkan vokal (instrumental).')
          .setValue('karaoke'),
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const response = await ctx.reply({
      content: 'Silakan pilih filter audio:',
      components: [row],
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });
    const message = response.resource?.message || response;

    const collector = message.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

    collector.on('collect', async (i: any) => {
      await i.deferUpdate().catch(() => undefined);
      if (i.user.id !== ctx.author.id) {
        await i.followUp({ content: '❌ Hanya pemanggil perintah yang dapat mengatur filter ini.', flags: MessageFlags.Ephemeral });
        return;
      }
      const value = i.values[0];

      try {
        await queue.applyAudioFilter(value);
        await i.editReply({ content: `✅ Filter **${value.toUpperCase()}** berhasil diterapkan!`, components: [] });
      } catch {
        await i.followUp({ content: '❌ Filter gagal diterapkan oleh node audio.', flags: MessageFlags.Ephemeral });
      }
    });
  },
};

export default filterCommand;
