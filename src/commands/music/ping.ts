import { SlashCommandBuilder } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createSuccessEmbed } from '../../utils/embeds';
import { formatDuration } from '../../utils/progressbar';

const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Mengecek status, uptime, dan latency sistem (Healthcheck)'),
  aliases: ['pg'],
  execute: async (ctx: Context, client) => {
    const wsPing = client.ws.ping;
    const uptime = process.uptime();
    
    // Status node Lavalink Cluster
    const nodes = client.shoukaku?.nodes ? Array.from(client.shoukaku.nodes.values()) : [];
    const nodeStatus = nodes.map(n => {
      const isConnected = n.state === 1;
      const statusIcon = isConnected ? '🟢 Online' : '🔴 Offline';
      const players = n.stats?.players ?? 0;
      return `• **${n.name}**: ${statusIcon} \`(${players} players)\``;
    }).join('\n') || 'Tidak ada node terdaftar.';

    const ideal = client.shoukaku?.getIdealNode ? client.shoukaku.getIdealNode() : null;
    const activeRoute = ideal ? `🎯 Rute Utama: **${ideal.name}**` : '⚠️ Seluruh node offline';

    const embed = createSuccessEmbed('**System Healthcheck & Audio Cluster**')
      .addFields(
        { name: '📡 Discord WS Ping', value: `${wsPing}ms`, inline: true },
        { name: '⏱️ Bot Uptime', value: `\`${formatDuration(uptime * 1000)}\``, inline: true },
        { name: '⚡ Status Rute', value: activeRoute, inline: false },
        { name: '🎵 Lavalink Cluster Pool', value: nodeStatus, inline: false }
      );

    await ctx.reply({ embeds: [embed] });
  },
};

export default pingCommand;
