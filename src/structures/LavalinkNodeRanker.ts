export interface RankedNode {
  name: string;
  penalties: number;
  secure?: boolean;
  sources?: string[];
  preference?: number;
}

interface SourceHealth {
  failures: number;
  lastFailureAt: number;
  latencyMs: number | null;
}

const FAILURE_WINDOW_MS = 10 * 60 * 1000;

export function lavalinkSource(value: string | null | undefined): string {
  const input = value?.toLowerCase() || '';
  if (input === 'youtube' || /^(?:ytm?search:|https?:\/\/(?:www\.|music\.)?(?:youtube\.com|youtu\.be))/i.test(input)) return 'youtube';
  if (input === 'spotify' || /^https?:\/\/open\.spotify\.com\//i.test(input)) return 'spotify';
  if (input === 'soundcloud' || /^(?:scsearch:|https?:\/\/(?:www\.)?soundcloud\.com\/)/i.test(input)) return 'soundcloud';
  return input && !input.includes(':') ? input : '*';
}

export class LavalinkNodeRanker {
  private readonly health = new Map<string, Map<string, SourceHealth>>();

  private entry(name: string, source: string): SourceHealth {
    let sources = this.health.get(name);
    if (!sources) {
      sources = new Map();
      this.health.set(name, sources);
    }
    let health = sources.get(source);
    if (!health) {
      health = { failures: 0, lastFailureAt: 0, latencyMs: null };
      sources.set(source, health);
    }
    return health;
  }

  public resolveLatency(name: string, elapsedMs: number): void {
    const health = this.entry(name, '*');
    health.latencyMs = health.latencyMs === null
      ? elapsedMs
      : health.latencyMs * 0.7 + elapsedMs * 0.3;
  }

  public failure(name: string, source: string, now = Date.now()): void {
    const health = this.entry(name, lavalinkSource(source));
    if (health.lastFailureAt > 0 && now - health.lastFailureAt < 2000) return;
    health.failures = now - health.lastFailureAt > FAILURE_WINDOW_MS ? 1 : Math.min(5, health.failures + 1);
    health.lastFailureAt = now;
  }

  public success(name: string, source: string): void {
    const health = this.entry(name, lavalinkSource(source));
    health.failures = 0;
    health.lastFailureAt = 0;
    if (source !== '*') {
      const general = this.entry(name, '*');
      general.failures = 0;
      general.lastFailureAt = 0;
    }
  }

  public score(node: RankedNode, source: string, now = Date.now()): number {
    const kind = lavalinkSource(source);
    const tier = node.secure === false ? 80 : 0;
    const sourceUnsupported = kind !== '*' && node.sources && !node.sources.includes(kind) ? 500 : 0;
    const failures = [this.health.get(node.name)?.get(kind), this.health.get(node.name)?.get('*')]
      .filter((entry): entry is SourceHealth => Boolean(entry))
      .reduce((total, entry) => total + (now - entry.lastFailureAt <= FAILURE_WINDOW_MS ? entry.failures : 0), 0);
    const latencyMs = this.health.get(node.name)?.get('*')?.latencyMs || 0;
    return tier + (node.preference || 0) + sourceUnsupported + failures * 70
      + Math.min(25, latencyMs / 300)
      + Math.min(30, Math.max(0, node.penalties) / 10);
  }
}
