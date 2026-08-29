import {  SlashCommandBuilder,   } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed } from '../../utils/embeds';

const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Mengecek status, uptime, dan latency sistem (Healthcheck)'),
  aliases: ['pg'],
  execute: async (ctx: Context, client) => {
    const wsPing = client.ws.ping;
    const uptime = process.uptime();
    
    // Status node Lavalink
    const nodes = Array.from(client.shoukaku.nodes.values());
    const nodeStatus = nodes.map(n => `**${n.name}**: ${n.state === 1 ? '✅ Connected' : '❌ Disconnected'}`).join('\n') || 'Tidak ada node terhubung.';

    const embed = createSuccessEmbed('**System Healthcheck**')
      .addFields(
        { name: '📡 Discord WS Ping', value: `${wsPing}ms`, inline: true },
        { name: '⏱️ Bot Uptime', value: `${Math.floor(uptime / 60)} menit`, inline: true },
        { name: '🎵 Lavalink Nodes', value: nodeStatus, inline: false }
      );

    await ctx.reply({ embeds: [embed] });
  },
};

export default pingCommand;
