import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { Track } from 'shoukaku';
import { AureliaClient } from '../../structures/AureliaClient';
import { Context } from '../../structures/Context';
import queueCommand from './queue';

type QueueView = { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] };

test('queue buttons reach the final song and follow live queue changes', async () => {
  const collector = new EventEmitter();
  const edits: QueueView[] = [];
  let initialView: QueueView | null = null;
  const message = {
    createMessageComponentCollector: () => collector,
    edit: async (view: QueueView) => { edits.push(view); },
  };
  const current = { info: { title: 'Current', uri: 'https://example.com/current', length: 60_000 } } as Track;
  const tracks = Array.from({ length: 198 }, (_, index) => ({
    info: { title: `Track ${index + 1}`, uri: `https://example.com/${index + 1}`, length: 60_000 },
  })) as Track[];
  const queue = { current, tracks, loop: 'NONE' };
  const client = { queues: new Map([['guild-id', queue]]) } as unknown as AureliaClient;
  const ctx = {
    guildId: 'guild-id',
    guild: { name: 'Test Server' },
    author: { id: 'requester' },
    reply: async (view: QueueView) => { initialView = view; return message; },
  } as unknown as Context;

  await queueCommand.execute(ctx, client);
  assert.match(initialView!.embeds[0].data.footer!.text, /Halaman 1\/20/);

  const click = async (customId: string) => {
    let acknowledged = false;
    collector.emit('collect', {
      customId,
      user: { id: 'requester' },
      deferUpdate: async () => { acknowledged = true; },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(acknowledged, true);
  };

  for (let index = 0; index < 19; index++) await click('queue:next');
  assert.match(edits.at(-1)!.embeds[0].data.footer!.text, /Halaman 20\/20 • Lagu 191–198 dari 198/);
  assert.match(edits.at(-1)!.embeds[0].data.description!, /198\. \[Track 198\]/);
  assert.equal(edits.at(-1)!.components[0].components[1].data.disabled, true);

  await click('queue:previous');
  assert.match(edits.at(-1)!.embeds[0].data.footer!.text, /Halaman 19\/20/);

  queue.tracks = tracks.slice(0, 3);
  await click('queue:next');
  assert.match(edits.at(-1)!.embeds[0].data.footer!.text, /Halaman 1\/1 • Lagu 1–3 dari 3/);
});
