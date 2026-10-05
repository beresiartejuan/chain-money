import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";
import { RedeemForm } from "./redeem-form";

/** T078 — /redeem: canje de tokens de acceso (ruta privada). */
export const metadata: Metadata = {
  title: "Canjear token",
};

export default async function RedeemPage() {
  // El proxy ya manda a /login sin cookie de sesión (chequeo barato); esta
  // es la validación real contra la DB: sesión expirada o inexistente →
  // /login. La action vuelve a chequear por su cuenta.
  const user = await getCurrentUser();
  if (user === null) {
    redirect("/login");
  }

  return (
    // Mismo espíritu que el layout `(auth)`: card centrada en pantalla
    // completa.
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-sm">
        <RedeemForm />
      </div>
    </div>
  );
}
