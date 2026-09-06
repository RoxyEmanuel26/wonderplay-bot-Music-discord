import {
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
  AutocompleteInteraction,
} from 'discord.js';
import { AureliaClient } from './AureliaClient';
import { Context } from './Context';

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  aliases?: string[];
  execute: (ctx: Context, client: AureliaClient) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction, client: AureliaClient) => Promise<void>;
}
