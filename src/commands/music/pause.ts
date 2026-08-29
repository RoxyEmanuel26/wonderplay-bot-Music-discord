import {  SlashCommandBuilder,   } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const pauseCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Menjeda lagu yang sedang diputar.'),
  execute: async (ctx: Context, client) => {
    if (!(await hasDJPermissions(ctx.interaction || ctx.message as any))) {
      await ctx.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], ephemeral: true });
      return;
    }

    const queue = client.queues.get(ctx.guildId!);
    
    if (!queue || !queue.current) {
      await ctx.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar.')], ephemeral: true });
      return;
    }

    if (queue.player.paused) {
      await ctx.reply({ embeds: [createErrorEmbed('Musik sudah dalam keadaan dijeda.')], ephemeral: true });
      return;
    }

    queue.player.setPaused(true);
    await ctx.reply({ embeds: [createSuccessEmbed('⏸️ Musik berhasil dijeda.')] });
  },
};

export default pauseCommand;
