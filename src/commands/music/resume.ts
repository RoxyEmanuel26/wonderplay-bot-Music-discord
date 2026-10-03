import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const resumeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Melanjutkan lagu yang sedang dijeda.'),
  aliases: ['r', 'res'],
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

    if (!queue.player.paused) {
      await ctx.reply({ embeds: [createErrorEmbed('Musik tidak sedang dijeda.')], flags: MessageFlags.Ephemeral });
      return;
    }

    await queue.setPaused(false);
    await ctx.reply({ embeds: [createSuccessEmbed('▶️ Musik dilanjutkan.')] });
  },
};

export default resumeCommand;
