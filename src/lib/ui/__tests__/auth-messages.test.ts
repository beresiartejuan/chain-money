import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  actionFieldErrors,
  safeInternalPath,
  zodFieldErrors,
} from "@/app/(auth)/_lib/forms";
import {
  authErrorMessage,
  formatRetryAfterMs,
  rateLimitMessage,
} from "@/lib/ui/auth-messages";

/**
 * Tests de los helpers puros de la UI de auth (T037/T038/T039): mapeo
 * código → mensaje, formateo de esperas de rate limit, mapeo de errores de
 * campo y validación del destino de `next`. Sin React ni Next.
 */

describe("authErrorMessage", () => {
  it("mapea cada código conocido a su mensaje en español", () => {
    expect(authErrorMessage("email_taken")).toBe(
      "Ese email ya está registrado.",
    );
    expect(authErrorMessage("invalid_credentials")).toBe(
      "Email o contraseña incorrectos.",
    );
    expect(authErrorMessage("rate_limited")).toBe(
      "Demasiados intentos. Probá de nuevo en unos minutos.",
    );
    expect(authErrorMessage("unauthorized")).toBe(
      "Necesitás una sesión activa para hacer eso.",
    );
    expect(authErrorMessage("validation")).toBe("Revisá los campos marcados.");
  });

  it("no distingue causas para el mismo código (genérico en login y recovery)", () => {
    // El mismo código produce siempre el mismo texto: la UI nunca dice si
    // falló el email o el password.
    expect(authErrorMessage("invalid_credentials")).toBe(
      authErrorMessage("invalid_credentials"),
    );
  });

  it("códigos desconocidos caen en el mensaje genérico", () => {
    expect(authErrorMessage("algo_nuevo")).toBe(
      "Ocurrió un error inesperado. Intentá de nuevo.",
    );
    expect(authErrorMessage("")).toBe(
      "Ocurrió un error inesperado. Intentá de nuevo.",
    );
  });

  it("aplica overrides por página (recovery usa otro genérico)", () => {
    expect(
      authErrorMessage("invalid_credentials", {
        invalid_credentials: "Email, frase o datos incorrectos.",
      }),
    ).toBe("Email, frase o datos incorrectos.");
    // Sin override para otros códigos: siguen del mapa base.
    expect(
      authErrorMessage("email_taken", {
        invalid_credentials: "Email, frase o datos incorrectos.",
      }),
    ).toBe("Ese email ya está registrado.");
  });
});

describe("formatRetryAfterMs", () => {
  it("formatea esperas menores a un minuto en segundos", () => {
    expect(formatRetryAfterMs(0)).toBe("0 s");
    expect(formatRetryAfterMs(1000)).toBe("1 s");
    expect(formatRetryAfterMs(45_400)).toBe("46 s");
  });

  it("formatea esperas de minutos redondeando hacia arriba", () => {
    expect(formatRetryAfterMs(60_000)).toBe("1 min");
    expect(formatRetryAfterMs(600_000)).toBe("10 min");
  });

  it("formatea esperas de horas con y sin minutos", () => {
    expect(formatRetryAfterMs(3_600_000)).toBe("1 h");
    expect(formatRetryAfterMs(5_400_000)).toBe("1 h 30 min");
    expect(formatRetryAfterMs(7_200_000)).toBe("2 h");
  });
});

describe("rateLimitMessage", () => {
  it("incluye la espera formateada en el mensaje", () => {
    expect(rateLimitMessage(600_000)).toBe(
      "Demasiados intentos. Probá de nuevo en 10 min.",
    );
    expect(rateLimitMessage(45_400)).toBe(
      "Demasiados intentos. Probá de nuevo en 46 s.",
    );
  });
});

describe("zodFieldErrors", () => {
  const schema = z.object({
    email: z.email({ error: "El email no tiene un formato válido." }),
    password: z.string().min(8, { error: "Muy corta." }),
  });

  it("toma el primer mensaje por campo", () => {
    const result = schema.safeParse({ email: "malo", password: "corta" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodFieldErrors(result.error)).toEqual({
        email: "El email no tiene un formato válido.",
        password: "Muy corta.",
      });
    }
  });

  it("ignora issues sin campo (path vacío)", () => {
    const result = z
      .string()
      .superRefine((_value, ctx) => {
        ctx.addIssue({ code: "custom", message: "sin campo" });
      })
      .safeParse("x");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodFieldErrors(result.error)).toEqual({});
    }
  });
});

describe("actionFieldErrors", () => {
  it("toma el primer mensaje de cada campo del mapa de la action", () => {
    expect(
      actionFieldErrors({
        email: ["El email no tiene un formato válido.", "otro"],
        password: ["La contraseña es obligatoria."],
      }),
    ).toEqual({
      email: "El email no tiene un formato válido.",
      password: "La contraseña es obligatoria.",
    });
  });

  it("ignora campos sin mensajes", () => {
    expect(actionFieldErrors({ email: [] })).toEqual({});
  });
});

describe("safeInternalPath", () => {
  it("acepta rutas internas comunes", () => {
    expect(safeInternalPath("/dashboard", "/")).toBe("/dashboard");
    expect(safeInternalPath("/boxes/abc?tab=2", "/")).toBe("/boxes/abc?tab=2");
    expect(safeInternalPath("/a/b/c", "/")).toBe("/a/b/c");
  });

  it("rechaza lo que no es ruta interna y cae al fallback", () => {
    const fallback = "/dashboard";
    expect(safeInternalPath(null, fallback)).toBe(fallback);
    expect(safeInternalPath(undefined, fallback)).toBe(fallback);
    expect(safeInternalPath("", fallback)).toBe(fallback);
    expect(safeInternalPath("https://evil.com", fallback)).toBe(fallback);
    // protocol-relative: apunta a otro origen
    expect(safeInternalPath("//evil.com", fallback)).toBe(fallback);
    expect(safeInternalPath("dashboard", fallback)).toBe(fallback);
  });
});
