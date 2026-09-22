import { z } from "zod";
import { validatePasswordStrength } from "@/lib/crypto/password";

/**
 * Límite RFC 5321 del path completo de un email (64 + "@" + dominio ≤ 254).
 * Se aplica sobre el valor tal cual llega, sin recortar.
 */
const EMAIL_MAX_LENGTH = 254;

/** Cantidad de palabras que debe tener la frase de recuperación. */
const PHRASE_WORD_COUNT = 12;

/** Nombre: entre 1 y 80 caracteres tras recortar espacios de los bordes. */
const NAME_MAX_LENGTH = 80;

/**
 * Email para registro/recuperación: formato válido y ≤ 254 caracteres.
 * No se recorta a propósito: es el identificador de cuenta y el proyecto
 * decide no normalizar datos en silencio (misma postura que
 * `isSupportedCurrency` en `src/lib/currency.ts`).
 */
const emailSchema = z
  .email({ error: "El email no tiene un formato válido." })
  .max(EMAIL_MAX_LENGTH, {
    error: `El email no puede tener más de ${EMAIL_MAX_LENGTH} caracteres.`,
  });

/**
 * Contraseña con la política compartida de `@/lib/crypto/password`
 * (mínimo 8 y máximo 128). La política se integra con `.superRefine()` y
 * emite como issue la primera violación reportada por
 * `validatePasswordStrength`, apuntando al campo: el formulario muestra
 * exactamente el mismo mensaje que devolvería el server.
 */
function passwordWithPolicy(): z.ZodString {
  return z
    .string({ error: "La contraseña es obligatoria." })
    .superRefine((value: string, ctx: z.core.$RefinementCtx<string>) => {
      for (const violation of validatePasswordStrength(value)) {
        ctx.addIssue({ code: "custom", message: violation });
        break;
      }
    });
}

/**
 * Frase de recuperación: 12 palabras separadas por guiones o espacios, cada
 * una con caracteres ASCII minúsculas (`a-z`). Solo formato: la verificación
 * contra la wordlist BIP-39 es responsabilidad de T031.
 */
const phraseSchema = z
  .string({ error: "La frase de recuperación es obligatoria." })
  .superRefine((value: string, ctx: z.core.$RefinementCtx<string>) => {
    const words = value.split(/[\s-]+/).filter((word) => word.length > 0);

    if (words.length !== PHRASE_WORD_COUNT) {
      ctx.addIssue({
        code: "custom",
        message: `La frase debe tener ${PHRASE_WORD_COUNT} palabras separadas por guiones o espacios.`,
      });
      return;
    }

    if (!words.every((word) => /^[a-z]+$/.test(word))) {
      ctx.addIssue({
        code: "custom",
        message:
          "Cada palabra de la frase debe contener solo letras minúsculas.",
      });
    }
  });

/**
 * Schemas de validación compartidos entre server actions y formularios
 * cliente. Los mensajes de error están en español y cada issue apunta al
 * campo que la originó.
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordWithPolicy(),
  name: z
    .string({ error: "El nombre es obligatorio." })
    .trim()
    .min(1, { error: "El nombre es obligatorio." })
    .max(NAME_MAX_LENGTH, {
      error: `El nombre no puede tener más de ${NAME_MAX_LENGTH} caracteres.`,
    }),
});

export const loginSchema = z.object({
  email: z
    .email({ error: "El email no tiene un formato válido." })
    .max(EMAIL_MAX_LENGTH, {
      error: `El email no puede tener más de ${EMAIL_MAX_LENGTH} caracteres.`,
    }),
  password: z
    .string({ error: "La contraseña es obligatoria." })
    .min(1, { error: "La contraseña es obligatoria." }),
});

export const recoverSchema = z.object({
  email: emailSchema,
  phrase: phraseSchema,
  newPassword: passwordWithPolicy(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RecoverInput = z.infer<typeof recoverSchema>;
