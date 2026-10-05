"use client";

import Link from "next/link";
import { useState } from "react";
import { BoxCard } from "./box-card";
import { CreateBoxDialog } from "./create-box-dialog";
import { PrimaryButton } from "./ui";

/**
 * T069/T070 — Sección interactiva de la page `/dashboard`: CTA de creación
 * (abre el diálogo de T070) y grillas de cards propias/compartidas que la
 * page server le pasa ya resueltas (datos serializables, balance
 * formateado). Cliente solo por el estado del modal y por `router.refresh`
 * de los diálogos.
 */

/** Una alcancía lista para renderizar, con el balance ya formateado. */
export type DashboardBoxView = {
  boxId: string;
  name: string;
  currency: string;
  balance: string;
  canRename: boolean;
};

export function DashboardBoxes({
  own,
  shared,
  maxBoxes,
}: {
  own: DashboardBoxView[];
  shared: DashboardBoxView[];
  /** Tope de alcancías propias (para el contador "N/5"). */
  maxBoxes: number;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Tus alcancías
          </h1>
          <p className="text-sm text-muted">
            {own.length}/{maxBoxes} propias
          </p>
        </div>
        <PrimaryButton
          disabled={own.length >= maxBoxes}
          onClick={() => setCreating(true)}
        >
          Nueva alcancía
        </PrimaryButton>
      </header>

      {own.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface p-10 text-center">
          <p className="text-sm text-muted">
            Todavía no tenés alcancías propias.
          </p>
          <PrimaryButton onClick={() => setCreating(true)}>
            Crear la primera
          </PrimaryButton>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {own.map((box) => (
            <BoxCard
              balance={box.balance}
              boxId={box.boxId}
              canRename={box.canRename}
              currency={box.currency}
              key={box.boxId}
              name={box.name}
              shared={false}
            />
          ))}
        </div>
      )}

      {shared.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-fg">Compartidas con vos</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {shared.map((box) => (
              <BoxCard
                balance={box.balance}
                boxId={box.boxId}
                canRename={box.canRename}
                currency={box.currency}
                key={box.boxId}
                name={box.name}
                shared
              />
            ))}
          </div>
        </section>
      )}

      {creating && <CreateBoxDialog onClose={() => setCreating(false)} />}

      <p className="text-center text-sm text-muted">
        ¿Te compartieron una alcancía?{" "}
        <Link
          className="font-medium text-accent underline underline-offset-2 hover:text-fg"
          href="/redeem"
        >
          Canjeá tu código
        </Link>
      </p>
    </div>
  );
}
