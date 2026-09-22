import type { SyncTransaction } from "@/lib/client/balance-cache";

/**
 * Fábrica de transacciones de sync para tests: valores por defecto y
 * overrides puntuales para no repetir objetos literales en cada caso.
 */
export function tx(
  id: string,
  type: SyncTransaction["type"],
  amountMinor: number,
  createdAt: number,
): SyncTransaction {
  return { id, type, amountMinor, createdAt };
}
