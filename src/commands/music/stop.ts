import {  SlashCommandBuilder,   } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import { hasDJPermissions } from '../../utils/dj';

const stopCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Menghentikan musik dan membersihkan antrean.'),
  aliases: ['st'],
  execute: async (ctx: Context, client) => {
    if (!(await hasDJPermissions(ctx.interaction || ctx.message as any))) {
      await ctx.reply({ embeds: [createErrorEmbed('Kamu membutuhkan role DJ untuk menggunakan perintah ini.')], ephemeral: true });
      return;
    }

    const queue = client.queues.get(ctx.guildId!);
    
    if (!queue) {
      await ctx.reply({ embeds: [createErrorEmbed('Bot tidak sedang berada di voice channel.')], ephemeral: true });
      return;
    }

    queue.stop();
    client.shoukaku.leaveVoiceChannel(ctx.guildId!);
    client.queues.delete(ctx.guildId!);
    
    await ctx.reply({ embeds: [createSuccessEmbed('⏹️ Musik dihentikan, antrean dibersihkan, dan bot keluar dari voice channel.')] });
  },
};

export default stopCommand;
