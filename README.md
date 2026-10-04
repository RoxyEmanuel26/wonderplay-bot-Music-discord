# 🎵 Aerys Music Bot (Premium Edition)

Aerys adalah bot musik Discord yang dibangun di atas **Node.js, TypeScript, Lavalink v4, dan PostgreSQL**.

## ✨ Fitur Utama
- **Lavalink v4 Engine**: Menggunakan Shoukaku. Sangat stabil dan hemat resource.
- **Support YouTube & Spotify**: Resolusi multi-node dengan failover ketika sebuah node gagal memutar track.
- **Audio Filters**: Bassboost, Nightcore, Vaporwave, Karaoke secara realtime!
- **Voice Persisten**: Bot tetap berada di voice sampai `/disconnect`, tombol Disconnect, atau dikeluarkan manual.
- **Custom Playlists**: Pengguna bisa membuat dan memutar playlist sendiri (tersimpan di PostgreSQL).
- **UI Interaktif Premium**: Menggunakan Embed bertema Emas-Hitam elegan dilengkapi *Buttons* interaktif dan *Unicode Progress Bar*.
- **Observability**: Built-in sistem Healthcheck, Express API Dashboard, Pino Logger, dan Admin `/eval`.

## 🛠️ Tech Stack
- **Language**: TypeScript & Node.js 20+
- **Library Discord**: discord.js v14
- **Music Client**: shoukaku v4
- **Database**: PostgreSQL (Via Prisma ORM)
- **Cache**: Redis
- **Container**: Docker & Docker Compose

## 🚀 Instalasi & Deployment (Production)
Docker Compose menjalankan bot, Postgres, dan Redis. Bot memakai node Lavalink publik; server Lavalink pribadi tidak diperlukan.

1. **Clone repository ini**
2. **Setup Environment**:
   Salin file `.env.example` menjadi `.env` lalu isi token Discord Anda.
   ```bash
   cp .env.example .env
   ```
3. **Deploy dengan Docker Compose**:
   ```bash
   docker-compose up -d --build
   ```

Setelah perintah ini, bot Anda siap melayani di Discord! Server dashboard API juga akan menyala di `http://localhost:3000`.

### Channel Request Musik Tanpa Command

Atur channel request musik melalui `.env`:

```env
MUSIC_REQUEST_CHANNEL_ID=1343831026316742688
```

Di channel tersebut, pengguna cukup mengirim URL lagu/playlist atau kata kunci
seperti `lagu sedih` tanpa prefix dan tanpa slash command. Pengguna wajib berada di
voice channel yang sama dengan bot jika antrean sudah aktif. Pesan asli tetap
dipertahankan, sedangkan bot mengirim konfirmasi antrean dan panel Now Playing.

Panel kontrol ditampilkan pada channel request dan open chat voice channel bot.
Panel lama otomatis diganti agar kontrol selalu menjadi pesan terbaru. Hanya pengguna
yang berada di voice channel yang sama yang dapat memakai dropdown antrean dan 15
tombol untuk pause/resume, previous/next, loop, volume, seek, lirik, mute,
shuffle, clear queue, filter, serta disconnect.

Tombol **Lirik** mengambil lirik langsung dari LRCLIB dan mengirimkannya sebagai
embed publik ke open chat voice channel. Lirik panjang dibagi menjadi beberapa
halaman dan tidak ikut dihapus ketika panel diperbarui. Untuk lirik non-Latin,
bot menambahkan bacaan huruf Latin di bawah setiap baris asli. Bahasa Jepang
dibaca menggunakan kamus lokal Kuromoji agar kanji dapat menjadi romaji;
aksara lain memakai transliterasi Unicode lokal. Hasil otomatis dapat keliru
untuk nama, dialek, bahasa campuran, atau aksara yang belum didukung; teks asli
selalu dipertahankan. Pustaka lokal tersebut tidak mengirim lirik ke layanan
romanisasi eksternal. URL API lirik dapat diganti secara
opsional melalui:

