import { ChatInputCommandInteraction, ButtonInteraction, PermissionsBitField } from 'discord.js';
import { db } from '../database/db';

/**
 * Mengecek apakah pengguna memiliki izin DJ.
 * Administrator server akan selalu mengembalikan true.
 * Jika peran DJ belum di-set di server, semua orang dianggap memiliki izin.
 */
export async function hasDJPermissions(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<boolean> {
  if (!interaction.guildId || !interaction.member) return false;

  // Cek admin permission via properti memberPermissions (Slash) atau member.permissions (Prefix)
  const isSlashAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
  const isPrefixAdmin = ('permissions' in interaction.member) && typeof (interaction.member as any).permissions?.has === 'function' && (interaction.member as any).permissions.has(PermissionsBitField.Flags.Administrator);

  if (isSlashAdmin || isPrefixAdmin) {
    return true;
  }

  const settings = await db.guildSettings.findUnique({
    where: { guildId: interaction.guildId }
  });

  if (!settings || !settings.djRoleId) {
    return true;
  }

  // Cek kepemilikan role
  if ('roles' in interaction.member) {
    if (Array.isArray(interaction.member.roles)) {
      // APIInteractionGuildMember
      return interaction.member.roles.includes(settings.djRoleId);
    } else {
      // GuildMember (GuildMemberRoleManager)
      return interaction.member.roles.cache.has(settings.djRoleId);
    }
  }

  return false;
}
