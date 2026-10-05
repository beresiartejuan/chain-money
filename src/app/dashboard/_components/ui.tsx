import type { MouseEventHandler, ReactNode } from "react";

/**
 * Componentes de UI reutilizables del dashboard (T069). Server-safe (sin
 * estado ni handlers propios): el caller decide qué acciones renderiza
 * dentro de la card (T071: el botón de renombrar solo para owner). Usa los
 * tokens de marca de `globals.css` (tema verde-negro de la landing, T103b).
 */

/** Card contenedora de superficie elevada, compartida con los formularios. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
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
      className="rounded-md border border-line bg-elevated px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:border-accent/40 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
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
      className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black transition-shadow hover:shadow-[0_0_16px_rgba(46,225,155,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
      {...buttonProps}
    >
      {children}
    </button>
  );
}

/** Badge informativo compacto (ej. "Compartida"). */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-elevated px-2 py-0.5 text-xs font-medium text-muted">
      {children}
    </span>
  );
}
