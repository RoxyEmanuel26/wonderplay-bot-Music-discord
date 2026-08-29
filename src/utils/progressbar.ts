export function createProgressBar(current: number, total: number, size = 15): string {
  if (total === 0) return '▱'.repeat(size);

  const progress = Math.round((size * current) / total);
  const emptyProgress = size - progress;

  const progressText = '▰'.repeat(progress);
  const emptyProgressText = '▱'.repeat(emptyProgress);

  return progressText + emptyProgressText;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

  const parts = [];
  if (hours > 0) parts.push(hours.toString().padStart(2, '0'));
  parts.push(minutes.toString().padStart(2, '0'));
  parts.push(seconds.toString().padStart(2, '0'));

  return parts.join(':');
}
