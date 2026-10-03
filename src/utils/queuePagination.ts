export const QUEUE_PAGE_SIZE = 10;

export function paginateQueue<T>(tracks: readonly T[], requestedPage: number, pageSize = QUEUE_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(tracks.length / pageSize));
  const page = Math.min(Math.max(0, Math.trunc(requestedPage) || 0), totalPages - 1);
  const startIndex = page * pageSize;

  return {
    page,
    totalPages,
    startIndex,
    items: tracks.slice(startIndex, startIndex + pageSize),
    hasPrevious: page > 0,
    hasNext: page < totalPages - 1,
  };
}
