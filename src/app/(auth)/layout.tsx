import type { Metadata } from "next";

import type { ReactNode } from "react";

/**
 * Layout compartido por las páginas de auth (T037/T038/T039): route group
 * `(auth)`, sin efecto en la URL. Card centrada en pantalla completa.
 */
export const metadata: Metadata = {
  title: "Chain Money",
  description: "Alcancías de ahorro compartidas",
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Chain Money
        </h1>
        {children}
      </div>
    </div>
  );
}
