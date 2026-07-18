/**
 * Run `worker` over every item with at most `limit` calls in flight at once.
 * Results come back in input order regardless of completion order. `limit` is
 * clamped to at least 1; an empty `items` resolves immediately.
 */
export async function pool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const lanes = Math.max(1, Math.min(limit, items.length))
  let next = 0
  async function drain(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => drain()))
  return results
}
