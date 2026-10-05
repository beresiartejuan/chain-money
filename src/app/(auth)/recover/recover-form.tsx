"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  FormErrorBanner,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/app/(auth)/_components/form-fields";
import { actionFieldErrors, zodFieldErrors } from "@/app/(auth)/_lib/forms";
import {
  authErrorMessage,
  rateLimitMessage,
  UNEXPECTED_AUTH_ERROR,
} from "@/lib/ui/auth-messages";
import { type RecoverInput, recoverSchema } from "@/lib/validation/auth";
import { recoverAccount } from "@/server/auth/recovery-actions";

/**
 * T039 — Formulario de recuperación de cuenta (sin email).
 *
 * - email + frase (textarea con hint de formato) + nuevo password, validados
 *   client con `recoverSchema`.
 * - `invalid_credentials` → banner genérico "Email, frase o datos
 *   incorrectos": nunca se distingue qué falló.
 * - `rate_limited` → mensaje con la espera (`retryAfterMs`).
 * - Al éxito: redirige a `/login?recovered=1`, que muestra el banner de
 *   confirmación.
 */

type RecoverFormState = {
  fieldErrors: Partial<Record<keyof RecoverInput, string>>;
  banner: string | null;
};

const INITIAL_STATE: RecoverFormState = { fieldErrors: {}, banner: null };

/** Genérico de recovery: sobreescribe el de login para este formulario. */
const RECOVERY_OVERRIDES = {
  invalid_credentials: "Email, frase o datos incorrectos.",
} as const;

const PHRASE_HINT = "12 palabras separadas por espacios o guiones";

export function RecoverForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<RecoverFormState>(INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const input = {
        email: String(formData.get("email") ?? ""),
        phrase: String(formData.get("phrase") ?? ""),
        newPassword: String(formData.get("newPassword") ?? ""),
      };

      const parsed = recoverSchema.safeParse(input);
      if (!parsed.success) {
        setErrors({
          fieldErrors: zodFieldErrors(
            parsed.error,
          ) as RecoverFormState["fieldErrors"],
          banner: null,
        });
        return;
      }
      setErrors(INITIAL_STATE);

      const result = await recoverAccount(parsed.data);
      if (result.ok) {
        router.push("/login?recovered=1");
        return;
      }
      if (result.error.code === "validation") {
        setErrors({
          fieldErrors: actionFieldErrors(
            result.error.fieldErrors,
          ) as RecoverFormState["fieldErrors"],
          banner: null,
        });
        return;
      }
      if (result.error.code === "rate_limited") {
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
      if (result.error.code === "invalid_credentials") {
        setErrors({
          fieldErrors: {},
          banner: authErrorMessage("invalid_credentials", RECOVERY_OVERRIDES),
        });
        return;
      }
      setErrors({ fieldErrors: {}, banner: UNEXPECTED_AUTH_ERROR });
    });
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
      action={handleSubmit}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-fg">Recuperar cuenta</h2>
        <p className="text-sm text-muted">
          Usá tu frase de recuperación para setear una contraseña nueva.
        </p>
      </div>

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

      <div className="flex flex-col gap-1.5">
        <TextAreaField
          id="phrase"
          name="phrase"
          label="Frase de recuperación"
          required
          placeholder="palabra-palabra-… (12 palabras)"
          error={errors.fieldErrors.phrase}
        />
        <p className="text-xs text-faint">{PHRASE_HINT}</p>
      </div>

      <div className="relative flex flex-col gap-1.5">
        <TextField
          id="newPassword"
          name="newPassword"
          label="Nueva contraseña"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          error={errors.fieldErrors.newPassword}
        />
        <button
          type="button"
          onClick={() => setShowPassword((value) => !value)}
          className="absolute right-2 top-8 text-sm font-medium text-muted underline underline-offset-2 hover:text-fg"
        >
          {showPassword ? "Ocultar" : "Mostrar"}
        </button>
      </div>

      <SubmitButton pending={pending} pendingLabel="Recuperando…">
        Recuperar cuenta
      </SubmitButton>

      <p className="text-center text-sm text-muted">
        ¿Recordaste la contraseña?{" "}
        <a
          href="/login"
          className="font-medium text-accent underline underline-offset-2 hover:text-fg"
        >
          Volvé al login
        </a>
      </p>
    </form>
  );
}
