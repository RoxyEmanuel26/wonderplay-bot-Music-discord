# 🎵 AURELIA Music Bot (Premium Edition)

Aurelia adalah bot musik Discord premium berspesifikasi Rolls-Royce yang dibangun di atas **Node.js, TypeScript, Lavalink v4, dan PostgreSQL**.

## ✨ Fitur Utama
- **Lavalink v4 Engine**: Menggunakan Shoukaku. Sangat stabil dan hemat resource.
- **Support YouTube & Spotify**: Memutar lagu langsung dari sumber populer tanpa hambatan.
- **Audio Filters**: Bassboost, Nightcore, Vaporwave, Karaoke secara realtime!
- **Mode 24/7 & Auto-leave**: Bot akan tetap stay di voice channel selama yang diinginkan.
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
