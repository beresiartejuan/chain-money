"use client";

import type { ComponentProps } from "react";

/**
 * Componentes de formulario reutilizables para la UI de auth (T037–T039).
 * Componentes cliente simples y sin estado: los formularios pasan label,
 * error y props del input. Estética Tailwind compartida con el layout
 * `(auth)`.
 */

/** Texto de error bajo un campo, en rojo, con id estable para aria-describedby. */
export function FormError({ id, children }: { id: string; children?: string }) {
  if (!children) {
    return null;
  }
  return (
    <p id={id} className="text-sm text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}

/** Etiqueta de campo: obligatoria, amarra el input con `htmlFor`. */
function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
    >
      {children}
    </label>
  );
}

/**
 * Input de texto con label y error integrados. `error` muestra el mensaje y
 * lo asocia al input con `aria-invalid` + `aria-describedby`.
 */
export function TextField({
  id,
  label,
  error,
  ...inputProps
}: Omit<ComponentProps<"input">, "id"> & {
  id: string;
  label: string;
  error?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10"
        {...inputProps}
      />
      <FormError id={errorId}>{error}</FormError>
    </div>
  );
}

/** Textarea con label y error integrados (frase de recuperación en /recover). */
export function TextAreaField({
  id,
  label,
  error,
  ...textareaProps
}: Omit<ComponentProps<"textarea">, "id"> & {
  id: string;
  label: string;
  error?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10"
        {...textareaProps}
      />
      <FormError id={errorId}>{error}</FormError>
    </div>
  );
}

/** Botón de submit con estado pendiente, deshabilitado mientras `pending`. */
export function SubmitButton({
  pending,
  children,
  pendingLabel = "Enviando…",
}: {
  pending: boolean;
  children: string;
  pendingLabel?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 w-full rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Aviso de error de nivel formulario (código de la action, no por campo). */
export function FormErrorBanner({ children }: { children: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
    >
      {children}
    </div>
  );
}

/** Banner de éxito (p. ej. confirmación de recovery en /login). */
export function FormSuccessBanner({ children }: { children: string }) {
  return (
    <output className="block rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-300">
      {children}
    </output>
  );
}
