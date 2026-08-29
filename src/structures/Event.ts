import { ClientEvents } from 'discord.js';
import { AureliaClient } from './AureliaClient';

export interface Event<K extends keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute: (...args: [...ClientEvents[K], AureliaClient]) => Promise<void> | void;
}
