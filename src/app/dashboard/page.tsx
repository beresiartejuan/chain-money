import type { Metadata } from "next";
import { db } from "@/db";
import { currencyExponent } from "@/lib/currency";
import { formatFromMinorUnits } from "@/lib/money";
import { getCurrentUser } from "@/server/auth/session";
import { listBoxes, MAX_BOXES_PER_USER } from "@/server/boxes/service";
import {
  DashboardBoxes,
  type DashboardBoxView,
} from "./_components/dashboard-boxes";

export const metadata: Metadata = { title: "Tus alcancías" };

/**
 * T069 — Home del producto: todas las alcancías del usuario.
 *
 * Server Component: resuelve la sesión con `getCurrentUser` (el proxy ya
 * redirige sin cookie; acá solo se cubre la sesión expirada entre el proxy
 * y la resolución contra la DB) y llama la lógica de `listBoxes`
 * directamente, sin pasar por la action (que es la capa para clientes).
 * Agrupa propias vs compartidas, calcula el balance formateado por moneda y
 * delega el renderizado interactivo a la sección cliente (T070: CTA crear,
 * T071: renombrar en cada card propia).
 */

/** Mapea una box con balance al view model de la UI. */
function toView(
  box: { id: string; name: string; currency: string },
  balanceMinor: number,
  canRename: boolean,
): DashboardBoxView {
  return {
    boxId: box.id,
    name: box.name,
    currency: box.currency,
    balance: formatFromMinorUnits(balanceMinor, currencyExponent(box.currency)),
    canRename,
  };
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (user === null) {
    // El proxy ya redirige sin cookie; esto cubre sesión expirada entre el
    // proxy y acá (la página exige usuario resuelto contra la DB).
    return (
      <main className="flex flex-1 items-center justify-center p-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Tu sesión expiró. Recargá la página para iniciar sesión.
        </p>
      </main>
    );
  }

  const { own, shared } = await listBoxes(db, user.id);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
      <DashboardBoxes
        maxBoxes={MAX_BOXES_PER_USER}
        own={own.map((entry) => toView(entry.box, entry.balanceMinor, true))}
        shared={shared.map((entry) =>
          toView(entry.box, entry.balanceMinor, false),
        )}
      />
    </main>
  );
}
