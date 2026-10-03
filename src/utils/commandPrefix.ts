export function getCommandPrefix(): string {
  return process.env.PREFIX || process.env.DEFAULT_PREFIX || '.';
}
