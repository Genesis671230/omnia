// PostgREST filters travel in the GET query string. A month-to-date statement
// (~400 rows of long narrations) as ONE `in.(…)` list is ~70 KB of URL, which
// the HTTP layer refuses outright ("TypeError: fetch failed") — every upload
// past ~300 rows died before saving anything. Split lookups so each request's
// encoded list stays well under the usual 8 KB proxy limit.
const IN_FILTER_URL_BUDGET = 6_000;

export function chunkForInFilter(values: string[], budget = IN_FILTER_URL_BUDGET): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const v of values) {
    // quotes + comma around each value, all percent-encoded
    const cost = encodeURIComponent(`"${v}",`).length;
    if (current.length > 0 && size + cost > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(v);
    size += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
