import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../structures/Command';
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
  execute: async (interaction: ChatInputCommandInteraction, _client) => {
    // Pastikan hanya owner bot yang bisa menjalankan ini (OWNER_ID atau OWNER_IDS dari .env)
    const envOwner = process.env.OWNER_IDS || process.env.OWNER_ID || '';
    const ownerIds = envOwner.split(',').map(id => id.trim());
    
    if (!ownerIds.includes(interaction.user.id)) {
      await interaction.reply({ embeds: [createErrorEmbed('Anda tidak memiliki izin untuk menggunakan perintah ini.')], ephemeral: true });
      return;
    }

    const code = interaction.options.getString('code', true);
    await interaction.deferReply({ ephemeral: true });

    try {
      let evaled = await eval(code);
      if (typeof evaled !== 'string') {
        evaled = util.inspect(evaled, { depth: 1 });
      }

      // Pastikan output tidak melebihi limit 4000 karakter Discord
      if (evaled.length > 4000) {
        evaled = evaled.slice(0, 3995) + '...';
      }

      await interaction.followUp({ embeds: [createSuccessEmbed(`**Output:**\n\`\`\`js\n${evaled}\n\`\`\``)] });
    } catch (e: unknown) {
      const errString = e instanceof Error ? e.message : String(e);
      await interaction.followUp({
        embeds: [createErrorEmbed(`**Error:**\n\`\`\`js\n${errString.slice(0, 1000)}\n\`\`\``)],
      });
    }
  },
};

export default evalCommand;
