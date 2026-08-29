import {  SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder, ComponentType  } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createBaseEmbed } from '../../utils/embeds';

const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Menampilkan pusat bantuan dan daftar perintah AURELIA.'),
  aliases: ['h'],
  execute: async (ctx: Context) => {
    // Definisi Embed Beranda
    const homeEmbed = createBaseEmbed()
      .setTitle('✨ Pusat Bantuan AURELIA')
      .setDescription('Selamat datang di **Aurelia** — Bot Musik Resmi untuk server Wonderplay.\n\n💡 **Dukungan Hibrida & Alias:** Seluruh perintah dapat dipanggil menggunakan *Slash Command* (contoh: `/play`) MAUPUN *Prefix* (contoh: `!play`). Anda juga bisa menggunakan **Alias Cepat** untuk Prefix:\n`!p` (play), `!q` (queue), `!s` (skip), `!v` (volume), `!pa` (pause), `!res` (resume), `!st` (stop), `!fav` (favorite), `!pl` (playlist), `!cfg` (config), `!h` (help).\n\nSilakan pilih kategori pada menu di bawah untuk melihat daftar perintah.')
      .addFields(
        { name: '🎵 Kualitas Audio', value: 'Didukung oleh Lavalink v4, menghadirkan audio sejernih kristal tanpa *lag*.' },
        { name: '🌍 Multi-Bahasa', value: 'Mendukung bahasa Indonesia & Inggris secara independen di tiap server.' },
        { name: '🛡️ Keamanan DJ', value: 'Sistem Role DJ canggih untuk mencegah penyalahgunaan antrean musik.' },
        { name: '🌐 Web Dashboard', value: 'Memiliki Web Panel bawaan untuk memantau status bot & statistik secara *real-time*.' }
      )
      .setFooter({ text: 'Gunakan menu tarik-turun (dropdown) di bawah ini.' });

    // Definisi Embed Musik
    const musicEmbed = createBaseEmbed()
      .setTitle('🎵 Panduan Perintah Musik')
      .setDescription('Daftar perintah utama untuk mengontrol pemutaran musik di voice channel.')
      .addFields(
        { name: '`/play` & `!play [lagu/link]`', value: 'Mencari dan memutar lagu dari YouTube/Spotify.' },
        { name: '`/np` & `!np` (Now Playing)', value: 'Melihat lagu yang sedang diputar lengkap dengan *Progress Bar* visual.' },
        { name: '`/queue` & `!queue`', value: 'Melihat daftar antrean lagu saat ini. Dilengkapi tombol kontrol interaktif.' },
        { name: '`/pause` & `!pause` | `/resume` & `!resume`', value: 'Menjeda atau melanjutkan lagu.' },
        { name: '`/skip` & `!skip` | `/stop` & `!stop`', value: 'Melompati lagu saat ini, atau menghentikan musik sepenuhnya.' },
        { name: '`/volume` & `!volume [1-200]`', value: 'Mengatur tingkat volume musik.' },
        { name: '`/filter` & `!filter`', value: 'Menerapkan efek audio (Bassboost, Nightcore, Vaporwave, Karaoke).' }
      );

    // Definisi Embed Playlist & Favorit
    const playlistEmbed = createBaseEmbed()
      .setTitle('💾 Panduan Playlist & Favorit')
      .setDescription('Simpan dan putar lagu kesukaan Anda dengan mudah. Data disimpan secara global untuk akun Anda!')
      .addFields(
        { name: '`/favorite add` & `!favorite add`', value: 'Menyimpan lagu yang sedang diputar ke daftar favorit.' },
        { name: '`/favorite list` & `!favorite list`', value: 'Melihat seluruh lagu di daftar favorit Anda.' },
        { name: '`/favorite play` & `!favorite play`', value: 'Memuat seluruh lagu favorit Anda ke dalam antrean.' },
        { name: '`/playlist create` & `!playlist create [nama]`', value: 'Membuat folder playlist baru.' },
        { name: '`/playlist add` & `!playlist add [nama]`', value: 'Menyimpan lagu yang sedang diputar ke dalam playlist tertentu.' },
        { name: '`/playlist list` & `!playlist list`', value: 'Melihat daftar playlist yang Anda miliki.' },
        { name: '`/playlist play` & `!playlist play [nama]`', value: 'Memutar seluruh lagu dari playlist tertentu.' }
      );

    // Definisi Embed Pengaturan
    const configEmbed = createBaseEmbed()
      .setTitle('⚙️ Pengaturan & Administrator')
      .setDescription('Perintah khusus untuk mengatur perilaku bot di server ini.')
      .addFields(
        { name: '`/config djrole` & `!config djrole [@role]`', value: '*(Admin Only)* Menetapkan Role DJ. Jika diatur, hanya member dengan role ini yang bisa mengatur musik (Skip, Stop, Filter, dll).' },
        { name: '`/config mode247` & `!config mode247 [True/False]`', value: '*(Admin Only)* Menyalakan mode 24/7. Bot tidak akan keluar meskipun antrean habis atau voice channel kosong.' },
        { name: '`/config language` & `!config language [ID/EN]`', value: '*(Admin Only)* Mengubah bahasa bot untuk server ini.' },
        { name: '`/ping` & `!ping`', value: 'Mengecek kecepatan (latency) jaringan bot.' },
        { name: '`/eval` & `!eval`', value: '*(Owner Only)* Menjalankan kode JavaScript mentah (Developer Only).' }
      );

    // Membuat Komponen Select Menu
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('help_menu')
      .setPlaceholder('📂 Pilih Kategori Bantuan...')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Beranda')
          .setDescription('Kembali ke halaman utama bantuan.')
          .setEmoji('🏠')
          .setValue('home'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Perintah Musik')
          .setDescription('Panduan memutar lagu (Slash & Prefix).')
          .setEmoji('🎵')
          .setValue('music'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Playlist & Favorit')
          .setDescription('Panduan menyimpan lagu (Slash & Prefix).')
          .setEmoji('💾')
          .setValue('playlist'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Pengaturan (Config)')
          .setDescription('Panduan admin & setting (Slash & Prefix).')
          .setEmoji('⚙️')
          .setValue('config')
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const message = await ctx.reply({
      embeds: [homeEmbed],
      components: [row],
      ephemeral: true, // Help command biasanya ephemeral agar tidak menuh-menuhin chat
      fetchReply: true,
    });

    const collector = message.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 300000 }); // 5 menit

    collector.on('collect', async (i: any) => {
      const value = i.values[0];
      
      let selectedEmbed = homeEmbed;
      switch (value) {
        case 'home': selectedEmbed = homeEmbed; break;
        case 'music': selectedEmbed = musicEmbed; break;
        case 'playlist': selectedEmbed = playlistEmbed; break;
        case 'config': selectedEmbed = configEmbed; break;
      }

      await i.update({ embeds: [selectedEmbed], components: [row] });
    });
    
    // Disable komponen setelah waktu habis agar tidak terjadi interaction failed
    collector.on('end', async () => {
      selectMenu.setDisabled(true);
      const disabledRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
      await ctx.editReply({ components: [disabledRow] }).catch(() => {});
    });
  },
};

export default helpCommand;
