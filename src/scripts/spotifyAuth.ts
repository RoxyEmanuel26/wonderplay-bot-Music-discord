import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';

const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
const redirectUri = process.env.SPOTIFY_REDIRECT_URI?.trim() || 'http://127.0.0.1:8888/callback';

if (!clientId || !clientSecret) {
  throw new Error('Isi SPOTIFY_CLIENT_ID dan SPOTIFY_CLIENT_SECRET terlebih dahulu.');
}

const redirect = new URL(redirectUri);
if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(redirect.hostname)) {
  throw new Error('Untuk alat lokal ini, SPOTIFY_REDIRECT_URI harus memakai http://127.0.0.1 atau http://localhost.');
}

const state = crypto.randomBytes(24).toString('hex');
const scopes = ['playlist-read-private', 'playlist-read-collaborative'];
const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
authorizeUrl.search = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: scopes.join(' '),
  state,
  show_dialog: 'true',
}).toString();

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', redirectUri);
    if (requestUrl.pathname !== redirect.pathname) {
      response.writeHead(404).end('Not found');
      return;
    }
    if (requestUrl.searchParams.get('state') !== state) {
      response.writeHead(400).end('State OAuth tidak cocok. Tutup halaman ini dan coba lagi.');
      return;
    }
    const code = requestUrl.searchParams.get('code');
    if (!code) {
      response.writeHead(400).end(`Spotify menolak otorisasi: ${requestUrl.searchParams.get('error') || 'kode tidak tersedia'}`);
      return;
    }

    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    const token = await tokenResponse.json() as { refresh_token?: string; error_description?: string };
    if (!tokenResponse.ok || !token.refresh_token) {
      throw new Error(token.error_description || `Spotify token endpoint mengembalikan ${tokenResponse.status}`);
    }

    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Otorisasi berhasil. Kembali ke terminal dan simpan refresh token Anda.');
    // This is intentionally printed only to the user's local terminal. Treat it
    // like a password and never paste it into chat, logs, or Git.
    process.stdout.write(`\nSPOTIFY_REFRESH_TOKEN=${token.refresh_token}\n`);
    server.close();
  } catch (error) {
    response.writeHead(500).end(error instanceof Error ? error.message : 'OAuth gagal');
    server.close();
  }
});

server.listen(Number(redirect.port || 80), redirect.hostname, () => {
  process.stdout.write('Buka URL berikut pada browser dan login dengan akun Spotify pemilik aplikasi:\n\n');
  process.stdout.write(`${authorizeUrl.toString()}\n\n`);
  process.stdout.write(`Menunggu callback di ${redirectUri} ...\n`);
});
