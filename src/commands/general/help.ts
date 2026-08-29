import { SlashCommandBuilder, ChatInputCommandInteraction, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder, ComponentType } from 'discord.js';
import { Command } from '../../structures/Command';
import { createBaseEmbed } from '../../utils/embeds';

const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Menampilkan pusat bantuan dan daftar perintah AURELIA.'),
  execute: async (interaction: ChatInputCommandInteraction) => {
    // Definisi Embed Beranda
    const homeEmbed = createBaseEmbed()
      .setTitle('✨ Pusat Bantuan AURELIA')
      .setDescription('Selamat datang di **AURELIA** — Bot Musik Discord Premium (Rolls-Royce Edition).\nAURELIA dirancang untuk memberikan kualitas audio tanpa kompromi, antarmuka elegan, dan fitur lengkap untuk komunitas Anda.\n\nSilakan pilih kategori di menu bawah untuk melihat panduan fitur.')
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
        { name: '`/play [lagu/link]`', value: 'Mencari dan memutar lagu dari YouTube/Spotify.' },
        { name: '`/np` (Now Playing)', value: 'Melihat lagu yang sedang diputar lengkap dengan *Progress Bar* visual.' },
        { name: '`/queue`', value: 'Melihat daftar antrean lagu saat ini. Dilengkapi tombol kontrol interaktif.' },
        { name: '`/pause` & `/resume`', value: 'Menjeda atau melanjutkan lagu.' },
        { name: '`/skip` & `/stop`', value: 'Melompati lagu saat ini, atau menghentikan musik sepenuhnya.' },
        { name: '`/volume [1-200]`', value: 'Mengatur tingkat volume musik.' },
        { name: '`/filter`', value: 'Menerapkan efek audio premium (Bassboost, Nightcore, Vaporwave, Karaoke).' }
      );

    // Definisi Embed Playlist & Favorit
    const playlistEmbed = createBaseEmbed()
      .setTitle('💾 Panduan Playlist & Favorit')
      .setDescription('Simpan dan putar lagu kesukaan Anda dengan mudah. Data disimpan secara global untuk akun Anda!')
      .addFields(
        { name: '`/favorite add`', value: 'Menyimpan lagu yang sedang diputar ke daftar favorit.' },
        { name: '`/favorite list`', value: 'Melihat seluruh lagu di daftar favorit Anda.' },
        { name: '`/favorite play`', value: 'Memuat seluruh lagu favorit Anda ke dalam antrean.' },
        { name: '`/playlist create [nama]`', value: 'Membuat folder playlist baru.' },
        { name: '`/playlist add [nama]`', value: 'Menyimpan lagu yang sedang diputar ke dalam playlist tertentu.' },
        { name: '`/playlist list`', value: 'Melihat daftar playlist yang Anda miliki.' },
        { name: '`/playlist play [nama]`', value: 'Memutar seluruh lagu dari playlist tertentu.' }
      );

    // Definisi Embed Pengaturan
    const configEmbed = createBaseEmbed()
      .setTitle('⚙️ Pengaturan & Administrator')
      .setDescription('Perintah khusus untuk mengatur perilaku bot di server ini.')
      .addFields(
        { name: '`/config djrole [@role]`', value: '*(Admin Only)* Menetapkan Role DJ. Jika diatur, hanya member dengan role ini yang bisa mengatur musik (Skip, Stop, Filter, dll).' },
        { name: '`/config mode247 [True/False]`', value: '*(Admin Only)* Menyalakan mode 24/7. Bot tidak akan keluar meskipun antrean habis atau voice channel kosong.' },
        { name: '`/config language [ID/EN]`', value: '*(Admin Only)* Mengubah bahasa bot untuk server ini.' },
        { name: '`/ping`', value: 'Mengecek kecepatan (latency) jaringan bot.' },
        { name: '`/eval`', value: '*(Owner Only)* Menjalankan kode JavaScript mentah (Developer Only).' }
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
          .setDescription('Panduan memutar dan mengontrol lagu.')
          .setEmoji('🎵')
          .setValue('music'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Playlist & Favorit')
          .setDescription('Panduan menyimpan lagu kesukaan.')
          .setEmoji('💾')
          .setValue('playlist'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Pengaturan (Config)')
          .setDescription('Panduan mengubah bahasa, role DJ, dan 24/7.')
          .setEmoji('⚙️')
          .setValue('config')
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const message = await interaction.reply({
      embeds: [homeEmbed],
      components: [row],
      ephemeral: true, // Help command biasanya ephemeral agar tidak menuh-menuhin chat
      fetchReply: true,
    });

    const collector = message.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 300000 }); // 5 menit

    collector.on('collect', async (i) => {
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
      await interaction.editReply({ components: [disabledRow] }).catch(() => {});
    });
  },
};

export default helpCommand;
