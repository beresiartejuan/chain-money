"use client";

import Link from "next/link";
import { useState } from "react";
import { RenameBoxDialog } from "./rename-box-dialog";
import { Badge, Card, SmallButton } from "./ui";

/**
 * T069/T071 — Card de una alcancía del dashboard, con la interacción de
 * renombrar. Componente cliente solo por el estado del modal: los datos
 * (nombre, moneda, balance ya formateado) llegan listos desde la page
 * server. El botón "Renombrar" solo se renderiza con `canRename` (T071:
 * `true` solo para el owner; los guests no lo ven).
 *
 * El nombre es un `<Link>` al detalle de la alcancía (la page de detalle la
 * crea otro agente; acá solo va el enlace).
 */
export function BoxCard({
  boxId,
  name,
  currency,
  balance,
  shared,
  canRename,
}: {
  boxId: string;
  name: string;
  currency: string;
  /** Balance ya formateado (`formatFromMinorUnits` en la page). */
  balance: string;
  /** Badge "Compartida" para las no propias. */
  shared: boolean;
  /** Mostrar el botón "Renombrar" (T071: solo owner). */
  canRename: boolean;
}) {
  const [renaming, setRenaming] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          className="text-base font-semibold text-fg underline-offset-2 hover:text-accent hover:underline"
          href={`/dashboard/boxes/${boxId}`}
        >
          {name}
        </Link>
        {shared && <Badge>Compartida</Badge>}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-2xl font-semibold tabular-nums text-fg">
          {balance}
        </p>
        <p className="text-sm font-medium uppercase tracking-wide text-faint">
          {currency}
        </p>
      </div>

      {canRename && (
        <div className="flex justify-end">
          <SmallButton onClick={() => setRenaming(true)}>Renombrar</SmallButton>
        </div>
      )}

      {renaming && (
        <RenameBoxDialog
          boxId={boxId}
          boxName={name}
          onClose={() => setRenaming(false)}
        />
      )}
    </Card>
  );
}
