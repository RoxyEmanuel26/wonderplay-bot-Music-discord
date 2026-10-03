import { SlashCommandBuilder, StringSelectMenuBuilder, ActionRowBuilder, StringSelectMenuOptionBuilder, ComponentType, MessageFlags } from 'discord.js';
import { Context } from '../../structures/Context';
import { Command } from '../../structures/Command';
import { createBaseEmbed } from '../../utils/embeds';
import { AureliaClient } from '../../structures/AureliaClient';
import { getCommandPrefix } from '../../utils/commandPrefix';

const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Menampilkan pusat bantuan dan daftar perintah Aerys.'),
  aliases: ['h', 'commands', 'bantuan'],
  execute: async (ctx: Context, client: AureliaClient) => {
    const prefix = getCommandPrefix();
    const commandLabel = (name: string, suffix = ''): string => {
      const aliases = client.commands.get(name)?.aliases || [];
      const argumentsLabel = suffix ? ` ${suffix}` : '';
      const slash = `\`/${name}${argumentsLabel}\``;
      const prefixForms = [name, ...aliases]
        .map((alias) => `\`${prefix}${alias}${argumentsLabel}\``)
        .join(' · ');
      return `${slash} | ${prefixForms}`;
    };

    // Definisi Embed Beranda
    const homeEmbed = createBaseEmbed()
      .setTitle('✨ Pusat Bantuan Aerys')
      .setDescription(`Selamat datang di **Aerys** — bot musik untuk server Wonderplay.\n\nGunakan slash command seperti \`/play\` atau prefix \`${prefix}play\`. Alias hanya berlaku untuk prefix, misalnya \`${prefix}p\` dan \`${prefix}vol\`. Pilih kategori di bawah untuk melihat semua command dan alias yang tersedia.`)
      .addFields(
        { name: '🎵 Musik', value: `Kirim link atau judul lagu dengan \`${prefix}play\`, atau langsung di channel request musik.` },
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
        { name: commandLabel('play', '[lagu/link]'), value: 'Mencari dan memutar lagu dari YouTube/Spotify.' },
        { name: commandLabel('np'), value: 'Melihat lagu yang sedang diputar.' },
        { name: commandLabel('queue'), value: 'Melihat antrean lagu saat ini.' },
        { name: commandLabel('pause'), value: 'Menjeda lagu.' },
        { name: commandLabel('resume'), value: 'Melanjutkan lagu.' },
        { name: commandLabel('skip'), value: 'Melompati lagu saat ini.' },
        { name: commandLabel('stop'), value: 'Menghentikan musik dan membersihkan antrean tanpa keluar dari voice.' },
        { name: commandLabel('disconnect'), value: 'Mengeluarkan bot dari voice dan menghapus sesi playback.' },
        { name: commandLabel('volume', '[0-100]'), value: 'Mengatur volume.' },
        { name: commandLabel('filter'), value: 'Menerapkan efek audio.' }
      );

    // Definisi Embed Playlist & Favorit
    const playlistEmbed = createBaseEmbed()
      .setTitle('💾 Panduan Playlist & Favorit')
      .setDescription('Simpan dan putar lagu kesukaan Anda dengan mudah. Data disimpan secara global untuk akun Anda!')
      .addFields(
        { name: commandLabel('favorite', 'add'), value: 'Menyimpan lagu saat ini ke daftar favorit.' },
        { name: commandLabel('favorite', 'list'), value: 'Melihat daftar favorit.' },
        { name: commandLabel('favorite', 'play'), value: 'Memuat seluruh favorit ke antrean.' },
        { name: commandLabel('playlist', 'create [nama]'), value: 'Membuat playlist baru.' },
        { name: commandLabel('playlist', 'add [nama]'), value: 'Menyimpan lagu saat ini ke playlist.' },
        { name: commandLabel('playlist', 'list'), value: 'Melihat daftar playlist.' },
        { name: commandLabel('playlist', 'play [nama]'), value: 'Memutar seluruh lagu dari playlist.' }
      );

    // Definisi Embed Pengaturan
    const configEmbed = createBaseEmbed()
      .setTitle('⚙️ Pengaturan & Administrator')
      .setDescription('Perintah khusus untuk mengatur perilaku bot di server ini.')
      .addFields(
        { name: commandLabel('config', 'djrole [@role]'), value: '*(Admin Only)* Menetapkan Role DJ.' },
        { name: commandLabel('config', 'language [id/en]'), value: '*(Admin Only)* Mengubah bahasa bot.' },
        { name: commandLabel('ping'), value: 'Mengecek latency bot.' },
        { name: commandLabel('help'), value: 'Membuka panduan ini.' },
        { name: commandLabel('eval'), value: '*(Owner Only)* Menjalankan kode JavaScript.' }
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

    const response = await ctx.reply({
      embeds: [homeEmbed],
      components: [row],
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    });
    const message = response.resource?.message || response;

    const collector = message.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 300000 }); // 5 menit

    collector.on('collect', async (i: any) => {
      if (i.user.id !== ctx.author.id) {
        await i.reply({ content: '❌ Hanya pemanggil perintah yang dapat menggunakan menu ini.', flags: MessageFlags.Ephemeral });
        return;
      }
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
