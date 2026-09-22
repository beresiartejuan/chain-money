import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  type LoginInput,
  loginSchema,
  type RecoverInput,
  type RegisterInput,
  recoverSchema,
  registerSchema,
} from "@/lib/validation/auth";

const VALID_REGISTER: RegisterInput = {
  email: "ana@example.com",
  password: "contrasena-segura",
  name: "Ana Pérez",
};

const VALID_LOGIN: LoginInput = {
  email: "ana@example.com",
  password: "cualquier-cosa", // login no aplica política de fortaleza
};

const VALID_RECOVER: RecoverInput = {
  email: "ana@example.com",
  phrase:
    "abanico barril camello dado espada falda gato humo idea jaula koala lima",
  newPassword: "nueva-contrasena",
};

/** Mensaje del primer issue del campo dado (o `undefined` si parsea ok). */
function fieldIssue(
  result: { success: false; error: z.ZodError } | { success: true },
  field: string,
): string | undefined {
  if (result.success) {
    return undefined;
  }
  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

describe("registerSchema", () => {
  it("acepta un payload válido y normaliza el nombre (trim)", () => {
    const result = registerSchema.safeParse({
      email: "ana@example.com",
      password: "contrasena-segura",
      name: "  Ana Pérez  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Ana Pérez");
      expect(result.data.email).toBe("ana@example.com");
    }
  });

  it("rechaza un email con formato inválido y reporta el campo email", () => {
    for (const bad of ["no-email", "ana@", "ana example.com", ""]) {
      const result = registerSchema.safeParse({
        ...VALID_REGISTER,
        email: bad,
      });
      expect(result.success).toBe(false);
      expect(fieldIssue(result, "email")).toMatch(/formato válido/);
    }
  });

  it("rechaza un email con más de 254 caracteres", () => {
    const longEmail = `a${"a".repeat(250)}@example.com`;
    expect(longEmail.length).toBeGreaterThan(254);
    const result = registerSchema.safeParse({
      ...VALID_REGISTER,
      email: longEmail,
    });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "email")).toMatch(/254 caracteres/);
  });

  it("aplica la política de contraseña cuando es corta", () => {
    const result = registerSchema.safeParse({
      ...VALID_REGISTER,
      password: "corta",
    });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "password")).toMatch(/al menos 8 caracteres/);
  });

  it("aplica la política de contraseña cuando supera 128 caracteres", () => {
    const result = registerSchema.safeParse({
      ...VALID_REGISTER,
      password: "a".repeat(129),
    });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "password")).toMatch(/más de 128 caracteres/);
  });

  it("rechaza un nombre vacío (o solo espacios) y un nombre de 81+ caracteres", () => {
    for (const bad of ["", "   "]) {
      const result = registerSchema.safeParse({ ...VALID_REGISTER, name: bad });
      expect(result.success).toBe(false);
      expect(fieldIssue(result, "name")).toMatch(/obligatorio/);
    }
    const result = registerSchema.safeParse({
      ...VALID_REGISTER,
      name: "a".repeat(81),
    });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "name")).toMatch(/80 caracteres/);
  });

  it("emite el issue del password apuntando al campo password", () => {
    const result = registerSchema.safeParse({
      ...VALID_REGISTER,
      password: "corta",
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected parse failure");
    expect(
      result.error.issues.some(
        (issue: { path: unknown[] }) => issue.path[0] === "password",
      ),
    ).toBe(true);
  });
});

describe("loginSchema", () => {
  it("acepta un payload válido sin política de fortaleza", () => {
    const result = loginSchema.safeParse(VALID_LOGIN);
    expect(result.success).toBe(true);
  });

  it("acepta contraseñas cortas o largas: solo presencia", () => {
    expect(
      loginSchema.safeParse({ ...VALID_LOGIN, password: "a" }).success,
    ).toBe(true);
    expect(
      loginSchema.safeParse({ ...VALID_LOGIN, password: "a".repeat(300) })
        .success,
    ).toBe(true);
  });

  it("rechaza campos vacíos reportando el campo correspondiente", () => {
    const emptyEmail = loginSchema.safeParse({ ...VALID_LOGIN, email: "" });
    expect(emptyEmail.success).toBe(false);
    expect(fieldIssue(emptyEmail, "email")).toMatch(/formato válido/);

    const emptyPassword = loginSchema.safeParse({
      ...VALID_LOGIN,
      password: "",
    });
    expect(emptyPassword.success).toBe(false);
    expect(fieldIssue(emptyPassword, "password")).toMatch(/obligatoria/);
  });
});

describe("recoverSchema", () => {
  it("acepta la frase separada por guiones (12 palabras)", () => {
    const result = recoverSchema.safeParse(VALID_RECOVER);
    expect(result.success).toBe(true);
  });

  it("acepta la frase separada por espacios (12 palabras)", () => {
    const result = recoverSchema.safeParse({
      ...VALID_RECOVER,
      phrase: VALID_RECOVER.phrase.replaceAll("-", " "),
    });
    expect(result.success).toBe(true);
  });

  it("acepta separadores mixtos y runs de separadores consecutivos", () => {
    const result = recoverSchema.safeParse({
      ...VALID_RECOVER,
      phrase:
        "abanico  barril -camello-  dado espada falda gato humo idea jaula koala lima",
    });
    expect(result.success).toBe(true);
  });

  it("rechaza una frase de 11 palabras", () => {
    const result = recoverSchema.safeParse({
      ...VALID_RECOVER,
      phrase:
        "abanico barril camello dado espada falda gato humo idea jaula koala",
    });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "phrase")).toMatch(/12 palabras/);
  });

  it("rechaza una frase de 13 palabras", () => {
    const result = recoverSchema.safeParse({
      ...VALID_RECOVER,
      phrase:
        "abanico barril camello dado espada falda gato humo idea jaula koala lima extra",
    });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "phrase")).toMatch(/12 palabras/);
  });

  it("rechaza palabras con mayúsculas, números o símbolos (solo a-z)", () => {
    const upper = recoverSchema.safeParse({
      ...VALID_RECOVER,
      phrase: VALID_RECOVER.phrase.replace("abanico", "Abanico"),
    });
    expect(upper.success).toBe(false);
    expect(fieldIssue(upper, "phrase")).toMatch(/minúsculas/);

    const digits = recoverSchema.safeParse({
      ...VALID_RECOVER,
      phrase: VALID_RECOVER.phrase.replace("lima", "lima1"),
    });
    expect(digits.success).toBe(false);
    expect(fieldIssue(digits, "phrase")).toMatch(/minúsculas/);
  });

  it("aplica la misma política de contraseña a newPassword", () => {
    const short = recoverSchema.safeParse({
      ...VALID_RECOVER,
      newPassword: "corta",
    });
    expect(short.success).toBe(false);
    expect(fieldIssue(short, "newPassword")).toMatch(/al menos 8 caracteres/);

    const long = recoverSchema.safeParse({
      ...VALID_RECOVER,
      newPassword: "a".repeat(129),
    });
    expect(long.success).toBe(false);
    expect(fieldIssue(long, "newPassword")).toMatch(/más de 128 caracteres/);
  });

  it("rechaza un email inválido y reporta el campo email", () => {
    const result = recoverSchema.safeParse({ ...VALID_RECOVER, email: "nope" });
    expect(result.success).toBe(false);
    expect(fieldIssue(result, "email")).toMatch(/formato válido/);
  });
});
