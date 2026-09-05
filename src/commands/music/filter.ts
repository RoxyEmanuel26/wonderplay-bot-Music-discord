import {  SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder, ComponentType  } from 'discord.js';
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
    if (!await hasDJPermissions(ctx.interaction || ctx.message as any)) {
      await ctx.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], ephemeral: true });
      return;
    }

    const queue = client.queues.get(ctx.guildId!);
    
    if (!queue || !queue.current) {
      await ctx.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar.')], ephemeral: true });
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

    const message = await ctx.reply({
      content: 'Silakan pilih filter audio:',
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    const collector = message.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });

    collector.on('collect', async (i: any) => {
      if (i.user.id !== ctx.author.id) {
        await i.reply({ content: '❌ Hanya pemanggil perintah yang dapat mengatur filter ini.', ephemeral: true });
        return;
      }
      const value = i.values[0];
      
      // Selalu clear filter lama sebelum menerapkan yang baru agar tidak bertumpuk
      await queue.player.clearFilters();

      switch (value) {
        case 'none':
          // Sudah di-clear di atas
          break;
        case 'bassboost':
          await queue.player.setEqualizer([
            { band: 0, gain: 0.6 },
            { band: 1, gain: 0.67 },
            { band: 2, gain: 0.67 },
            { band: 3, gain: 0.3 },
            { band: 4, gain: 0.1 },
          ]);
          break;
        case 'nightcore':
          await queue.player.setTimescale({ speed: 1.2999999523162842, pitch: 1.2999999523162842, rate: 1.0 });
          break;
        case 'vaporwave':
          await queue.player.setTimescale({ speed: 0.8500000238418579, pitch: 0.800000011920929, rate: 1.0 });
          break;
        case 'karaoke':
          await queue.player.setKaraoke({ level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 });
          break;
      }

      await i.update({ content: `✅ Filter **${value.toUpperCase()}** berhasil diterapkan!`, components: [] });
    });
  },
};

export default filterCommand;
