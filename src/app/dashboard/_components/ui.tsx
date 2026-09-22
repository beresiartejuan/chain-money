import type { MouseEventHandler, ReactNode } from "react";

/**
 * Componentes de UI reutilizables del dashboard (T069). Server-safe (sin
 * estado ni handlers propios): el caller decide qué acciones renderiza
 * dentro de la card (T071: el botón de renombrar solo para owner). Misma
 * estética Tailwind que el layout `(auth)`.
 */

/** Card contenedora de superficie clara, compartida con los formularios. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {children}
    </div>
  );
}

type ButtonProps = {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: "button" | "submit";
};

/** Botón secundario compacto (acciones sobre una card, ej. renombrar). */
export function SmallButton({ children, ...buttonProps }: ButtonProps) {
  return (
    <button
      type="button"
      className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
      {...buttonProps}
    >
      {children}
    </button>
  );
}

/** Botón primario compacto (CTA principal, ej. crear alcancía). */
export function PrimaryButton({ children, ...buttonProps }: ButtonProps) {
  return (
    <button
      type="button"
      className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      {...buttonProps}
    >
      {children}
    </button>
  );
}

/** Badge informativo compacto (ej. "Compartida"). */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </span>
  );
}
