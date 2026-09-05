export function createProgressBar(current: number, total: number, size = 15): string {
  if (total <= 0) return '▱'.repeat(size);

  const rawProgress = Math.round((size * current) / total);
  const progress = Math.min(Math.max(rawProgress, 0), size);
  const emptyProgress = Math.max(size - progress, 0);

  const progressText = '▰'.repeat(progress);
  const emptyProgressText = '▱'.repeat(emptyProgress);

  return progressText + emptyProgressText;
}

export function formatDuration(ms: number): string {
  if (isNaN(ms) || ms < 0) return '00:00';

  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));

  const parts = [];
  if (hours > 0) parts.push(hours.toString().padStart(2, '0'));
  parts.push(minutes.toString().padStart(2, '0'));
  parts.push(seconds.toString().padStart(2, '0'));

  return parts.join(':');
}
