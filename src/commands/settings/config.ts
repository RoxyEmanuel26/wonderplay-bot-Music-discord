import {  SlashCommandBuilder, PermissionFlagsBits  } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createErrorEmbed } from '../../utils/embeds';
import { PermissionsBitField } from 'discord.js';
import { Language } from '../../utils/i18n'; '../../structures/Command';
import { createSuccessEmbed } from '../../utils/embeds';
import { db } from '../../database/db';
import { redis } from '../../database/redis';

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
  aliases: ['cfg', 'setting'],
  execute: async (ctx: Context) => {
    // Check Admin Permissions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const member = ctx.member as any;
    if (ctx.isInteraction && ctx.interaction!.memberPermissions && !ctx.interaction!.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      await ctx.reply({ embeds: [createErrorEmbed('Hanya Administrator yang dapat menggunakan perintah ini.')], ephemeral: true });
      return;
    }
    if (!ctx.isInteraction && !member?.permissions?.has(PermissionsBitField.Flags.Administrator)) {
      await ctx.reply({ embeds: [createErrorEmbed('Hanya Administrator yang dapat menggunakan perintah ini.')], ephemeral: true });
      return;
    }

    const subcommand = ctx.isInteraction ? ctx.interaction!.options.getSubcommand() : ctx.args[0];

    if (subcommand === 'djrole') {
      let roleId = '';
      if (ctx.isInteraction) {
        const role = ctx.interaction!.options.getRole('role', true);
        roleId = role.id;
      } else {
        const roleArg = ctx.args[1];
        if (!roleArg) return;
        roleId = roleArg.replace(/<@&|>/g, '');
      }

      await db.guildSettings.upsert({
        where: { guildId: ctx.guildId! },
        update: { djRoleId: roleId },
        create: { guildId: ctx.guildId!, djRoleId: roleId },
      });

      // Hapus cache lama di Redis agar sistem langsung menyesuaikan
      try {
        await redis.del(`guild_dj:${ctx.guildId!}`);
      } catch (err) {}

      await ctx.reply({ embeds: [createSuccessEmbed(`Role DJ telah diatur ke <@&${roleId}>.`)] });

    } else if (subcommand === 'mode247') {
      let enabled = false;
      if (ctx.isInteraction) {
        enabled = ctx.interaction!.options.getBoolean('enabled', true);
      } else {
        enabled = ctx.args[1] === 'true' || ctx.args[1] === 'on';
      }

      await db.guildSettings.upsert({
        where: { guildId: ctx.guildId! },
        update: { mode247: enabled },
        create: { guildId: ctx.guildId!, mode247: enabled },
      });
      await ctx.reply({ embeds: [createSuccessEmbed(`Mode 24/7 telah **${enabled ? 'Diaktifkan' : 'Dinonaktifkan'}**.`)] });
      
    } else if (subcommand === 'language') {
      let langStr = '';
      if (ctx.isInteraction) {
        langStr = ctx.interaction!.options.getString('lang', true);
      } else {
        langStr = ctx.args[1];
      }
      
      const lang = langStr as Language;
      
      await db.guildSettings.upsert({
        where: { guildId: ctx.guildId! },
        update: { language: lang },
        create: { guildId: ctx.guildId!, language: lang },
      });
      
      // Hapus cache lama di Redis agar sistem langsung menyesuaikan
      try {
        await redis.del(`guild_lang:${ctx.guildId!}`);
      } catch (err) {}

      const response = lang === 'id' ? 'Bahasa berhasil diubah ke **Indonesia**.' : 'Language successfully changed to **English**.';
      await ctx.reply({ embeds: [createSuccessEmbed(response)] });
    }
  },
};

export default configCommand;
