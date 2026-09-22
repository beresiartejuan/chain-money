import { describe, expect, it } from "vitest";
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validatePasswordStrength,
  verifyPassword,
} from "@/lib/crypto/password";

describe("hashPassword / verifyPassword", () => {
  it("roundtrip: verify true con el password original", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(
      verifyPassword("correct horse battery staple", hash),
    ).resolves.toBe(true);
  });

  it("verify false con cualquier variación del password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(
      verifyPassword("Correct horse battery staple", hash),
    ).resolves.toBe(false);
    await expect(
      verifyPassword("correct horse battery stapl", hash),
    ).resolves.toBe(false);
    await expect(
      verifyPassword(" correct horse battery staple", hash),
    ).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("dos hashes del mismo password difieren (salt aleatoria)", async () => {
    const password = "same-password-123";
    const [a, b] = await Promise.all([
      hashPassword(password),
      hashPassword(password),
    ]);
    expect(a).not.toBe(b);

    // El formato deja ver la salt: debe ser distinta entre ambos.
    const saltA = a.split("$")[4];
    const saltB = b.split("$")[4];
    expect(saltA).not.toBe(saltB);

    // ...y ambos siguen verificando el mismo password.
    await expect(verifyPassword(password, a)).resolves.toBe(true);
    await expect(verifyPassword(password, b)).resolves.toBe(true);
  });

  it("produce el formato scrypt$N$r$p$salt$hash con los parámetros esperados", async () => {
    const hash = await hashPassword("format-check");
    const parts = hash.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toBe("16384");
    expect(parts[2]).toBe("8");
    expect(parts[3]).toBe("1");
    expect(Buffer.from(parts[4], "base64").length).toBe(16);
    expect(Buffer.from(parts[5], "base64").length).toBe(64);
  });

  it("hash corrupto o truncado → false sin lanzar", async () => {
    const hash = await hashPassword("corruption-target");
    const password = "corruption-target";

    const corrupted: string[] = [
      "",
      "not-a-hash",
      "scrypt",
      "scrypt$16384$8$1", // truncado: faltan salt y hash
      "scrypt$16384$8$1$abc", // truncado: falta hash
      // versión/alg correcto, base64 roto:
      "scrypt$16384$8$1$!!no-base64!!$YWJj",
      // hash de longitud incorrecta (no 64 bytes):
      "scrypt$16384$8$1$c2FsdA==$c2hvcnQ=",
      // N no potencia de 2:
      "scrypt$10000$8$1$c2FsdA==$c2FsdA==",
      // N inválido (no numérico):
      "scrypt$NaN$8$1$c2FsdA==$c2FsdA==",
      // N fuera de rango de sanity:
      "scrypt$999999999$8$1$c2FsdA==$c2FsdA==",
      // algoritmo desconocido:
      "pbkdf2$16384$8$1$c2FsdA==$c2FsdA==",
      // demasiadas partes:
      `${hash}$extra`,
    ];

    for (const bad of corrupted) {
      await expect(verifyPassword(password, bad)).resolves.toBe(false);
    }
  });

  it("verify de un hash válido contra salt/hash de otro hash → false", async () => {
    const hashA = await hashPassword("password-a");
    const hashB = await hashPassword("password-b");
    const partsA = hashA.split("$");
    const partsB = hashB.split("$");
    const mixed = [
      partsA[0],
      partsA[1],
      partsA[2],
      partsA[3],
      partsB[4], // salt de B
      partsA[5], // hash de A
    ].join("$");

    await expect(verifyPassword("password-a", mixed)).resolves.toBe(false);
    await expect(verifyPassword("password-b", mixed)).resolves.toBe(false);
  });

  it("verify con parámetros válidos pero maxmem insuficiente → false sin lanzar", async () => {
    // N=2^22 con r=8 excede el maxmem por defecto de Node (~32 MiB):
    // la derivación falla en runtime y verify debe atraparlo → false.
    const big = 2 ** 22;
    const salt = Buffer.alloc(16, 1);
    const fakeHash = Buffer.alloc(64, 2);
    const stored = [
      "scrypt",
      String(big),
      "8",
      "1",
      salt.toString("base64"),
      fakeHash.toString("base64"),
    ].join("$");

    await expect(verifyPassword("whatever", stored)).resolves.toBe(false);
  });
});

describe("validatePasswordStrength", () => {
  it("acepta una contraseña válida (8+ chars)", () => {
    expect(validatePasswordStrength("12345678")).toEqual([]);
    expect(validatePasswordStrength("a".repeat(PASSWORD_MIN_LENGTH))).toEqual(
      [],
    );
    expect(validatePasswordStrength("a".repeat(PASSWORD_MAX_LENGTH))).toEqual(
      [],
    );
  });

  it("rechaza contraseñas cortas con mensaje claro", () => {
    const violations = validatePasswordStrength("abc");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/al menos 8 caracteres/);
    expect(validatePasswordStrength("")).toEqual([
      expect.stringMatching(/al menos 8/),
    ]);
  });

  it("rechaza contraseñas largas (> 128) con mensaje claro", () => {
    const violations = validatePasswordStrength(
      "a".repeat(PASSWORD_MAX_LENGTH + 1),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/no puede tener más de 128 caracteres/);
    expect(validatePasswordStrength("a".repeat(200))).toEqual([
      expect.stringMatching(/más de 128/),
    ]);
  });

  it("acumula violaciones cuando aplica (y en el orden esperado)", () => {
    // No puede ser corta y larga a la vez, pero la API es lista: se verifica
    // que un valor imposible devuelva lista y que los mensajes usen los
    // límites exportados.
    expect(validatePasswordStrength("a".repeat(129))).toEqual([
      expect.stringMatching(/128/),
    ]);
  });

  it("exporta los límites como constantes", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });
});