```env
LYRICS_API_URL=https://lrclib.net
```

Bot harus memiliki izin **Send Messages** dan **Embed Links** pada open chat voice.
LRCLIB tidak memerlukan API key. Command `/favorite` dan data favorit tetap tersedia;
yang diganti hanya tombol Favorite pada panel.

Pastikan **Message Content Intent** diaktifkan pada Discord Developer Portal agar bot
dapat membaca isi pesan di channel request.

### Catatan YouTube

YouTube dapat meminta login atau memblokir client tertentu sewaktu-waktu. Bot otomatis mencoba ulang video
asli pada node publik lain. Jika video ID yang sama gagal di seluruh node tetapi metadata
masih tersedia, bot lebih dulu mencari mirror SoundCloud yang cocok, kemudian upload
YouTube Music/YouTube lain dengan judul, artis, dan durasi yang serupa agar antrean
tidak berhenti. Panel menandai sumber audio fallback yang dipakai. Bot tidak lagi
mendaftarkan Lavalink pribadi meskipun variabel `LAVALINK_URL`, `LAVALINK_PASSWORD`,
`LAVALINK_PRIVATE_ONLY`, atau `LAVALINK_USE_PUBLIC_NODES` masih tertinggal di panel hosting.

Prioritas default: **Serenetia TLS (Node-3)**, Jirayu TLS, MilloHost TLS,
lalu Serenetia HTTP sebagai cadangan protokol terakhir. Node-2 (MilloHost)
ditempatkan setelah dua TLS lain karena audio dilaporkan tersendat pada server
pengguna; kegagalan yang terdeteksi tetap mengubah ranking secara otomatis.
Pada 3 Oktober 2026,
semuanya memberi event WebSocket `ready` dan tiga node TLS dapat me-resolve
URL YouTube serta Spotify pada pengujian metadata. TriniumHost dihapus karena
REST `/v4/info` menjawab 200 tetapi WebSocket terus menutup dengan kode 1006.
Server publik dapat berubah atau berhenti tanpa pemberitahuan; bot akan melewati
node yang tidak sehat. Jangan mengirim kredensial pribadi ke node publik.

Pemilihan node kini mempertimbangkan koneksi aktif, dukungan sumber YouTube atau
Spotify, penalti Lavalink, latensi resolve, serta kegagalan playback selama 10
menit terakhir. Kegagalan pada satu sumber hanya menurunkan prioritas node untuk
sumber tersebut. Jika stream Spotify gagal setelah metadata berhasil dimuat,
bot mencoba node lain lalu mencari mirror YouTube Music yang cocok. Track antrean
di-resolve ulang ketika encoding berasal dari node yang berbeda. Posisi lokal
direset pada pergantian lagu, dan watchdog memajukan antrean jika track berdurasi
jelas berhenti dekat ujung tanpa event `end` selama 15 detik. Livestream dan pause
tidak dipaksa maju.

`/v4/loadtracks` yang berhasil hanya membuktikan metadata video dapat dibaca; itu
belum membuktikan URL audio dapat diambil. Gejala `AllClientsFailedException`,
`This video requires login`, atau `No supported audio streams available` berasal
dari pembatasan YouTube terhadap client/IP Lavalink, bukan dari PostgreSQL.
Fallback SoundCloud memungkinkan antrean terus berjalan ketika tersedia kecocokan yang cukup kuat.
Fallback ini terutama berguna untuk musik. Video non-musik panjang, vlog, berita,
atau video kuliner biasanya tidak mempunyai mirror SoundCloud yang cocok. Jika tidak
ada kandidat aman, bot mempertahankan track dalam status `RECOVERING` dan tidak lagi
menghapusnya atau mengubah panel menjadi `IDLE`.

Log `1006` atau `ECONNREFUSED host:port` berarti sebuah node tidak dapat
dijangkau. Bot mencoba node publik lain tanpa menghapus antrean.
Jika seluruh node offline, panel berubah ke `RECOVERING`; current track dan antrean
tidak dibuang. Retry berjalan 5, 10, 20, lalu tiap 30 detik sampai node kembali.

