"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormErrorBanner } from "@/app/(auth)/_components/form-fields";
import { Modal } from "@/app/dashboard/_components/modal";
import { SmallButton } from "@/app/dashboard/_components/ui";
import { currencyExponent } from "@/lib/currency";
import { formatFromMinorUnits } from "@/lib/money";
import { resetBoxAction } from "@/server/transactions/actions";

/**
 * T075 — Botón "Reset" con confirmación (solo con `reset:box`; la page
 * decide si renderizarlo).
 *
 * - Abre un modal mostrando el balance que va a anularse ("Van a quedar en
 *   0") y la advertencia de que queda registrado en el historial.
 * - Balance ya en 0: el botón abre el modal igual (el dueño necesita un
 *   lugar claro para verlo) y la confirmación es un no-op informado
 *   ("La alcancía ya está en cero") sin llamar a la action.
 * - Al confirmar: `resetBoxAction(boxId)` + `router.refresh()` (la page
 *   server recarga con balance 0 y la transacción `reset` en el historial).
 */

export function ResetBox({
  boxId,
  currency,
  balanceMinor,
}: {
  boxId: string;
  currency: string;
  /** Balance actual en unidades menores, ya resuelto server-side. */
  balanceMinor: number;
}) {
  const router = useRouter();
  const exponent = currencyExponent(currency);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const formattedBalance = formatFromMinorUnits(balanceMinor, exponent);

  function handleOpen(): void {
    // Reabrir el modal tras un resultado previo arranca limpio.
    setDone(null);
    setBanner(null);
    setOpen(true);
  }

  async function handleConfirm(): Promise<void> {
    setPending(true);
    setBanner(null);

    const result = await resetBoxAction(boxId);

    if (result.ok) {
      setPending(false);
      setDone(
        result.reset
          ? "La alcancía quedó en cero. Se registró en el historial."
          : "La alcancía ya está en cero.",
      );
      // La page server recarga con el balance y el historial actualizados.
      router.refresh();
      return;
    }
    setPending(false);

    if (result.error.code === "unauthorized") {
      setBanner("Tu sesión expiró. Recargá la página e iniciá sesión.");
      return;
    }
    if (result.error.code === "forbidden") {
      setBanner("No tenés permiso para resetear esta alcancía.");
      return;
    }
    // `not_found`: la box ya no existe o dejó de estar compartida.
    setBanner("Esta alcancía ya no está disponible. Recargá la página.");
  }

  return (
    <>
      <SmallButton onClick={handleOpen}>Reset</SmallButton>

      {open && (
        <Modal onClose={() => setOpen(false)} title="Resetear alcancía">
          {done !== null ? (
            <>
              <p className="rounded-md border border-accent/30 bg-accent-dim px-3 py-2 text-sm text-accent">
                {done}
              </p>
              <div className="flex justify-end">
                <SmallButton onClick={() => setOpen(false)}>Listo</SmallButton>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                El balance actual{" "}
                <span className="font-semibold tabular-nums text-fg">
                  {formattedBalance} {currency}
                </span>{" "}
                va a quedar en 0.
              </p>
              <p className="text-sm text-muted">
                Se registrará en el historial; no se puede deshacer.
              </p>
              {banner !== null && <FormErrorBanner>{banner}</FormErrorBanner>}
              <div className="flex justify-end gap-2">
                <SmallButton onClick={() => setOpen(false)}>
                  Cancelar
                </SmallButton>
                <button
                  className="rounded-md bg-red-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={pending}
                  onClick={() => {
                    void handleConfirm();
                  }}
                  type="button"
                >
                  {pending ? "Reseteando…" : "Confirmar reset"}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
