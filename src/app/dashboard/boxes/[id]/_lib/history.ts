/**
 * Contrato compartido entre la page de detalle (server, T072) y el
 * componente de historial (cliente, T074). Módulo plano sin directivas:
 * ambos lados lo importan, así que no puede vivir dentro del archivo
 * `"use client"` (una page RSC no puede consumir exports de un módulo
 * cliente, solo referencias de componente).
 */

/**
 * Tamaño de página del historial: lo usa la page para la primera página
 * (server-side) y el botón "Cargar más" para las siguientes (fetch al
 * endpoint incremental T062).
 */
export const TRANSACTIONS_PAGE_SIZE = 20;

/**
 * Shape serializable de una transacción en el historial: el mismo que
 * produce el sync (`SyncTransaction` en `@/server/transactions/sync`), pero
 * declarado acá para que la UI no dependa de un módulo `server-only`.
 */
export type HistoryTransaction = {
  id: string;
  type: "deposit" | "withdraw" | "reset";
  amountMinor: number;
  counterparty: string | null;
  note: string;
  createdBy: string;
  createdAt: number;
};
