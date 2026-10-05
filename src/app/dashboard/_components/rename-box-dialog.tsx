"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormErrorBanner } from "@/app/(auth)/_components/form-fields";
import { actionFieldErrors } from "@/app/(auth)/_lib/forms";
import { BOX_NAME_MAX_LENGTH } from "@/lib/validation/box-name";
import { renameBoxAction } from "@/server/boxes/actions";
import { Modal } from "./modal";
import { PrimaryButton } from "./ui";

/**
 * T071 — Diálogo de renombrado de alcancía (solo se renderiza para el
 * owner; los guests no ven el botón que lo abre).
 *
 * - Validación client 1–80 (trim): mensajes sin roundtrip.
 * - Errores server reflejados: `validation` → fieldErrors.name;
 *   `forbidden` / `not_found` / `unauthorized` → banner genérico.
 * - Al éxito: `router.refresh()` re-renderiza la lista con el nuevo nombre.
 */

/** Texto de error bajo un campo, en rojo, con id estable para a11y. */
function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) {
    return null;
  }
  return (
    <p className="text-sm text-red-400" id={id}>
      {children}
    </p>
  );
}

const NAME_ERROR_ID = "rename-box-name-error";

/** Valida 1–80 luego de trim, igual que el service; devuelve el mensaje. */
function validateName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 1) {
    return "El nombre no puede estar vacío.";
  }
  if (name.length > BOX_NAME_MAX_LENGTH) {
    return `El nombre no puede tener más de ${BOX_NAME_MAX_LENGTH} caracteres.`;
  }
  return null;
}

export function RenameBoxDialog({
  boxId,
  boxName,
  onClose,
}: {
  boxId: string;
  boxName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [name, setName] = useState(boxName);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    // Validación client con el mismo mensaje que devolvería el server.
    const clientError = validateName(String(formData.get("name") ?? ""));
    if (clientError !== null) {
      setFieldError(clientError);
      return;
    }
    setPending(true);
    setBanner(null);
    setFieldError(null);

    const result = await renameBoxAction(boxId, String(formData.get("name")));

    if (result.ok) {
      router.refresh();
      onClose();
      return;
    }
    setPending(false);

    if (result.error.code === "validation") {
      const mapped = actionFieldErrors(result.error.fieldErrors);
      setFieldError(mapped.name ?? null);
      return;
    }
    if (result.error.code === "unauthorized") {
      setBanner("Tu sesión expiró. Recargá la página e iniciá sesión.");
      return;
    }
    // `not_found` / `forbidden` genérico: la box ya no existe (o fue dejada
    // de compartir) o el permiso cambió; refrescar sincroniza la lista.
    setBanner("No tenés permiso para renombrar esta alcancía.");
  }

  return (
    <Modal onClose={onClose} title="Renombrar alcancía">
      <form action={handleSubmit} className="flex flex-col gap-4">
        {banner !== null && <FormErrorBanner>{banner}</FormErrorBanner>}

        <div className="flex flex-col gap-1.5">
          <label
            className="text-sm font-medium text-muted"
            htmlFor="rename-box-name"
          >
            Nombre
          </label>
          <input
            aria-describedby={fieldError ? NAME_ERROR_ID : undefined}
            aria-invalid={fieldError !== null ? true : undefined}
            className="h-10 w-full rounded-md border border-line bg-elevated px-3 text-sm text-fg outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
            id="rename-box-name"
            maxLength={BOX_NAME_MAX_LENGTH}
            name="name"
            onChange={(event) => {
              setName(event.target.value);
              if (fieldError !== null) {
                setFieldError(null);
              }
            }}
            required
            type="text"
            value={name}
          />
          <FieldError id={NAME_ERROR_ID}>{fieldError ?? undefined}</FieldError>
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-line bg-elevated px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-accent/40 hover:text-fg"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <PrimaryButton disabled={pending} type="submit">
            {pending ? "Guardando…" : "Guardar"}
          </PrimaryButton>
        </div>
      </form>
      <p className="text-xs text-faint">
        Hasta {BOX_NAME_MAX_LENGTH} caracteres.
      </p>
    </Modal>
  );
}
