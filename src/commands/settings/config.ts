import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createErrorEmbed, createSuccessEmbed } from '../../utils/embeds';
import { Language } from '../../utils/i18n';
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

    const subcommand = ctx.isInteraction ? ctx.interaction!.options.getSubcommand() : ctx.args[0]?.toLowerCase();

    if (!subcommand) {
      await ctx.reply({
        embeds: [
          createErrorEmbed(
            '**Panduan Pengaturan Konfigurasi Server:**\n' +
            '• `!config djrole <@role/roleId>` - Mengatur role DJ\n' +
            '• `!config mode247 <on/off>` - Mengatur mode standby 24/7\n' +
            '• `!config language <id/en>` - Mengubah bahasa bot'
          )
        ],
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'djrole') {
      let roleId: string;
      if (ctx.isInteraction) {
        const role = ctx.interaction!.options.getRole('role', true);
        roleId = role.id;
      } else {
        const roleArg = ctx.args[1];
        if (!roleArg) {
          await ctx.reply({ embeds: [createErrorEmbed('Mohon tentukan role DJ. Contoh: `!config djrole @DJ`')], ephemeral: true });
          return;
        }
        roleId = roleArg.replace(/<@&|>/g, '');
      }

      if (ctx.guild && !ctx.guild.roles.cache.has(roleId)) {
        await ctx.reply({ embeds: [createErrorEmbed('Role tidak ditemukan di server ini.')], ephemeral: true });
        return;
      }

      await db.guildSettings.upsert({
        where: { guildId: ctx.guildId! },
        update: { djRoleId: roleId },
        create: { guildId: ctx.guildId!, djRoleId: roleId },
      });

      // Hapus cache lama di Redis agar sistem langsung menyesuaikan
      try {
        await redis.del(`guild_dj:${ctx.guildId!}`);
      } catch {
        /* ignore */
      }

      await ctx.reply({ embeds: [createSuccessEmbed(`Role DJ telah berhasil diatur ke <@&${roleId}>.`)] });

    } else if (subcommand === 'mode247') {
      let enabled: boolean;
      if (ctx.isInteraction) {
        enabled = ctx.interaction!.options.getBoolean('enabled', true);
      } else {
        const arg = ctx.args[1]?.toLowerCase();
        if (!arg || !['true', 'on', 'yes', '1', 'false', 'off', 'no', '0'].includes(arg)) {
          await ctx.reply({ embeds: [createErrorEmbed('Mohon tentukan status mode 24/7. Contoh: `!config mode247 on` atau `!config mode247 off`')], ephemeral: true });
          return;
        }
        enabled = ['true', 'on', 'yes', '1'].includes(arg);
      }

      await db.guildSettings.upsert({
        where: { guildId: ctx.guildId! },
        update: { mode247: enabled },
        create: { guildId: ctx.guildId!, mode247: enabled },
      });
      await ctx.reply({ embeds: [createSuccessEmbed(`Mode 24/7 telah **${enabled ? 'Diaktifkan' : 'Dinonaktifkan'}**.`)] });
      
    } else if (subcommand === 'language') {
      let langStr: string | null | undefined;
      if (ctx.isInteraction) {
        langStr = ctx.interaction!.options.getString('lang', true);
      } else {
        langStr = ctx.args[1]?.toLowerCase();
      }

      if (!langStr || !['id', 'en'].includes(langStr)) {
        await ctx.reply({ embeds: [createErrorEmbed('Pilihan bahasa tidak valid. Pilih antara `id` (Indonesia) atau `en` (English). Contoh: `!config language id`')], ephemeral: true });
        return;
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
      } catch {
        /* ignore */
      }

      const response = lang === 'id' ? 'Bahasa berhasil diubah ke **Indonesia**.' : 'Language successfully changed to **English**.';
      await ctx.reply({ embeds: [createSuccessEmbed(response)] });
    } else {
      await ctx.reply({
        embeds: [createErrorEmbed('Subcommand tidak dikenal. Pilihan yang tersedia: `djrole`, `mode247`, `language`.')],
        ephemeral: true,
      });
    }
  },
};

export default configCommand;
