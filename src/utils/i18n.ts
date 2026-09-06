import { db } from '../database/db';
import { redis } from '../database/redis';
import { logger } from './logger';

export type Language = 'id' | 'en';

const dictionaries = {
  id: {
    nowPlaying: '🎶 Now Playing',
    addedToQueue: '📥 Ditambahkan ke antrean',
    queueEmpty: 'Antrean kosong',
    autoLeave: '👋 Antrean telah habis dan mode 24/7 nonaktif, keluar dari voice channel...',
    autoLeaveAlone: '👋 Karena voice channel kosong, bot telah keluar (Mode 24/7 nonaktif).',
    noVoiceChannel: '❌ Kamu harus berada di voice channel terlebih dahulu!',
    noNode: '❌ Tidak ada node audio Lavalink yang tersedia saat ini.',
    noPlaying: '❌ Tidak ada lagu yang sedang diputar.',
    djRequired: '❌ Kamu membutuhkan role DJ untuk menggunakan perintah ini.',
    configUpdated: '✅ Pengaturan berhasil diperbarui.',
    errorExecuting: '❌ Terjadi kesalahan saat menjalankan perintah ini!',
  },
  en: {
    nowPlaying: '🎶 Now Playing',
    addedToQueue: '📥 Added to queue',
    queueEmpty: 'Queue is empty',
    autoLeave: '👋 Queue has ended and 24/7 mode is disabled, leaving voice channel...',
    autoLeaveAlone: '👋 The voice channel is empty, leaving voice channel (24/7 mode disabled).',
    noVoiceChannel: '❌ You must be in a voice channel first!',
    noNode: '❌ No Lavalink audio node is currently available.',
    noPlaying: '❌ No track is currently playing.',
    djRequired: '❌ You need the DJ role to use this command.',
    configUpdated: '✅ Configuration successfully updated.',
    errorExecuting: '❌ There was an error while executing this command!',
  },
};

export async function getLanguage(guildId: string): Promise<Language> {
  const cacheKey = `guild_lang:${guildId}`;
  
  try {
    // 1. Cek di Redis (Super Cepat)
    const cachedLang = await redis.get(cacheKey);
    if (cachedLang) {
      return cachedLang as Language;
    }
  } catch {
    logger.warn(`Redis Cache miss/error untuk guild ${guildId}`);
  }

  // 2. Jika tidak ada di Redis, cari di PostgreSQL
  const settings = await db.guildSettings.findUnique({ where: { guildId } });
  const lang = (settings?.language as Language) || 'id';

  try {
    // 3. Simpan hasil ke Redis selama 1 Jam (3600 detik) agar tidak membebani DB lagi
    await redis.set(cacheKey, lang, 'EX', 3600);
  } catch {
    // Abaikan jika Redis gagal menyimpan
  }

  return lang;
}

export function t(key: keyof typeof dictionaries['id'], lang: Language = 'id'): string {
  return dictionaries[lang][key] || dictionaries['id'][key];
}
