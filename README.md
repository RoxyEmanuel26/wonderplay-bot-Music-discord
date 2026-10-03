# 🎵 AURELIA Music Bot (Premium Edition)

Aurelia adalah bot musik Discord premium berspesifikasi Rolls-Royce yang dibangun di atas **Node.js, TypeScript, Lavalink v4, dan PostgreSQL**.

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
Kami menyediakan konfigurasi `docker-compose` komplit sehingga seluruh sistem (Bot, Lavalink, Postgres, Redis) bisa menyala dalam 1 perintah.

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
halaman dan tidak ikut dihapus ketika panel diperbarui. URL API dapat diganti secara
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

YouTube dapat meminta login atau memblokir client tertentu sewaktu-waktu. Konfigurasi
Lavalink menyertakan beberapa client playback (`ANDROID_VR`, `ANDROID_MUSIC`, `IOS`,
`WEB`, `MWEB`, `WEBEMBEDDED`, dan `TVHTML5_SIMPLY`). Bot otomatis mencoba ulang video
asli pada node cadangan. Jika video ID yang sama gagal di seluruh node tetapi metadata
masih tersedia, bot mencari upload YouTube Music/YouTube lain dengan judul dan artis
yang sama agar antrean tidak berhenti. Panel menandai saat audio dialihkan ke upload
alternatif. Jika node milik sendiri tetap sering menerima pesan
`This video requires login`, OAuth dapat diaktifkan melalui variabel
`YOUTUBE_OAUTH_*` di `.env`. Gunakan akun cadangan karena integrasi ini dapat terkena
rate limit atau penangguhan akun. Secara default bot berjalan dalam mode Lavalink
pribadi saja (`LAVALINK_PRIVATE_ONLY=true` dan `LAVALINK_USE_PUBLIC_NODES=false`).
Pengaman `LAVALINK_PRIVATE_ONLY` juga mencegah nilai lama dari environment panel
hosting mengaktifkan Node-2/Node-3. Untuk mengaktifkan node publik lagi, kedua nilai
harus sengaja diubah menjadi `LAVALINK_PRIVATE_ONLY=false` dan
`LAVALINK_USE_PUBLIC_NODES=true`.

Dalam mode pribadi saja, panel hanya akan menampilkan `Node-1 (Custom/Local)`. Jika
node pribadi mati atau tidak dapat mengambil stream YouTube, current track dan queue
dipertahankan dalam status `RECOVERING`; bot tidak akan mengirim audio atau metadata
ke Lavalink publik.

Log `1006` atau `ECONNREFUSED host:port` berarti proses Lavalink lokal tidak dapat
dijangkau pada host/port yang dikonfigurasi (umumnya service mati, port salah, atau
firewall/panel belum membuka alokasi). Itu bukan kerusakan antrean; selama node publik
aktif, bot akan mempertahankan queue dan mencoba melanjutkan playback pada fallback.
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

### Deployment Lavalink di VPS / Pterodactyl

Folder `lavalink/` ditujukan untuk Lavalink `4.2.2` dengan Java 17 atau lebih baru.
Konfigurasi membaca port alokasi panel dari `SERVER_PORT` (contohnya `19135` pada
panel), sehingga port tidak perlu ditulis permanen ke `application.yml`.

Tambahkan variabel berikut di panel VPS Lavalink:

```env
LAVALINK_SERVER_PASSWORD=password_yang_sama_dengan_bot
LAVASRC_SPOTIFY_ENABLED=true
SPOTIFY_CLIENT_ID=id_aplikasi_spotify
SPOTIFY_CLIENT_SECRET=secret_aplikasi_spotify
SPOTIFY_COUNTRY_CODE=ID
SPOTIFY_SP_DC=opsional_dan_bukan_pengganti_refresh_token_oauth
```

Jika bot dan Lavalink berada pada dua server NuraHost yang berbeda, environment
keduanya **tidak dibagikan otomatis**. Isi `LAVALINK_SERVER_PASSWORD` pada server
Lavalink dan `LAVALINK_PASSWORD` pada server bot dengan karakter yang persis sama,
tanpa tanda kutip atau spasi tambahan. Respons WebSocket `401` disertai log
`Authentication failed` berarti host dan port sudah benar, tetapi kedua nilai
password tersebut berbeda. Setelah mengubahnya, restart Lavalink terlebih dahulu,
tunggu log `Lavalink is ready to accept connections`, lalu restart bot.

Bot memakai interval reconnect dalam satuan detik. Nilai berikut mempertahankan
reconnect cepat dan memulai siklus baru bila seluruh percobaan awal habis:

```env
LAVALINK_RECONNECT_TRIES=12
LAVALINK_RECONNECT_INTERVAL_SECONDS=5
LAVALINK_RECONNECT_CYCLE_DELAY_MS=30000
```

Spotify Development Mode tetap membatasi Web API ke pemilik aplikasi yang memiliki
Premium aktif; bot tidak mencoba melewati pembatasan tersebut. `spDc` LavaSrc bukan
pengganti OAuth playlist dan terutama digunakan untuk fitur token akun/lirik. Karena
client secret dan cookie yang lama sudah pernah ditampilkan, rotasi client secret dan
logout seluruh sesi Spotify sebelum menggunakan konfigurasi baru.
Setelah mengganti plugin atau konfigurasi, lakukan restart penuh pada
Lavalink dan restart bot agar tidak ada encoded track lama dari versi/source manager
yang berbeda.

Konfigurasi lokal memakai Opus quality 10, resampler `HIGH`, seek ghosting, serta
buffer yang lebih tahan jitter. Volume bot dibatasi 0–100% untuk mencegah clipping.
Kualitas akhir tetap dibatasi sumber audio dan bitrate voice Discord; panel menampilkan
bitrate serta peringatan jika rendah, tetapi bot tidak mengubah setting channel.

Pada log startup, pastikan plugin `lavasrc-plugin-4.8.3` dan
`youtube-plugin-1.18.2` berhasil dimuat. Endpoint `/v4/info` juga harus menampilkan
plugin `lavasrc` dan `youtube`. Bila LavaSrc tidak terlihat, URL Spotify akan jatuh ke
HTTP source biasa dan menghasilkan `Unknown file format`.

### Health-check deployment

Jalankan pemeriksaan read-only berikut sebelum menyalakan bot atau setelah mengganti
environment:

```bash
npm run healthcheck
```

Perintah ini memvalidasi PostgreSQL, Redis, token Discord, `/version` dan `/v4/info`
Lavalink, resolve URL/pencarian YouTube, resolve track Spotify, Spotify oEmbed/OAuth,
dan LRCLIB tanpa membuka koneksi voice atau login sebagai proses bot kedua. Jika
Lavalink menghasilkan `401`/`403`, samakan `LAVALINK_PASSWORD` pada bot dengan nilai
efektif `LAVALINK_SERVER_PASSWORD` di panel Lavalink, lalu restart penuh kedua service.

## 💻 Panduan Pengembangan (Development)
Jika Anda ingin mengubah kode (Developer Mode):

1. Pastikan Anda sudah menjalankan infrastruktur database dan Lavalink:
   ```bash
   docker-compose up -d postgres redis lavalink
   ```
2. Jalankan bot di mode pengembangan:
   ```bash
   npm install
   npx prisma db push
   npm run dev
   ```

---
*Dibuat menggunakan spesifikasi arsitektur Antigravity.*
