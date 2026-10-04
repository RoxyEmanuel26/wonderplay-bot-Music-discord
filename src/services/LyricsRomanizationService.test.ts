import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { LyricsRomanizationService } from './LyricsRomanizationService';

test('missing romanization packages do not prevent Queue from loading or hide original lyrics', () => {
  const script = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function (request, ...args) {
      if (['transliteration', 'kuroshiro', 'kuroshiro-analyzer-kuromoji'].includes(request)) {
        const error = new Error('Cannot find module ' + request);
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      }
      return originalLoad.call(this, request, ...args);
    };
    const { LyricsRomanizationService } = require(process.argv[1]);
    require(process.argv[2]);
    new LyricsRomanizationService().format('Привет мир').then((result) => {
      if (result.pages[0] !== 'Привет мир' || result.romanized) process.exitCode = 1;
    }).catch(() => { process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, [
    '-e', script,
    path.join(__dirname, 'LyricsRomanizationService.js'),
    path.join(__dirname, '../structures/Queue.js'),
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('Japanese kanji and kana are shown with readable romaji under each original line', async () => {
  const service = new LyricsRomanizationService();
  const result = await service.format('時計が鳴ったから\nやっと眼を覚ました\n昨日の風邪がちょっと嘘みたいだ');
  assert.equal(result.romanized, true);
  assert.equal(result.approximate, false);
  assert.match(result.pages[0], /時計が鳴ったから\n↳ tokei ga natta kara/);
  assert.match(result.pages[0], /やっと眼を覚ました\n↳ yatto me o samashi ta/);
  assert.match(result.pages[0], /昨日の風邪がちょっと嘘みたいだ\n↳ kinou no kaze ga chotto uso mitai da/);
});

test('other non-Latin scripts use local Unicode transliteration while Latin lines stay unchanged', async () => {
  const service = new LyricsRomanizationService();
  const result = await service.format('Привет мир\nHello world\n안녕하세요');
  assert.equal(result.romanized, true);
  assert.equal(result.approximate, true);
  assert.match(result.pages[0], /Привет мир\n↳ Privet mir/i);
  assert.match(result.pages[0], /Hello world\n안녕하세요/);
  assert.match(result.pages[0], /안녕하세요\n↳ annyeonghaseyo/i);
});

test('pagination keeps each original line and its Latin reading on the same page', async () => {
  const service = new LyricsRomanizationService();
  const lines = Array.from({ length: 190 }, (_, index) => `Привет мир ${index}`);
  const result = await service.format(lines.join('\n'));
  assert.ok(result.pages.length > 1);
  for (const page of result.pages) {
    assert.ok(page.length <= 3800);
    for (const line of page.split('\n').filter(Boolean)) {
      if (line.startsWith('Привет мир')) {
        assert.match(page, new RegExp(`${line}\\n↳ Privet mir`));
      }
    }
  }
});
