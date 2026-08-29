import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
  AutocompleteInteraction,
} from 'discord.js';
import { AureliaClient } from './AureliaClient';

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  execute: (interaction: ChatInputCommandInteraction, client: AureliaClient) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction, client: AureliaClient) => Promise<void>;
}
