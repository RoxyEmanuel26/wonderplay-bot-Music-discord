import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const volumeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Mengatur volume musik (0-100).')
    .addIntegerOption(option => 
      option.setName('level')
        .setDescription('Tingkat volume')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(100)
    ),
  aliases: ['v'],
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
    
    const level = ctx.isInteraction ? ctx.interaction!.options.getInteger('level', true) : parseInt(ctx.args[0]);
    
    if (isNaN(level) || level < 0 || level > 100) {
      await ctx.reply({ embeds: [createErrorEmbed('Mohon berikan level volume yang valid antara 0 - 100.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await queue.setVolume(level);
    
    await ctx.reply({ embeds: [createSuccessEmbed(`🔊 Volume diatur ke **${level}%**.`)] });
  },
};

export default volumeCommand;
