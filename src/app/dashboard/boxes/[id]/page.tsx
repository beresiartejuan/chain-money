import { inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currencyExponent } from "@/lib/currency";
import { formatFromMinorUnits } from "@/lib/money";
import { getCurrentUser } from "@/server/auth/session";
import { getBox } from "@/server/boxes/service";
import { NotFoundError } from "@/server/errors";
import { hasPermission } from "@/server/permissions/access";
import { listTokens } from "@/server/tokens/service";
import { getTransactionsWithAccess } from "@/server/transactions/sync";
import { ResetBox } from "./_components/reset-box";
import { type TokenListItem, TokenPanel } from "./_components/token-panel";
import { TransactionForm } from "./_components/transaction-form";
import { TransactionHistory } from "./_components/transaction-history";
import {
  type HistoryTransaction,
  TRANSACTIONS_PAGE_SIZE,
} from "./_lib/history";

/**
 * T072 — Vista detalle de una alcancía (`/dashboard/boxes/[id]`): header
 * con nombre/moneda/balance + form (T073), historial (T074), reset (T075)
 * y panel "Compartir" de tokens (T076/T077, solo owner).
 *
 * Server Component: resuelve sesión y llama `getBox` (service directo, sin
 * la action: no estamos en la capa de clientes). `NotFoundError` →
 * `notFound()` (404 real: owner/guest ven la vista; extraño sin relación y
 * box inexistente comparten el 404, no se filtra la existencia).
 *
 * Los permisos efectivos (`permissions`) ya gatéan la UI acá: el form solo
 * se renderiza con `create:transactions` y el reset con `reset:box`
 * (adelanto natural de T079, que verificará estos gates).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (user !== null) {
    try {
      const { box } = await getBox(db, user.id, id);
      return { title: box.name };
    } catch {
      // Sin título personalizado para extraños/404 (evita filtrar nombre).
    }
  }
  return { title: "Alcancía" };
}

/**
 * Nombres de los autores de las transacciones, en UNA query: los ids únicos
 * de `createdBy` van contra `users` y salen como map { userId → name }.
 * El usuario de la sesión ve su propio id como "Vos".
 */
async function authorNamesFor(
  transactions: HistoryTransaction[],
  currentUserId: string,
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(transactions.map((tx) => tx.createdBy))];
  if (uniqueIds.length === 0) {
    return {};
  }
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, uniqueIds));
  const names: Record<string, string> = {};
  for (const row of rows) {
    names[row.id] = row.id === currentUserId ? "Vos" : row.name;
  }
  return names;
}

export default async function BoxDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (user === null) {
    // El proxy ya redirige sin cookie; esto cubre sesión expirada entre el
    // proxy y acá (mismo patrón que la page del dashboard).
    return (
      <main className="flex flex-1 items-center justify-center p-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tu sesión expiró. Recargá la página para iniciar sesión.
        </p>
      </main>
    );
  }

  // Owner/guest → acceso; extraño o box inexistente → NotFoundError → 404.
  let access: Awaited<ReturnType<typeof getBox>>;
  try {
    access = await getBox(db, user.id, id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }
  const { box, isOwner, permissions, balanceMinor } = access;

  const canCreate = hasPermission(
    { isOwner, permissions },
    "create:transactions",
  );
  const canReset = hasPermission({ isOwner, permissions }, "reset:box");
  const canViewHistory = hasPermission(
    { isOwner, permissions },
    "view:transactions",
  );

  // Primera página del historial, server-side (T074); el resto la pide el
  // cliente al endpoint incremental. Owner y guests con view pasan; un
  // guest sin `view:transactions` ve la sección con el aviso.
  let initialTransactions: HistoryTransaction[] = [];
  let initialHasMore = false;
  if (canViewHistory) {
    const page = await getTransactionsWithAccess(db, user.id, id, {
      limit: TRANSACTIONS_PAGE_SIZE,
    });
    initialTransactions = page.transactions;
    initialHasMore = page.hasMore;
  }

  const authorNames = await authorNamesFor(initialTransactions, user.id);

  // Tokens compartidos para el panel "Compartir" (T076): solo el owner los
  // ve, así que la lista se resuelve server-side solo en ese caso, con el
  // service directo (mismo patrón que `getBox`, sin re-resolver sesión).
  // El shape `TokenSummary` del service ya es serializable y coincide con
  // el prop `TokenListItem` del panel.
  let initialTokens: TokenListItem[] = [];
  if (isOwner) {
    try {
      initialTokens = await listTokens(db, user.id, id);
    } catch (error) {
      // El owner ya pasó `getBox`; un fallo acá no debería tirar abajo la
      // vista entera: el panel arranca vacío.
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
      initialTokens = [];
    }
  }

  const formattedBalance = formatFromMinorUnits(
    balanceMinor,
    currencyExponent(box.currency),
  );

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Link
            className="text-sm font-medium text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
            href="/dashboard"
          >
            ← Volver al dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              {box.name}
            </h1>
            {!isOwner && (
              <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                Compartida
              </span>
            )}
          </div>
          <div className="flex items-baseline justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-3xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {formattedBalance}
            </p>
            <p className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {box.currency}
            </p>
          </div>
        </header>

        {canCreate && (
          <TransactionForm boxId={box.id} currency={box.currency} />
        )}

        {canReset && (
          <div className="flex justify-end">
            <ResetBox
              balanceMinor={balanceMinor}
              boxId={box.id}
              currency={box.currency}
            />
          </div>
        )}

        {canViewHistory ? (
          <TransactionHistory
            authorNames={authorNames}
            boxId={box.id}
            currency={box.currency}
            initialHasMore={initialHasMore}
            initialTransactions={initialTransactions}
          />
        ) : (
          <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Historial
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No tenés permiso para ver el historial de esta alcancía.
            </p>
          </section>
        )}

        {isOwner && <TokenPanel boxId={box.id} initialTokens={initialTokens} />}
      </div>
    </main>
  );
}
