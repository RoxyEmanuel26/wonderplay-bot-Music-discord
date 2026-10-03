import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const disconnectCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Mengeluarkan bot dari voice channel dan menghapus sesi playback.'),
  aliases: ['dc', 'leave'],
  execute: async (ctx: Context, client) => {
    await ctx.deferReply({ flags: MessageFlags.Ephemeral });
    if (!(await hasDJPermissions(ctx.interaction || ctx.message as never))) {
      await ctx.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], flags: MessageFlags.Ephemeral });
      return;
    }
    const queue = client.queues.get(ctx.guildId!);
    if (!queue) {
      await ctx.reply({ embeds: [createErrorEmbed('Bot tidak sedang berada di voice channel.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await queue.disconnect();
    await ctx.reply({ embeds: [createSuccessEmbed('👋 Bot telah keluar dari voice channel dan sesi playback dihapus.')] });
  },
};

export default disconnectCommand;
