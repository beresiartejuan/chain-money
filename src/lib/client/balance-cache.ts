/**
 * Caché de balance incremental (cliente, módulo puro).
 *
 * Mantiene el balance de una alcancía en el cliente aplicando deltas de
 * transacciones sobre un estado acumulado: balance, cursor incremental y
 * contadores. No toca storage ni red: las funciones son puras y el estado
 * resultante es nuevo en cada aplicación (inmutabilidad), lo que permite
 * persistirlo donde la UI decida (Dexie, localStorage, etc.) y testearlo
 * sin DB ni entorno de navegador.
 */
import { type Cursor, compareTuples, makeCursor } from "@/lib/cursor";

export type BalanceState = {
  /** Cursor base64url de la última tx aplicada (`@/lib/cursor`); `null` si no hay. */
  cursor: string | null;
  /** Balance acumulado en unidades menores (cents). */
  balanceMinor: number;
  /** Cantidad de transacciones aplicadas en total. */
  transactionCount: number;
  /** Unix ms de la última tx aplicada; 0 en el estado vacío. */
  updatedAt: number;
};

export type SyncTransaction = {
  id: string;
  type: "deposit" | "withdraw" | "reset";
  amountMinor: number;
  /** Unix ms de creación de la transacción. */
  createdAt: number;
};

/**
 * Estado inicial de la caché: sin cursor, balance 0, sin transacciones.
 */
export function emptyBalanceState(): BalanceState {
  return { cursor: null, balanceMinor: 0, transactionCount: 0, updatedAt: 0 };
}

/**
 * Devuelve un nuevo `BalanceState` con las transacciones aplicadas sobre
 * `state`. Nunca muta el estado de entrada.
 *
 * - `deposit` suma su `amountMinor`; `withdraw` resta.
 * - `reset` fuerza `balanceMinor = 0`, sin importar el historial previo de
 *   la caché. Decisión de diseño: el reset normaliza el balance a 0 porque
 *   la caché puede ser incompleta (empezó a sincronizar después del último
 *   reset), así que recalcular desde el delta no es confiable. El
 *   `amountMinor` del reset es siempre 0 y queda en la tx solo para el
 *   historial.
 * - `transactionCount` crece en `txs.length` y `updatedAt` toma el timestamp
 *   de la última transacción aplicada (el anterior si el delta es vacío).
 * - `cursor` queda en la transacción mayor por `(createdAt, id)` — orden de
 *   tupla igual al del índice de la DB —, no en la última del array tal cual.
 *   Con delta vacío, el cursor no cambia.
 */
export function applyTransactions(
  state: BalanceState,
  txs: readonly SyncTransaction[],
): BalanceState {
  if (txs.length === 0) {
    // Identidad referencial: el estado no cambia y no se crea objeto nuevo.
    return state;
  }

  // No asumir orden de llegada: el cursor final es el de la tx mayor por
  // tupla (createdAtMs, id), igual que el orden del server en la DB.
  const ordered = [...txs].sort((a, b) => {
    const asCursor: Cursor = { createdAtMs: a.createdAt, id: a.id };
    const bsCursor: Cursor = { createdAtMs: b.createdAt, id: b.id };
    return compareTuples(asCursor, bsCursor);
  });

  let balanceMinor = state.balanceMinor;
  for (const tx of ordered) {
    if (tx.type === "reset") {
      // Ver decisión en el JSDoc: normalizar a 0 sin importar el historial.
      balanceMinor = 0;
    } else if (tx.type === "deposit") {
      balanceMinor += tx.amountMinor;
    } else {
      balanceMinor -= tx.amountMinor;
    }
  }

  const last = ordered[ordered.length - 1];

  return {
    cursor: makeCursor(last.createdAt, last.id),
    balanceMinor,
    transactionCount: state.transactionCount + txs.length,
    updatedAt: last.createdAt,
  };
}

/**
 * Conveniencia: calcula el balance total que resulta de aplicar un delta
 * desde el estado vacío, sin construir el estado intermedio.
 */
export function balanceFromTransactions(
  txs: readonly SyncTransaction[],
): number {
  return applyTransactions(emptyBalanceState(), txs).balanceMinor;
}
