/** Throwaway probe for the CI review check; deleted with the branch. */
export function lastItem(items) {
  return items[items.length - 1];
}

export function average(values) {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}
// third push
// fourth push
