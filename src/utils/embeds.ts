import { EmbedBuilder } from 'discord.js';

const PRIMARY_COLOR = 0xD4AF37; // Emas (Gold)
const ERROR_COLOR = 0xFF5555;   // Merah

export function createBaseEmbed() {
  return new EmbedBuilder().setColor(PRIMARY_COLOR);
}

export function createErrorEmbed(message: string) {
  return new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setDescription(`❌ | ${message}`);
}

export function createSuccessEmbed(message: string) {
  return new EmbedBuilder()
    .setColor(PRIMARY_COLOR)
    .setDescription(`✅ | ${message}`);
}
