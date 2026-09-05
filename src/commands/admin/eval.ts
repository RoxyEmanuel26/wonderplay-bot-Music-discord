import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../structures/Command';
import { Context } from '../../structures/Context';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';
import util from 'util';

const evalCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('eval')
    .setDescription('Developer only: mengeksekusi kode JavaScript murni.')
    .addStringOption(option => 
      option.setName('code')
        .setDescription('Kode JS untuk dieksekusi.')
        .setRequired(true)
    ),
  aliases: ['ev'],
  execute: async (ctx: Context, _client) => {
    // Pastikan hanya owner bot yang bisa menjalankan ini (OWNER_ID atau OWNER_IDS dari .env)
    const envOwner = process.env.OWNER_IDS || process.env.OWNER_ID || '';
    const ownerIds = envOwner.split(',').map(id => id.trim()).filter(Boolean);
    
    if (!envOwner || !ownerIds.includes(ctx.author.id)) {
      await ctx.reply({ embeds: [createErrorEmbed('Anda tidak memiliki izin untuk menggunakan perintah ini.')], ephemeral: true });
      return;
    }

    const code = ctx.isInteraction ? ctx.interaction!.options.getString('code', true) : ctx.args.join(' ');
    if (!code) {
      await ctx.reply({ embeds: [createErrorEmbed('Mohon berikan kode untuk dieksekusi.')], ephemeral: true });
      return;
    }

    await ctx.deferReply({ ephemeral: true });

    try {
      let evaled = await eval(code);
      if (typeof evaled !== 'string') {
        evaled = util.inspect(evaled, { depth: 1 });
      }

      // Sanitasi variabel sensitif (.env) agar tidak bocor ke chat
      const secrets = [
        process.env.DISCORD_TOKEN,
        process.env.LAVALINK_PASSWORD,
        process.env.DATABASE_URL,
        process.env.REDIS_URL,
      ].filter(Boolean) as string[];

      for (const secret of secrets) {
        if (secret && evaled.includes(secret)) {
          evaled = evaled.replaceAll(secret, '[REDACTED_SECRET]');
        }
      }

      // Pastikan output tidak melebihi limit 4000 karakter Discord
      if (evaled.length > 4000) {
        evaled = evaled.slice(0, 3995) + '...';
      }

      await ctx.followUp({ embeds: [createSuccessEmbed(`**Output:**\n\`\`\`js\n${evaled}\n\`\`\``)] });
    } catch (e: unknown) {
      let errString = e instanceof Error ? e.message : String(e);
      const secrets = [process.env.DISCORD_TOKEN, process.env.LAVALINK_PASSWORD].filter(Boolean) as string[];
      for (const secret of secrets) {
        if (secret && errString.includes(secret)) {
          errString = errString.replaceAll(secret, '[REDACTED_SECRET]');
        }
      }

      await ctx.followUp({
        embeds: [createErrorEmbed(`**Error:**\n\`\`\`js\n${errString.slice(0, 1000)}\n\`\`\``)],
      });
    }
  },
};

export default evalCommand;
