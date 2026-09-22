"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  FormErrorBanner,
  SubmitButton,
  TextField,
} from "@/app/(auth)/_components/form-fields";
import { actionFieldErrors, zodFieldErrors } from "@/app/(auth)/_lib/forms";
import {
  authErrorMessage,
  UNEXPECTED_AUTH_ERROR,
} from "@/lib/ui/auth-messages";
import { type RegisterInput, registerSchema } from "@/lib/validation/auth";
import { register } from "@/server/auth/actions";

/**
 * T037 — Formulario de registro.
 *
 * Paso 1: name/email/password con validación client (`registerSchema`).
 * Paso 2: la frase de recuperación se muestra **una sola vez**. Vive solo en
 * el estado local de este componente (`useState`): nunca en localStorage ni
 * sessionStorage ni en otro estado global; al desmontar (cambiar de página)
 * desaparece.
 *
 * La validación corre en el cliente (mensajes por campo sin roundtrip) y la
 * action se invoca desde el submit del `<form>` dentro de un transition:
 * devuelve un resultado tipado plano (`AuthActionResult`), no `FormData`.
 */

/** Errores por campo + banner de nivel form (códigos de la action). */
type RegisterFormState = {
  fieldErrors: Partial<Record<keyof RegisterInput, string>>;
  banner: string | null;
};

const INITIAL_STATE: RegisterFormState = { fieldErrors: {}, banner: null };

export function RegisterForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<RegisterFormState>(INITIAL_STATE);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

  if (recoveryPhrase !== null) {
    return (
      <RecoveryPhraseStep
        recoveryPhrase={recoveryPhrase}
        onDone={() => router.push("/dashboard")}
      />
    );
  }

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const input = {
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
      };

      // Validación client: mismos mensajes que devolvería el server.
      const parsed = registerSchema.safeParse(input);
      if (!parsed.success) {
        setErrors({
          fieldErrors: zodFieldErrors(
            parsed.error,
          ) as RegisterFormState["fieldErrors"],
          banner: null,
        });
        return;
      }
      setErrors(INITIAL_STATE);

      const result = await register(parsed.data);
      if (result.ok) {
        // `register` siempre devuelve `recoveryPhrase` cuando `ok` (el tipo
        // de la action lo modela como unión por el login compartido).
        setRecoveryPhrase(
          (result as { recoveryPhrase: string }).recoveryPhrase,
        );
        return;
      }
      if (result.error.code === "validation") {
        setErrors({
          fieldErrors: actionFieldErrors(
            result.error.fieldErrors,
          ) as RegisterFormState["fieldErrors"],
          banner: null,
        });
        return;
      }
      if (result.error.code === "email_taken") {
        setErrors({
          fieldErrors: { email: authErrorMessage("email_taken") },
          banner: null,
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
          Crear cuenta
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Registrá tu email, nombre y contraseña.
        </p>
      </div>

      {errors.banner !== null && (
        <FormErrorBanner>{errors.banner}</FormErrorBanner>
      )}

      <TextField
        id="name"
        name="name"
        label="Nombre"
        type="text"
        autoComplete="name"
        required
        error={errors.fieldErrors.name}
      />
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
        autoComplete="new-password"
        required
        error={errors.fieldErrors.password}
      />

      <SubmitButton pending={pending} pendingLabel="Creando cuenta…">
        Crear cuenta
      </SubmitButton>

      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        ¿Ya tenés cuenta?{" "}
        <Link
          href="/login"
          className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
        >
          Iniciá sesión
        </Link>
      </p>
    </form>
  );
}

/** Paso post-registro: la frase, copiar y confirmación para continuar. */
function RecoveryPhraseStep({
  recoveryPhrase,
  onDone,
}: {
  recoveryPhrase: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(recoveryPhrase);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Guardá tu frase de recuperación
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Es la única forma de recuperar tu cuenta si olvidás la contraseña. No
          se envía por email y solo se muestra esta vez.
        </p>
      </div>

      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
        <p className="break-words font-mono text-sm leading-6 text-zinc-900 dark:text-zinc-100">
          {recoveryPhrase}
        </p>
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className="h-10 w-full rounded-md border border-zinc-300 bg-white text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        {copied ? "¡Copiada!" : "Copiar frase"}
      </button>

      <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 size-4 rounded border-zinc-300 dark:border-zinc-600"
        />
        La guardé en un lugar seguro
      </label>

      <button
        type="button"
        onClick={onDone}
        disabled={!confirmed}
        className="h-10 w-full rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Continuar
      </button>
    </div>
  );
}
