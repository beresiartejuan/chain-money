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
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-b from-[#34e0a1] to-[#26b07f] shadow-[0_0_16px_rgba(46,225,155,0.35)]">
            <svg
              viewBox="0 0 26 26"
              fill="none"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <ellipse cx="13.8" cy="14.4" rx="6.9" ry="5.7" fill="#f8a9c0" />
              <path
                d="M16.9 9.1c1.4-1 3-.5 3.4.5.3 1-.5 2-1.8 2.2"
                fill="#f8a9c0"
              />
              <path
                d="M10.6 18.4v2M16.6 18.4v2"
                stroke="#ef8fb0"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
              <ellipse cx="7.7" cy="14.9" rx="2.1" ry="1.7" fill="#ef8fb0" />
              <path
                d="M7.1 14.6v.9M8.3 14.6v.9"
                stroke="#c25e7e"
                strokeWidth="0.9"
                strokeLinecap="round"
              />
              <circle cx="11.2" cy="12.4" r="0.8" fill="#c25e7e" />
            </svg>
          </span>
          <span className="text-xl font-semibold tracking-tight text-fg">
            Chain Money
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
