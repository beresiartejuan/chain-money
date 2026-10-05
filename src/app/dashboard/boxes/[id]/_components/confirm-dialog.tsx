"use client";

import type { ReactNode } from "react";
import { FormErrorBanner } from "@/app/(auth)/_components/form-fields";
import { Modal } from "@/app/dashboard/_components/modal";
import { SmallButton } from "@/app/dashboard/_components/ui";

/**
 * Diálogo de confirmación genérico para acciones destructivas sobre una
 * fila (T076: expirar/borrar token): envuelve el Modal compartido con una
 * descripción, el banner de error de la action (con el diálogo abierto se
 * puede reintentar) y el par cancelar/confirmar (rojo, como el reset de
 * alcancía). Textos y handlers los pasa el caller; acá no hay lógica.
 */
export function ConfirmDialog({
  confirmLabel,
  description,
  error,
  onClose,
  onConfirm,
  pending,
  pendingLabel,
  title,
}: {
  confirmLabel: string;
  description: ReactNode;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  pendingLabel: string;
  title: string;
}) {
  return (
    <Modal onClose={onClose} title={title}>
      {description}
      {error !== null && <FormErrorBanner>{error}</FormErrorBanner>}
      <div className="flex justify-end gap-2">
        <SmallButton onClick={onClose}>Cancelar</SmallButton>
        <button
          className="rounded-md bg-red-500/90 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          onClick={onConfirm}
          type="button"
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