### Spotify tanpa Premium dan pemulihan sesi

Track tunggal Spotify dapat diputar tanpa akun Premium dengan mengambil metadata
resmi dari Spotify oEmbed, kemudian mencari audio yang cocok melalui YouTube Music
dan YouTube. Audio ini adalah mirror, bukan stream audio Spotify. Playlist dan album
Spotify pertama-tama dicoba melalui LavaSrc. Jika LavaSrc menerima `401`, bot memakai
OAuth pengguna Spotify resmi lalu mencerminkan setiap track ke YouTube Music. Bot
tidak melakukan scraping playlist.

```env
SPOTIFY_TRACK_FALLBACK_ENABLED=true
SPOTIFY_REFRESH_TOKEN=refresh_token_rahasia
SPOTIFY_PLAYLIST_MAX_TRACKS=500
SPOTIFY_MIRROR_CONCURRENCY=3
PLAYBACK_RECOVERY_ENABLED=true
PLAYBACK_CHECKPOINT_INTERVAL_MS=5000
PLAYBACK_PERSISTENCE_ENABLED=true
```

Untuk membuat refresh token, tambahkan redirect URI
`http://127.0.0.1:8888/callback` pada Spotify Developer Dashboard, isi client ID dan
client secret baru di `.env`, lalu jalankan `npm run spotify:auth` pada komputer lokal.
Buka URL yang ditampilkan, login memakai akun Premium pemilik aplikasi, kemudian
simpan output `SPOTIFY_REFRESH_TOKEN` ke environment bot. Jangan kirim token tersebut
ke chat atau commit ke Git.

Sejak perubahan Spotify Development Mode Februari 2026, isi playlist hanya tersedia
untuk playlist yang dimiliki atau dikolaborasikan oleh pengguna OAuth. Menyalin
playlist publik milik pihak lain ke library tidak mengubah kepemilikan; buat salinan
playlist milik akun Anda jika perlu. Scope yang diminta bot adalah
`playlist-read-private` dan `playlist-read-collaborative`.

Sesi aktif disimpan di tabel `PlaybackSession`. Setelah deploy perubahan schema,
jalankan `npx prisma db push`. Saat bot restart, bot menunggu Discord dan minimal satu
node Lavalink siap, lalu otomatis rejoin dan melanjutkan posisi terakhir. `/stop`
hanya menghentikan musik dan membersihkan antrean; `/disconnect` adalah perintah yang
mengeluarkan bot serta menghapus sesi.

`PLAYBACK_PERSISTENCE_ENABLED` harus tetap `true` pada deployment. Test suite
mematikannya di proses test agar guild palsu seperti `guild` tidak pernah masuk ke
database. Saat startup, snapshot dengan guild/voice ID yang bukan Discord snowflake
akan dibuang otomatis sebelum bot mencoba memanggil Discord API.

### Lavalink publik saja

Bot memakai daftar node publik di `src/config/lavalinkNodes.ts`. Folder `lavalink/`
tidak dipakai oleh bot dan tetap diabaikan Git sebagai arsip konfigurasi pribadi.
Mengubah atau mematikan server Lavalink pribadi tidak diperlukan agar bot beralih:
deploy kode bot terbaru dan restart proses bot. Jika pernah menyimpan kredensial
Lavalink pribadi di panel bot, variabelnya boleh dihapus; kode tidak membacanya.

Bot memakai interval reconnect dalam satuan detik. Nilai berikut mempertahankan
reconnect cepat dan memulai siklus baru bila seluruh percobaan awal habis:

```env
LAVALINK_RECONNECT_TRIES=12
LAVALINK_RECONNECT_INTERVAL_SECONDS=5
LAVALINK_RECONNECT_CYCLE_DELAY_MS=30000
LAVALINK_REST_TIMEOUT_SECONDS=12
```

