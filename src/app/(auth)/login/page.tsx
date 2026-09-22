import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "./login-form";

/** T038 — /login: login con errores genéricos + banner post-recovery. */
export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default function LoginPage() {
  return (
    // `LoginForm` usa `useSearchParams` (param `next` de T040 y `recovered`
    // de T039): envuelto en Suspense para poder prerenderizar la página.
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
