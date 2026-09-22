"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormErrorBanner } from "@/app/(auth)/_components/form-fields";
import { actionFieldErrors } from "@/app/(auth)/_lib/forms";
import { currencyOptions } from "@/app/dashboard/_lib/currency-ui";
import {
  BOX_NAME_MAX_LENGTH,
  BOX_NAME_MIN_LENGTH,
} from "@/lib/validation/box-name";
import { createBoxAction } from "@/server/boxes/actions";
import { Modal } from "./modal";
import { PrimaryButton } from "./ui";

/**
 * T070 — Diálogo de creación de alcancía en `/dashboard`.
 *
 * - Select de moneda poblado SOLO con las claves de `CURRENCY_EXPONENTS`
 *   (catálogo cerrado) con nombre legible; default ARS (público local).
 * - Errores server reflejados: `limit_reached` → banner con el tope;
 *   `validation` → mensajes por campo (id stable para aria-describedby).
 * - Al crear: `router.refresh()` re-renderiza la page server con la lista
 *   actualizada (la action es delgada y no toca el cache de la ruta).
 */

/** Texto de error bajo un campo, en rojo, con id estable para a11y. */
function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) {
    return null;
  }
  return (
    <p className="text-sm text-red-600 dark:text-red-400" id={id}>
      {children}
    </p>
  );
}

const inputClassName =
  "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10";

const labelClassName = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

export function CreateBoxDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    setBanner(null);
    setFieldErrors({});

    const result = await createBoxAction({
      name: String(formData.get("name") ?? ""),
      currency: String(formData.get("currency") ?? ""),
    });

    if (result.ok) {
      // La nueva alcancía debe aparecer en la lista server-renderizada.
      router.refresh();
      onClose();
      return;
    }
    setPending(false);

    if (result.error.code === "validation") {
      setFieldErrors(actionFieldErrors(result.error.fieldErrors));
      return;
    }
    if (result.error.code === "limit_reached") {
      setBanner(`Alcanzaste el límite de ${result.error.maxBoxes} alcancías.`);
      return;
    }
    setBanner("No se pudo crear la alcancía. Intentá de nuevo.");
  }

  return (
    <Modal onClose={onClose} title="Nueva alcancía">
      <form action={handleSubmit} className="flex flex-col gap-4">
        {banner !== null && <FormErrorBanner>{banner}</FormErrorBanner>}

        <div className="flex flex-col gap-1.5">
          <label className={labelClassName} htmlFor="create-box-name">
            Nombre
          </label>
          <input
            aria-describedby={
              fieldErrors.name ? "create-box-name-error" : undefined
            }
            aria-invalid={fieldErrors.name ? true : undefined}
            className={inputClassName}
            id="create-box-name"
            maxLength={BOX_NAME_MAX_LENGTH}
            name="name"
            required
            type="text"
          />
          <FieldError id="create-box-name-error">{fieldErrors.name}</FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelClassName} htmlFor="create-box-currency">
            Moneda
          </label>
          <select
            aria-describedby={
              fieldErrors.currency ? "create-box-currency-error" : undefined
            }
            aria-invalid={fieldErrors.currency ? true : undefined}
            className={inputClassName}
            defaultValue="ARS"
            id="create-box-currency"
            name="currency"
          >
            {currencyOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError id="create-box-currency-error">
            {fieldErrors.currency}
          </FieldError>
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <PrimaryButton disabled={pending} type="submit">
            {pending ? "Creando…" : "Crear alcancía"}
          </PrimaryButton>
        </div>
      </form>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        El nombre debe tener entre {BOX_NAME_MIN_LENGTH} y {BOX_NAME_MAX_LENGTH}{" "}
        caracteres.
      </p>
    </Modal>
  );
}
