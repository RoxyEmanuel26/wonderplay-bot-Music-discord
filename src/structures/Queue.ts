import { Player, Track } from 'shoukaku';
import { TextChannel, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { AureliaClient } from './AureliaClient';
import { logger } from '../utils/logger';
import { createBaseEmbed } from '../utils/embeds';
import { formatDuration, createProgressBar } from '../utils/progressbar';
import { hasDJPermissions } from '../utils/dj';
import { t, Language } from '../utils/i18n';

export class Queue {
  public tracks: Track[] = [];
  public current: Track | null = null;
  public player: Player;
  public client: AureliaClient;
  public textChannel: TextChannel;
  public guildId: string;
  public loop: 'NONE' | 'TRACK' | 'QUEUE' = 'NONE';
  public nowPlayingMessage: Message | null = null;

  constructor(client: AureliaClient, player: Player, textChannel: TextChannel, guildId: string) {
    this.client = client;
    this.player = player;
    this.textChannel = textChannel;
    this.guildId = guildId;

    this.player.on('end', (reason) => {
      if (reason.reason === 'replaced') return;
      if (reason.reason !== 'stopped') {
        this.next();
      }
    });

    this.player.on('exception', (err) => {
      logger.error(err, 'Lavalink Player Exception');
      this.next();
    });

    this.player.on('stuck', () => {
      logger.warn('Lavalink Player Stuck');
      this.next();
    });

    this.player.on('closed', () => {
      logger.info(`Player closed for guild ${this.guildId}`);
      this.client.queues.delete(this.guildId);
    });
  }

  public enqueue(track: Track) {
    this.tracks.push(track);
    this.play();
  }

  public async play() {
    if (!this.player) return;
    if (this.current) return;

    if (this.tracks.length === 0) {
      if (this.nowPlayingMessage) {
        this.nowPlayingMessage.delete().catch(() => null);
        this.nowPlayingMessage = null;
      }

      setTimeout(async () => {
        // Cek lagi apakah setelah 1 menit masih kosong
        if (this.tracks.length > 0 || this.current) return;
        
        try {
          const { db } = await import('../database/db');
          const settings = await db.guildSettings.findUnique({ where: { guildId: this.guildId } });
          const lang = (settings?.language as Language) || 'id';
          
          if (!settings || !settings.mode247) {
            this.stop();
            this.client.shoukaku.leaveVoiceChannel(this.guildId);
            this.client.queues.delete(this.guildId);
            this.textChannel.send(t('autoLeave', lang));
          }
        } catch (e) {
          logger.error(e, 'Failed to handle auto-leave');
        }
      }, 60000); // 1 menit idle
      return;
    }

    this.current = this.tracks.shift() || null;
    if (!this.current) return;

    await this.player.playTrack({ track: { encoded: this.current.encoded } });
    
    await this.sendNowPlaying();
  }

  private async sendNowPlaying() {
    if (!this.current) return;

    const progressBar = createProgressBar(0, this.current.info.length, 15);
    const timeString = `\`00:00\` ${progressBar} \`${formatDuration(this.current.info.length)}\``;

    const embed = createBaseEmbed()
      .setTitle('🎶 Now Playing')
      .setDescription(`[**${this.current.info.title}**](${this.current.info.uri || ''})\n\n👤 Author: ${this.current.info.author}\n${timeString}`)
      .setThumbnail(this.current.info.artworkUrl || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=256&h=256')
      .setFooter({ text: 'AURELIA Premium Audio Engine' });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('btn_pause').setEmoji('⏯️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('btn_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('btn_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('btn_loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    );

    try {
      if (this.nowPlayingMessage) {
        await this.nowPlayingMessage.delete().catch(() => null);
      }
      this.nowPlayingMessage = await this.textChannel.send({ embeds: [embed], components: [row] });
      this.setupButtonCollector(this.nowPlayingMessage);
    } catch (err) {
      logger.error(err, 'Failed to send Now Playing message');
    }
  }

  private setupButtonCollector(message: Message) {
    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: this.current?.info.length || 300000 });

    collector.on('collect', async (interaction) => {
      const hasPermission = await hasDJPermissions(interaction);
      if (!hasPermission) {
        await interaction.reply({ content: '❌ Kamu membutuhkan role DJ untuk menggunakan tombol ini.', ephemeral: true });
        return;
      }

      await interaction.deferUpdate();

      if (interaction.customId === 'btn_pause') {
        this.player.setPaused(!this.player.paused);
        await interaction.followUp({ content: `⏸️ Musik **${this.player.paused ? 'dijeda' : 'dilanjutkan'}**.`, ephemeral: true });
      } else if (interaction.customId === 'btn_skip') {
        this.skip();
      } else if (interaction.customId === 'btn_stop') {
        this.stop();
        this.client.shoukaku.leaveVoiceChannel(this.guildId);
        this.client.queues.delete(this.guildId);
      } else if (interaction.customId === 'btn_loop') {
        this.loop = this.loop === 'NONE' ? 'TRACK' : this.loop === 'TRACK' ? 'QUEUE' : 'NONE';
        await interaction.followUp({ content: `Loop mode set to: **${this.loop}**`, ephemeral: true });
      }
    });
  }

  public next() {
    if (this.loop === 'TRACK' && this.current) {
      this.tracks.unshift(this.current);
    } else if (this.loop === 'QUEUE' && this.current) {
      this.tracks.push(this.current);
    }
    
    this.current = null;
    this.play();
  }

  public skip() {
    this.player.stopTrack();
    this.next();
  }

  public stop() {
    this.tracks = [];
    this.current = null;
    this.loop = 'NONE';
    this.player.stopTrack();
    if (this.nowPlayingMessage) {
      this.nowPlayingMessage.delete().catch(() => null);
    }
  }
}
