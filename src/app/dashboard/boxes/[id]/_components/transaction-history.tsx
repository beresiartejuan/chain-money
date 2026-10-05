"use client";

import { useState } from "react";
import { Card, SmallButton } from "@/app/dashboard/_components/ui";
import { currencyExponent } from "@/lib/currency";
import { formatFromMinorUnits } from "@/lib/money";
import {
  type HistoryTransaction,
  TRANSACTIONS_PAGE_SIZE,
} from "../_lib/history";

/**
 * T074 — Historial de transacciones con metadata completa (autor, fecha).
 *
 * La primera página la resuelve la page server; las siguientes las pide
 * este componente con `fetch` al endpoint incremental (T062), usando la
 * última transacción de la lista como ancla `sinceTransactionId` y
 * agregando al final (el endpoint devuelve ASC por `(createdAt, id)`, así
 * que la continuidad es directa).
 *
 * ## Decisiones
 *
 * - **Autor**: la page pasa `authorNames: { [userId]: nombre }` (una query
 *   de users sobre los ids únicos de las transacciones); los faltantes (p.
 *   ej. de páginas cargadas después) muestran "Usuario".
 * - **Fecha**: formato determinista `dd/mm/aaaa HH:MM` en UTC con sufijo
 *   " UTC", armado a mano sin `Intl` con zona ni `toLocaleString`: server
 *   e hidratación producen exactamente el mismo string.
 * - **Reset**: fila resaltada (fondo ámbar + borde) y símbolo ↺; deposit
 *   ▲ verde y withdraw ▼ rojo.
 * - **Sincronía con refresh**: `useState(initial)` solo mira el primer
 *   render, así que tras un `router.refresh()` (nueva transacción o reset)
 *   la lista se re-alinea con la primera página que resuelve el server
 *   (patrón "ajustar estado durante el render" de React, sin Effect).
 */

/** Color e icono por tipo de movimiento. */
function typeStyle(type: HistoryTransaction["type"]): {
  icon: string;
  className: string;
} {
  switch (type) {
    case "deposit":
      return {
        icon: "▲",
        className: "text-accent",
      };
    case "withdraw":
      return {
        icon: "▼",
        className: "text-red-400",
      };
    case "reset":
      return {
        icon: "↺",
        className: "text-amber-400",
      };
  }
}

/** Texto del monto con signo por tipo (el reset lleva lo que anuló). */
function amountText(
  type: HistoryTransaction["type"],
  amountMinor: number,
  exponent: number,
): string {
  const absolute = formatFromMinorUnits(Math.abs(amountMinor), exponent);
  if (type === "withdraw") {
    return `−${absolute}`;
  }
  if (type === "reset") {
    return `±${absolute}`;
  }
  return `+${absolute}`;
}

/**
 * Fecha determinista `dd/mm/aaaa HH:MM` (UTC, 2 dígitos con cero), igual
 * en server y en hidratación: sin `Intl` ni `toLocaleString` (que dependen
 * del ICU del runtime) ni zona horaria local.
 */
function formatTimestamp(createdAt: number): string {
  const date = new Date(createdAt);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes} UTC`;
}

/** Nombre visible de un autor, con fallback para ids sin nombre resuelto. */
function authorName(authorNames: Record<string, string>, userId: string) {
  return authorNames[userId] ?? "Usuario";
}

export function TransactionHistory({
  boxId,
  currency,
  initialTransactions,
  initialHasMore,
  authorNames,
}: {
  boxId: string;
  currency: string;
  /** Primera página, ya resuelta server-side (ASC). */
  initialTransactions: HistoryTransaction[];
  initialHasMore: boolean;
  /** Map { userId → nombre } para los autores de la página inicial. */
  authorNames: Record<string, string>;
}) {
  const exponent = currencyExponent(currency);
  const [items, setItems] = useState<HistoryTransaction[]>(initialTransactions);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tras un `router.refresh()` la page server re-resuelve la primera
  // página (nuevos props); el estado local vuelve a alinearse con ella,
  // igual que haría una recarga completa. Sin cambios de props (re-renders
  // locales por "Cargar más"), la referencia es la misma y no se toca.
  const [previousInitial, setPreviousInitial] = useState(initialTransactions);
  if (previousInitial !== initialTransactions) {
    setPreviousInitial(initialTransactions);
    setItems(initialTransactions);
    setHasMore(initialHasMore);
  }

  /**
   * Trae la siguiente página con el endpoint incremental (T062) usando la
   * última transacción de la lista como ancla. Ante error (p. ej. 403 por
   * permiso revocado) muestra el mensaje y permite reintentar el fetch.
   */
  async function handleLoadMore(): Promise<void> {
    const last = items[items.length - 1];
    if (!last || loadingMore) {
      return;
    }
    setLoadingMore(true);
    setError(null);

    const url = `/api/boxes/${boxId}/transactions?sinceTransactionId=${encodeURIComponent(last.id)}&limit=${TRANSACTIONS_PAGE_SIZE}`;
    const response = await fetch(url);

    if (!response.ok) {
      setLoadingMore(false);
      setError("No se pudieron cargar más transacciones. Intentá de nuevo.");
      return;
    }

    const page = (await response.json()) as {
      transactions: HistoryTransaction[];
      hasMore: boolean;
    };
    setLoadingMore(false);
    setItems((previous) => {
      // Defensa anti-duplicados: si un reintent repite la ancla, el id ya
      // visto no se agrega de nuevo (el endpoint no debería repetirlo).
      const seen = new Set(previous.map((tx) => tx.id));
      const fresh = page.transactions.filter((tx) => !seen.has(tx.id));
      return [...previous, ...fresh];
    });
    setHasMore(page.hasMore);
  }

  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg">Historial</h2>
        <p className="text-sm text-muted">
          {items.length} {items.length === 1 ? "movimiento" : "movimientos"}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-elevated px-4 py-6 text-center text-sm text-muted">
          Todavía no hay movimientos en esta alcancía.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((tx) => {
            const style = typeStyle(tx.type);
            const isReset = tx.type === "reset";
            return (
              <li
                className={
                  isReset
                    ? "flex items-start justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5"
                    : "flex items-start justify-between gap-3 rounded-lg border border-rowline bg-elevated px-3 py-2.5"
                }
                key={tx.id}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      aria-hidden="true"
                      className={`font-semibold tabular-nums ${style.className}`}
                    >
                      {style.icon}
                    </span>
                    <span
                      className={`font-semibold tabular-nums ${style.className}`}
                    >
                      {amountText(tx.type, tx.amountMinor, exponent)}{" "}
                      <span className="text-xs font-medium text-faint">
                        {currency}
                      </span>
                    </span>
                    {tx.counterparty !== null && tx.counterparty !== "" && (
                      <span className="text-sm text-muted">
                        · {tx.counterparty}
                      </span>
                    )}
                  </div>
                  {tx.note !== "" && (
                    <p className="break-words text-sm text-muted">{tx.note}</p>
                  )}
                  <p className="text-xs text-faint">
                    {authorName(authorNames, tx.createdBy)} ·{" "}
                    <time dateTime={new Date(tx.createdAt).toISOString()}>
                      {formatTimestamp(tx.createdAt)}
                    </time>
                  </p>
                </div>
                {isReset && (
                  <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                    Reset
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error !== null && (
        <p
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <SmallButton
            disabled={loadingMore}
            onClick={() => {
              void handleLoadMore();
            }}
          >
            {loadingMore ? "Cargando…" : "Cargar más"}
          </SmallButton>
        </div>
      )}
    </Card>
  );
}
