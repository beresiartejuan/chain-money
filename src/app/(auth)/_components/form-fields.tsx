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
    <p id={id} className="text-sm text-red-400">
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
    <label htmlFor={htmlFor} className="block text-sm font-medium text-muted">
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
        className="h-10 w-full rounded-md border border-line bg-elevated px-3 text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
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
        className="min-h-24 w-full rounded-md border border-line bg-elevated px-3 py-2 font-mono text-sm text-fg outline-none transition-colors placeholder:text-faint focus:border-accent/60 focus:ring-2 focus:ring-accent/15"
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
      className="h-10 w-full rounded-md bg-accent px-4 text-sm font-semibold text-black transition-shadow hover:shadow-[0_0_16px_rgba(46,225,155,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
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
      className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      {children}
    </div>
  );
}

/** Banner de éxito (p. ej. confirmación de recovery en /login). */
export function FormSuccessBanner({ children }: { children: string }) {
  return (
    <output className="block rounded-md border border-accent/30 bg-accent-dim px-3 py-2 text-sm text-accent">
      {children}
    </output>
  );
}
