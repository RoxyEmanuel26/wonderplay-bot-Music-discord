import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const pauseCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Menjeda lagu yang sedang diputar.'),
  aliases: ['pa'],
  execute: async (ctx: Context, client) => {
    await ctx.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await hasDJPermissions(ctx.interaction || ctx.message as any))) {
      await ctx.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], flags: MessageFlags.Ephemeral });
      return;
    }

    const queue = client.queues.get(ctx.guildId!);
    
    if (!queue || !queue.current) {
      await ctx.reply({ embeds: [createErrorEmbed('Tidak ada lagu yang sedang diputar.')], flags: MessageFlags.Ephemeral });
      return;
    }

    if (queue.player.paused) {
      await ctx.reply({ embeds: [createErrorEmbed('Musik sudah dalam keadaan dijeda.')], flags: MessageFlags.Ephemeral });
      return;
    }

    await queue.setPaused(true);
    await ctx.reply({ embeds: [createSuccessEmbed('⏸️ Musik berhasil dijeda.')] });
  },
};

export default pauseCommand;
