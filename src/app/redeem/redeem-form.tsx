"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  FormErrorBanner,
  SubmitButton,
} from "@/app/(auth)/_components/form-fields";
import { redeemTokenAction } from "@/server/tokens/actions";

/**
 * T078 — Formulario de canje de tokens (`/redeem`).
 *
 * - Input para pegar el token crudo (base64url de 43 chars). Feedback de
 *   formato SOFT: si el largo no es 43 o hay caracteres inválidos se muestra
 *   un hint, pero NUNCA bloquea el submit — el server decide (`token_invalid`
 *   cubre "malformado" e "inexistente" sin distinguirlos).
 * - Confirmación previa (paso 2) cuando el formato es plausible: el nombre
 *   de la alcancía y los permisos NO se pueden previsualizar (la API no los
 *   expone antes del canje), así que el panel lo aclara en lugar de mostrarlos.
 * - Errores de la action mapeados a mensajes en español, con genérico para
 *   códigos no previstos (misma postura que `auth-messages.ts`).
 * - Éxito → `router.push` a la alcancía (`/dashboard/boxes/{boxId}`).
 */

/** Largo del token crudo: 32 bytes (SHA-256) en base64url sin padding. */
const RAW_TOKEN_LENGTH = 43;

/** Alfabeto base64url: el shape de caracteres que produce el token. */
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Mensaje de formato incompleto (hint, no error: el server decide). */
const FORMAT_HINT = "El token parece incompleto";

/** Mensajes en español por código de error de `redeemTokenAction`. */
const REDEEM_ERROR_MESSAGES: Record<string, string> = {
  token_invalid: "Token inválido o inexistente",
  token_already_redeemed: "Este token ya fue utilizado",
  token_expired: "Este token expiró",
  own_box_redeem: "No puedes canjear el token de tu propia alcancía",
  rate_limited: "Demasiados intentos. Espera un momento e inténtalo de nuevo",
};

/** Mensaje genérico para `validation`, `unauthorized` y códigos no previstos. */
const REDEEM_GENERIC_ERROR = "No se pudo canjear el token";

/** Mapeo puro código → mensaje; desconocidos caen en el genérico. */
function redeemErrorMessage(code: string): string {
  return REDEEM_ERROR_MESSAGES[code] ?? REDEEM_GENERIC_ERROR;
}

/** ¿El token tiene el formato plausible? Solo shape: no valida contenido. */
function isPlausibleToken(token: string): boolean {
  return token.length === RAW_TOKEN_LENGTH && RAW_TOKEN_PATTERN.test(token);
}

/**
 * Campo del token: input mono para pegar, con el hint de formato asociado
 * vía `aria-describedby`. Estilo espejo de `TextField` en `(auth)`, con
 * fuente mono (token de 43 chars) y slot de hint en ámbar (no es error:
 * el submit sigue habilitado).
 */
function TokenField({
  value,
  hint,
  onChange,
}: {
  value: string;
  hint: string | null;
  onChange: (value: string) => void;
}) {
  const hintId = "token-format-hint";
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="token"
        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        Token de acceso
      </label>
      <input
        id="token"
        name="token"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        required
        aria-describedby={hint !== null ? hintId : undefined}
        className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 font-mono text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10"
        placeholder="Pegá el token acá"
      />
      {hint !== null && (
        <output
          id={hintId}
          className="block text-sm text-amber-600 dark:text-amber-400"
        >
          {hint}
        </output>
      )}
    </div>
  );
}

export function RedeemForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = token.trim();
  const plausible = isPlausibleToken(trimmed);
  const hint = !plausible && trimmed.length > 0 ? FORMAT_HINT : null;

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      // trim(): el paste suele traer espacios o saltos alrededor del token.
      const rawToken = String(formData.get("token") ?? "").trim();

      const result = await redeemTokenAction(rawToken);
      if (result.ok) {
        router.push(`/dashboard/boxes/${result.boxId}`);
        return;
      }
      setError(redeemErrorMessage(result.error.code));
    });
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      action={handleSubmit}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Canjear token
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Pegá el token que te compartieron para obtener acceso a una alcancía.
        </p>
      </div>

      {error !== null && <FormErrorBanner>{error}</FormErrorBanner>}

      <TokenField value={token} hint={hint} onChange={setToken} />

      {plausible && (
        // Paso 2: confirmación previa. El nombre de la alcancía y los
        // permisos solo se conocen después del canje (la API no los expone
        // antes), así que la confirmación lo aclara.
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-400">
          Al canjear vas a obtener acceso a la alcancía asociada a este token.
          Su nombre y los permisos que recibís se muestran al finalizar el
          canje.
        </div>
      )}

      <SubmitButton pending={pending} pendingLabel="Canjeando…">
        Canjear token
      </SubmitButton>
    </form>
  );
}
