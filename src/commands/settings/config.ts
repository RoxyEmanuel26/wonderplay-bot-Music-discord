import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../structures/Command';
import { createSuccessEmbed } from '../../utils/embeds';
import { db } from '../../database/db';

const configCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Mengatur konfigurasi bot untuk server ini.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('djrole')
        .setDescription('Mengatur Role khusus DJ.')
        .addRoleOption(option => option.setName('role').setDescription('Role DJ yang dipilih.').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('mode247')
        .setDescription('Mengaktifkan/mematikan mode 24/7 (bot tidak akan keluar).')
        .addBooleanOption(option => option.setName('enabled').setDescription('Aktif atau tidak.').setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('language')
        .setDescription('Mengatur bahasa bot (Indonesia / English).')
        .addStringOption(option => 
          option.setName('lang')
            .setDescription('Pilih bahasa')
            .setRequired(true)
            .addChoices(
              { name: 'Indonesia', value: 'id' },
              { name: 'English', value: 'en' }
            )
        )
    ),
  execute: async (interaction: ChatInputCommandInteraction, _client) => {
    const subcommand = interaction.options.getSubcommand();
    
    await interaction.deferReply();

    if (subcommand === 'djrole') {
      const role = interaction.options.getRole('role', true);
      await db.guildSettings.upsert({
        where: { guildId: interaction.guildId! },
        create: { guildId: interaction.guildId!, djRoleId: role.id },
        update: { djRoleId: role.id },
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(`Role DJ berhasil disetel ke <@&${role.id}>.`)] });
    } else if (subcommand === 'mode247') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await db.guildSettings.upsert({
        where: { guildId: interaction.guildId! },
        create: { guildId: interaction.guildId!, mode247: enabled },
        update: { mode247: enabled },
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(`Mode 24/7 berhasil ${enabled ? 'diaktifkan' : 'dimatikan'}.`)] });
    } else if (subcommand === 'language') {
      const lang = interaction.options.getString('lang', true);
      await db.guildSettings.upsert({
        where: { guildId: interaction.guildId! },
        create: { guildId: interaction.guildId!, language: lang },
        update: { language: lang },
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(lang === 'en' ? 'Language successfully set to English.' : 'Bahasa berhasil disetel ke Indonesia.')] });
    }
  },
};

export default configCommand;
