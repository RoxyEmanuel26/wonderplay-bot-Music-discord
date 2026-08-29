import { SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Command } from '../../structures/Command';
import { db } from '../../database/db';
import { createSuccessEmbed, createErrorEmbed } from '../../utils/embeds';

const configCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Mengatur konfigurasi server.')
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
    ),
  execute: async (interaction: ChatInputCommandInteraction, client) => {
    const subcommand = interaction.options.getSubcommand();
    
    await interaction.deferReply();

    const settings = await db.guildSettings.findUnique({ where: { guildId: interaction.guildId! } });
    if (!settings) {
      await db.guildSettings.create({ data: { guildId: interaction.guildId! } });
    }

    if (subcommand === 'djrole') {
      const role = interaction.options.getRole('role', true);
      await db.guildSettings.update({
        where: { guildId: interaction.guildId! },
        data: { djRoleId: role.id },
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(`Role DJ berhasil disetel ke <@&${role.id}>.`)] });
    } else if (subcommand === 'mode247') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await db.guildSettings.update({
        where: { guildId: interaction.guildId! },
        data: { mode247: enabled },
      });
      await interaction.followUp({ embeds: [createSuccessEmbed(`Mode 24/7 berhasil ${enabled ? 'diaktifkan' : 'dimatikan'}.`)] });
    }
  },
};

export default configCommand;
