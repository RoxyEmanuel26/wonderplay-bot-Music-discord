import { redis } from '../database/redis';

/**
 * Mengecek dan menetapkan cooldown untuk user.
 * @returns true jika user masih dalam masa cooldown (harus diblokir).
 * @returns false jika user boleh mengeksekusi perintah.
 */
export async function checkCooldown(userId: string, commandName: string, durationMs: number = 3000): Promise<boolean> {
  const cacheKey = `cooldown:${commandName}:${userId}`;
  
  try {
    // Gunakan argumen PX (milidetik) dan NX (Set only if Not eXists) untuk operasi atomik
    // Ini mencegah race condition (2 eksekusi masuk di milidetik yang persis sama)
    const result = await redis.set(cacheKey, '1', 'PX', durationMs, 'NX');
    
    if (result === 'OK') {
      return false; // Berhasil di-set, berarti belum cooldown (Diizinkan)
    } else {
      return true; // Gagal di-set karena sudah ada, berarti masih cooldown (Diblokir)
    }
  } catch {
    // Jika Redis mati, fallback biarkan user eksekusi agar bot tidak rusak
    return false;
  }
}
