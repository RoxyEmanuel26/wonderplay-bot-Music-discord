import {
  ChatInputCommandInteraction,
  Message,
  Guild,
  GuildMember,
  TextChannel,
  User,
  BaseMessageOptions,
  InteractionReplyOptions,
  MessagePayload
} from 'discord.js';

export class Context {
  public isInteraction: boolean;
  public interaction: ChatInputCommandInteraction | null;
  public message: Message | null;
  public args: string[];

  // Digunakan untuk melacak pesan yang dikirim bot melalui reply(), 
  // agar editReply bisa mengubah pesan yang benar pada Prefix Command.
  private sentMessage: Message | null = null;

  constructor(ctx: ChatInputCommandInteraction | Message, args: string[] = []) {
    if (ctx instanceof ChatInputCommandInteraction) {
      this.isInteraction = true;
      this.interaction = ctx;
      this.message = null;
      this.args = args;
    } else {
      this.isInteraction = false;
      this.interaction = null;
      this.message = ctx;
      this.args = args;
    }
  }

  get guild(): Guild | null {
    return this.isInteraction ? this.interaction!.guild : this.message!.guild;
  }

  get guildId(): string | null {
    return this.isInteraction ? this.interaction!.guildId : this.message!.guildId;
  }

  get channel(): TextChannel | null {
    return (this.isInteraction ? this.interaction!.channel : this.message!.channel) as TextChannel | null;
  }

  get author(): User {
    return this.isInteraction ? this.interaction!.user : this.message!.author;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get member(): GuildMember | any {
    return this.isInteraction ? this.interaction!.member : this.message!.member;
  }
  
  async deferReply(options?: { ephemeral?: boolean }): Promise<void> {
    if (this.isInteraction) {
      await this.interaction!.deferReply(options);
    } else {
      await this.channel?.sendTyping();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async reply(options: string | MessagePayload | InteractionReplyOptions): Promise<Message | any> {
    if (this.isInteraction) {
      if (this.interaction!.deferred || this.interaction!.replied) {
        return await this.interaction!.editReply(options as any);
      }
      return await this.interaction!.reply(options as InteractionReplyOptions);
    } else {
      const msg = await this.channel!.send(options as BaseMessageOptions);
      this.sentMessage = msg;
      return msg;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async followUp(options: string | MessagePayload | InteractionReplyOptions): Promise<Message | any> {
    if (this.isInteraction) {
      // Jika interaksi baru saja di-defer dan belum pernah dijawab,
      // selesaikan status 'thinking' terlebih dahulu dengan editReply
      if (this.interaction!.deferred && !this.interaction!.replied) {
        return await this.interaction!.editReply(options as any);
      }
      return await this.interaction!.followUp(options as InteractionReplyOptions);
    } else {
      const msg = await this.channel!.send(options as BaseMessageOptions);
      this.sentMessage = msg;
      return msg;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async editReply(options: string | MessagePayload | InteractionReplyOptions): Promise<Message | any> {
    if (this.isInteraction) {
      return await this.interaction!.editReply(options as any);
    } else {
      if (this.sentMessage) {
        return await this.sentMessage.edit(options as BaseMessageOptions);
      } else {
        return await this.reply(options);
      }
    }
  }
}
