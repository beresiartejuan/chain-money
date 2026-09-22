"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import {
  FormErrorBanner,
  FormSuccessBanner,
  SubmitButton,
  TextField,
} from "@/app/(auth)/_components/form-fields";
import {
  actionFieldErrors,
  safeInternalPath,
  zodFieldErrors,
} from "@/app/(auth)/_lib/forms";
import {
  authErrorMessage,
  rateLimitMessage,
  UNEXPECTED_AUTH_ERROR,
} from "@/lib/ui/auth-messages";
import { type LoginInput, loginSchema } from "@/lib/validation/auth";
import { login } from "@/server/auth/actions";

/**
 * T038 — Formulario de login.
 *
 * - Validación client con `loginSchema` (mensajes por campo).
 * - `invalid_credentials` → un único banner genérico: nunca se distingue si
 *   falló el email o el password.
 * - `rate_limited` → mensaje con la espera (`retryAfterMs` de la action).
 * - Query param `next` (lo setea el middleware en T040): tras loguear,
 *   redirige a esa ruta interna; los destinos no seguros caen en
 *   `/dashboard`.
 */

type LoginFormState = {
  fieldErrors: Partial<Record<keyof LoginInput, string>>;
  banner: string | null;
};

const INITIAL_STATE: LoginFormState = { fieldErrors: {}, banner: null };

/** Mensaje de confirmación que muestra /login tras un recovery exitoso. */
const RECOVERED_BANNER =
  "Tu contraseña se actualizó. Iniciá sesión con la nueva.";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<LoginFormState>(INITIAL_STATE);
  const [recovered, setRecovered] = useState(
    searchParams.get("recovered") === "1",
  );

  const nextPath = safeInternalPath(searchParams.get("next"), "/dashboard");

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const input = {
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      };

      const parsed = loginSchema.safeParse(input);
      if (!parsed.success) {
        setErrors({
          fieldErrors: zodFieldErrors(
            parsed.error,
          ) as LoginFormState["fieldErrors"],
          banner: null,
        });
        return;
      }
      setErrors(INITIAL_STATE);
      setRecovered(false);

      const result = await login(parsed.data);
      if (result.ok) {
        router.push(nextPath);
        return;
      }
      if (result.error.code === "validation") {
        setErrors({
          fieldErrors: actionFieldErrors(
            result.error.fieldErrors,
          ) as LoginFormState["fieldErrors"],
          banner: null,
        });
        return;
      }
      // `rate_limited` no está (todavía) en el tipo de `AuthActionError`,
      // pero la action lo puede devolver cuando T030 se integre al login:
      // se maneja defensivamente leyendo `retryAfterMs` si viene.
      const code: string = result.error.code;
      if (code === "rate_limited") {
        const retryAfterMs =
          "retryAfterMs" in result.error
            ? (result.error as { retryAfterMs: number }).retryAfterMs
            : 0;
        setErrors({
          fieldErrors: {},
          banner: rateLimitMessage(retryAfterMs),
        });
        return;
      }
      if (code === "invalid_credentials") {
        setErrors({
          fieldErrors: {},
          banner: authErrorMessage("invalid_credentials"),
        });
        return;
      }
      setErrors({ fieldErrors: {}, banner: UNEXPECTED_AUTH_ERROR });
    });
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      action={handleSubmit}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Iniciar sesión
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Entrá con tu email y contraseña.
        </p>
      </div>

      {recovered && <FormSuccessBanner>{RECOVERED_BANNER}</FormSuccessBanner>}
      {errors.banner !== null && (
        <FormErrorBanner>{errors.banner}</FormErrorBanner>
      )}

      <TextField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={errors.fieldErrors.email}
      />
      <TextField
        id="password"
        name="password"
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        required
        error={errors.fieldErrors.password}
      />

      <SubmitButton pending={pending} pendingLabel="Ingresando…">
        Iniciar sesión
      </SubmitButton>

      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        ¿No tenés cuenta?{" "}
        <Link
          href="/register"
          className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
        >
          Creá una
        </Link>
      </p>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        ¿Olvidaste tu contraseña?{" "}
        <Link
          href="/recover"
          className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
        >
          Recuperá tu cuenta
        </Link>
      </p>
    </form>
  );
}
