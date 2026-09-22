import type { Metadata } from "next";

import { RegisterForm } from "./register-form";

/** T037 — /register: registro + frase de recuperación (una sola vez). */
export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default function RegisterPage() {
  return <RegisterForm />;
}
