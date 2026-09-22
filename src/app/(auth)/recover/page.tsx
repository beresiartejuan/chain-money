import type { Metadata } from "next";

import { RecoverForm } from "./recover-form";

/** T039 — /recover: recuperación con email + frase + nuevo password. */
export const metadata: Metadata = {
  title: "Recuperar cuenta",
};

export default function RecoverPage() {
  return <RecoverForm />;
}
