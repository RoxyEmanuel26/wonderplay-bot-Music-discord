import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const stopCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Menghentikan musik dan membersihkan antrean.'),
  aliases: ['st', 'end', 'berhenti'],
  execute: async (ctx: Context, client) => {
    await ctx.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await hasDJPermissions(ctx.interaction || ctx.message as any))) {
      await ctx.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], flags: MessageFlags.Ephemeral });
      return;
    }

    const queue = client.queues.get(ctx.guildId!);
    
    if (!queue) {
      await ctx.reply({ embeds: [createErrorEmbed('Bot tidak sedang berada di voice channel.')], flags: MessageFlags.Ephemeral });
      return;
    }

    await queue.stop();
    
    await ctx.reply({ embeds: [createSuccessEmbed('⏹️ Musik dihentikan dan antrean dibersihkan. Bot tetap berada di voice channel.')] });
  },
};

export default stopCommand;