`LAVALINK_REST_TIMEOUT_SECONDS` memakai satuan **detik** sesuai Shoukaku.
Nilai lama `restTimeout: 10000` berarti 10.000 detik, sehingga node yang
tidak merespons dapat membuat `/play` dan transisi ke lagu berikutnya tampak macet.

Setelah retry internal Shoukaku habis, watchdog bot membuat ulang objek node dan
memulai siklus berikutnya tanpa batas. Jika semua node publik tidak tersedia,
antrean berada dalam status pemulihan sampai ada node yang kembali.

Spotify Development Mode tetap membatasi Web API ke pemilik aplikasi yang memiliki
Premium aktif; bot tidak mencoba melewati pembatasan tersebut. Karena client secret
dan cookie yang lama sudah pernah ditampilkan, rotasi client secret dan logout seluruh
sesi Spotify sebelum menggunakan konfigurasi baru.
Sejak pembatasan Development Mode 2026, isi playlist hanya tersedia bila akun OAuth
merupakan pemilik atau kolaborator playlist. Playlist publik milik akun lain dan
playlist yang hanya diikuti tidak dapat diimpor; salin lagu-lagunya ke playlist baru
milik akun OAuth sebelum mengirim link tersebut ke bot.
Setelah deploy, restart bot agar sesi lama di-resolve ulang pada node publik.
Volume bot dibatasi 0–100% untuk mencegah clipping.
Kualitas akhir tetap dibatasi sumber audio dan bitrate voice Discord; panel menampilkan
bitrate serta peringatan jika rendah, tetapi bot tidak mengubah setting channel.

Pada log startup, pastikan daftar `configuredNodes` hanya berisi node publik.
Ketersediaan plugin dan source manager bervariasi per operator node publik.

### Health-check deployment

Setiap deploy yang mengubah `package.json` harus menyertakan `package-lock.json`
dan menginstal ulang dependensi **di server bot**, bukan hanya di komputer lokal:

```bash
npm ci
npm run build
```

Kemudian restart proses bot. Jika server hanya menerima folder `dist` tanpa source,
jalankan `npm ci --omit=dev` setelah mengunggah `package.json` dan
`package-lock.json`, lalu restart. Paket `transliteration`, `kuroshiro`, dan
`kuroshiro-analyzer-kuromoji` dipakai untuk romanisasi lirik. Bila belum terpasang,
bot tetap dapat memuat command dan memainkan musik; tombol Lyrics menampilkan
lirik asli tanpa transliterasi sampai dependensi dipasang dan bot direstart.

Jalankan pemeriksaan read-only berikut sebelum menyalakan bot atau setelah mengganti
environment:

```bash
npm run healthcheck
```

Perintah ini memvalidasi PostgreSQL, Redis, token Discord, `/v4/info` **dan event
WebSocket `ready`** node-node publik, resolve URL/pencarian YouTube pada node tersedia,
pengambilan stream audio YouTube, pencarian
fallback SoundCloud, resolve track Spotify, Spotify oEmbed/OAuth, dan LRCLIB tanpa
membuka koneksi voice atau login sebagai proses bot kedua. Kegagalan stream YouTube
ditampilkan sebagai `WARN` (bot masih dapat memakai SoundCloud), bukan `PASS` palsu
hanya karena metadata tersedia. Jika node publik menghasilkan `401`/`403`, kredensial
yang dipublikasikan operator mungkin berubah; perbarui daftar node publik di kode.

## 💻 Panduan Pengembangan (Development)
Jika Anda ingin mengubah kode (Developer Mode):

1. Jalankan database dan Redis lokal; koneksi Lavalink memakai node publik:
   ```bash
   docker-compose up -d postgres redis
   ```
2. Jalankan bot di mode pengembangan:
   ```bash
   npm install
   npx prisma db push
   npm run dev
   ```

---
*Dibuat menggunakan spesifikasi arsitektur Antigravity.*
