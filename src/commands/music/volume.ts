import {  SlashCommandBuilder,   } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const volumeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Mengatur volume musik (1-200).')
    .addIntegerOption(option => 
      option.setName('level')
        .setDescription('Tingkat volume')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(200)
    ),
  aliases: ['v'],
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
    
    const level = ctx.isInteraction ? ctx.interaction!.options.getInteger('level', true) : parseInt(ctx.args[0]);
    
    if (isNaN(level)) {
      await ctx.reply({ embeds: [createErrorEmbed('Mohon berikan level volume yang valid (1-200).')], ephemeral: true });
      return;
    }
    queue.player.setGlobalVolume(level);
    
    await ctx.reply({ embeds: [createSuccessEmbed(`🔊 Volume diatur ke **${level}%**.`)] });
  },
};

export default volumeCommand;
