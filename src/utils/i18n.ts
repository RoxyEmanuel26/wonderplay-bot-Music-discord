type Language = 'id' | 'en';

const dictionaries = {
  id: {
    nowPlaying: '🎶 Sedang diputar',
    addedToQueue: 'Ditambahkan ke antrean',
    queueEmpty: 'Antrean kosong',
    autoLeave: '👋 Antrean telah habis dan mode 24/7 nonaktif, keluar dari voice channel...',
    noVoiceChannel: 'Kamu harus berada di voice channel terlebih dahulu!',
    noNode: 'Tidak ada node Lavalink yang tersedia saat ini.',
  },
  en: {
    nowPlaying: '🎶 Now playing',
    addedToQueue: 'Added to queue',
    queueEmpty: 'Queue is empty',
    autoLeave: '👋 Queue has ended and 24/7 mode is disabled, leaving voice channel...',
    noVoiceChannel: 'You must be in a voice channel first!',
    noNode: 'No Lavalink node is currently available.',
  },
};

let currentLang: Language = 'id';

export function setLanguage(lang: Language) {
  currentLang = lang;
}

export function t(key: keyof typeof dictionaries['id']): string {
  return dictionaries[currentLang][key];
}
