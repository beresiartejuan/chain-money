/**
 * Trivial helper used by the smoke test to verify that the `@` alias
 * resolves to `./src` in Vitest exactly as it does in the app.
 */
export function add(a: number, b: number): number {
  return a + b;
}
