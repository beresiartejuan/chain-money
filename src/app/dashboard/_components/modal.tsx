"use client";

import { useEffect, useRef } from "react";

/**
 * T070/T071 — Modal accesible base para los diálogos del dashboard
 * (crear/renombrar alcancía). Componente cliente mínimo: overlay visual +
 * panel centrado con `role="dialog"`/`aria-modal`, foco inicial en el
 * panel, cierre con Escape y con click fuera del panel (ambos vía listener
 * en `document`, sin handlers de interacción en elementos estáticos). El
 * contenido (form) lo pasa el caller via `children`.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Ref del handler para que el listener siempre cierre sobre la última
  // versión de `onClose` sin re-suscribir en cada render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    }
    function onPointerDown(event: MouseEvent) {
      // Click fuera del panel cierra; dentro (inputs, botones) no.
      if (
        panelRef.current !== null &&
        event.target instanceof Node &&
        !panelRef.current.contains(event.target)
      ) {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-sm">
      <div
        aria-label={title}
        aria-modal="true"
        className="flex max-h-full w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-lg focus:outline-none"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg">{title}</h2>
          <button
            aria-label="Cerrar"
            className="-me-1 -mt-1 rounded-md p-1 text-muted transition-colors hover:bg-elevated hover:text-fg"
            onClick={onClose}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
