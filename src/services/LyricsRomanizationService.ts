import type Kuroshiro from 'kuroshiro';
import { logger } from '../utils/logger';
import { splitLyrics } from './LyricsService';

export interface RomanizedLyrics {
  pages: string[];
  romanized: boolean;
  approximate: boolean;
}

const JAPANESE_KANA = /[\u3040-\u30ff]/u;
const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff]/u;
const NON_LATIN_LETTER = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\p{N}\p{P}\p{S}\s]/u;
const MAX_PAGE_LENGTH = 3800;

export class LyricsRomanizationService {
  private japaneseConverter: Promise<Kuroshiro | null> | null = null;
  private transliterator: Promise<((input: string) => string) | null> | null = null;

  public async format(lyrics: string, title = '', artist = ''): Promise<RomanizedLyrics> {
    const lines = lyrics.replace(/\r\n/g, '\n').split('\n');
    const japanese = JAPANESE_KANA.test(`${lyrics}\n${title}\n${artist}`);
    const blocks: string[] = [];
    let romanized = false;
    let approximate = false;

    for (const line of lines) {
      if (!NON_LATIN_LETTER.test(line)) {
        blocks.push(line);
        continue;
      }

      let latin = '';
      if (japanese && JAPANESE_TEXT.test(line)) {
        const converter = await this.getJapaneseConverter();
        if (converter) {
          try {
            latin = await converter.convert(line, { to: 'romaji', mode: 'spaced' });
          } catch (error) {
            logger.warn({ error }, 'Japanese lyrics romanization failed; using Unicode transliteration');
          }
        }
      }
      if (!latin) {
        const transliterate = await this.getTransliterator();
        if (transliterate) {
          latin = transliterate(line);
          approximate = true;
        }
      }
      latin = latin
        .replace(/[āīūēōĀĪŪĒŌ]/g, (vowel) => ({
          ā: 'aa', ī: 'ii', ū: 'uu', ē: 'ee', ō: 'ou',
          Ā: 'Aa', Ī: 'Ii', Ū: 'Uu', Ē: 'Ee', Ō: 'Ou',
        })[vowel] || vowel)
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;!?、。！？])/g, '$1')
        .trim();
      if (latin && latin !== line.trim()) {
        blocks.push(`${line}\n↳ ${latin}`);
        romanized = true;
      } else {
        blocks.push(line);
      }
    }

    return { pages: paginateBlocks(blocks), romanized, approximate };
  }

  private getJapaneseConverter(): Promise<Kuroshiro | null> {
    if (!this.japaneseConverter) {
      this.japaneseConverter = (async () => {
        // These CommonJS releases work on the bot's Node 20 hosting image and
        // load Kuromoji's dictionary from node_modules, without a remote API.
        // Delay loading until Lyrics is requested: missing optional packages
        // must never prevent the music commands from starting.
        const [{ default: Kuroshiro }, { default: KuromojiAnalyzer }] = await Promise.all([
          import('kuroshiro'),
          import('kuroshiro-analyzer-kuromoji'),
        ]);
        const converter = new Kuroshiro();
        await converter.init(new KuromojiAnalyzer());
        return converter;
      })().catch((error) => {
        logger.warn({ error }, 'Japanese romanization unavailable; original lyrics will remain visible');
        return null;
      });
    }
    return this.japaneseConverter;
  }

  private getTransliterator(): Promise<((input: string) => string) | null> {
    if (!this.transliterator) {
      this.transliterator = import('transliteration')
        .then(({ transliterate }) => transliterate)
        .catch((error) => {
          logger.warn({ error }, 'Unicode transliteration unavailable; original lyrics will remain visible');
          return null;
        });
    }
    return this.transliterator;
  }
}

function paginateBlocks(blocks: string[]): string[] {
  const pages: string[] = [];
  let page = '';
  for (const block of blocks) {
    if (block.length > MAX_PAGE_LENGTH) {
      if (page) pages.push(page);
      pages.push(...splitLyrics(block, MAX_PAGE_LENGTH));
      page = '';
      continue;
    }
    const candidate = page ? `${page}\n${block}` : block;
    if (candidate.length > MAX_PAGE_LENGTH) {
      pages.push(page);
      page = block;
    } else {
      page = candidate;
    }
  }
  if (page || pages.length === 0) pages.push(page);
  return pages;
}

export const lyricsRomanizationService = new LyricsRomanizationService();
