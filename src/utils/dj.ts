import { ChatInputCommandInteraction, ButtonInteraction, PermissionsBitField } from 'discord.js';
import { db } from '../database/db';
import { redis } from '../database/redis';

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

  const cacheKey = `guild_dj:${interaction.guildId}`;
  let djRoleId: string | null = null;
  let cacheHit = false;

  try {
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      djRoleId = cached === 'none' ? null : cached;
      cacheHit = true;
    }
  } catch {
    /* ignore */
  }

  if (!cacheHit) {
    const settings = await db.guildSettings.findUnique({
      where: { guildId: interaction.guildId }
    });
    djRoleId = settings?.djRoleId || null;

    try {
      await redis.set(cacheKey, djRoleId || 'none', 'EX', 3600);
    } catch {
      /* ignore */
    }
  }

  if (!djRoleId) {
    return true;
  }

  // Cek kepemilikan role
  if ('roles' in interaction.member) {
    if (Array.isArray(interaction.member.roles)) {
      // APIInteractionGuildMember
      return interaction.member.roles.includes(djRoleId);
    } else {
      // GuildMember (GuildMemberRoleManager)
      return interaction.member.roles.cache.has(djRoleId);
    }
  }

  return false;
}
