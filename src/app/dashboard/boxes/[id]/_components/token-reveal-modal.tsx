"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/app/dashboard/_components/modal";
import { PrimaryButton, SmallButton } from "@/app/dashboard/_components/ui";

/**
 * T077 — Reveal del token crudo, UNA sola vez (tras crear un token en
 * T076).
 *
 * - El token crudo llega por prop desde el estado local del panel y SOLO
 *   vive ahí: al cerrar (botón "Ya lo guardé", Escape o click fuera del
 *   Modal compartido) el panel lo descarta. Nunca toca localStorage ni
 *   estado global; en DB queda solo el hash, así que perderlo implica
 *   crear un token nuevo.
 * - "Copiar" usa la Clipboard API con feedback "Copiado" durante 2s (el
 *   timer se re-arma en cada copia y se limpia al desmontar). Si el
 *   portapapeles falla, el botón vuelve a "Copiar": el token sigue
 *   seleccionable a mano (`select-all`).
 * - Advertencia destacada de un solo uso antes del token.
 */
export function TokenRevealModal({
  token,
  onClose,
}: {
  token: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // Sin permiso de clipboard (o contexto inseguro): feedback neutro.
      setCopied(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Token creado">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Compartilo con la persona que quieras invitar a la alcancía; lo canjea
        desde la pantalla de canje.
      </p>

      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">
        No vas a ver este token de nuevo. Es de un solo uso.
      </p>

      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
        <code className="block break-all font-mono text-sm leading-6 text-zinc-900 select-all dark:text-zinc-100">
          {token}
        </code>
      </div>

      <div className="flex items-center justify-between gap-2">
        <SmallButton
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </SmallButton>
        <PrimaryButton onClick={onClose}>Ya lo guardé</PrimaryButton>
      </div>
    </Modal>
  );
}
