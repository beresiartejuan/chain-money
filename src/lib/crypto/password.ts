import type { ScryptOptions } from "node:crypto";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Parámetros scrypt de la versión actual del formato. Viajan dentro del propio
 * hash para poder verificar sin estado compartido y para poder subirlos en el
 * futuro sin migrar la base de datos.
 */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH_BYTES = 64;
const SALT_LENGTH_BYTES = 16;

const ALGORITHM = "scrypt";
const HASH_PARTS = 6;

/**
 * Límites de sanity para los parámetros leídos de un hash almacenado: evitan
 * que un registro corrupto o malicioso dispare una derivación con coste
 * absurdo de memoria/CPU antes de ser rechazada.
 */
const MIN_N = 2;
const MAX_N = 2 ** 22;
const MAX_R = 64;
const MAX_P = 16;

/**
 * Envuelve el `scrypt` con callback de `node:crypto` en una promesa con
 * tipos explícitos.
 */
function deriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

/**
 * Hashea `plain` con scrypt (N=16384, r=8, p=1, clave de 64 bytes) y una salt
 * aleatoria de 16 bytes.
 *
 * Devuelve un string de la forma
 * `scrypt$<N>$<r>$<p>$<salt-base64>$<hash-base64>`: la salt es nueva en cada
 * llamada, por lo que dos hashes del mismo password nunca coinciden.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH_BYTES);
  const derivedKey = await deriveKey(plain, salt, KEY_LENGTH_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    ALGORITHM,
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

/**
 * Verifica `plain` contra un hash almacenado producido por `hashPassword`.
 *
 * Hashea con los parámetros guardados en el propio string y compara con
 * `timingSafeEqual`. Ante un formato corrupto, truncado o con parámetros
 * inválidos devuelve `false`; nunca lanza.
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== HASH_PARTS) {
    return false;
  }

  const [algorithm, nRaw, rRaw, pRaw, saltBase64, hashBase64] = parts;
  if (algorithm !== ALGORITHM) {
    return false;
  }

  const n = parseParam(nRaw);
  const r = parseParam(rRaw);
  const p = parseParam(pRaw);
  if (n === null || r === null || p === null) {
    return false;
  }
  if (n < MIN_N || n > MAX_N || r > MAX_R || p > MAX_P) {
    return false;
  }
  // scrypt exige N potencia de 2; se valida antes de llamar a Node.
  if ((n & (n - 1)) !== 0) {
    return false;
  }

  const salt = Buffer.from(saltBase64, "base64");
  const expected = Buffer.from(hashBase64, "base64");
  if (salt.length === 0 || expected.length !== KEY_LENGTH_BYTES) {
    return false;
  }

  try {
    const derivedKey = await deriveKey(plain, salt, KEY_LENGTH_BYTES, {
      N: n,
      r,
      p,
    });
    return (
      derivedKey.length === expected.length &&
      timingSafeEqual(derivedKey, expected)
    );
  } catch {
    // Parámetros válidos en formato pero no en runtime (p. ej. exceden maxmem).
    return false;
  }
}

/** Parsea un parámetro scrypt: dígitos decimales y entero positivo. */
function parseParam(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Política de contraseñas compartida entre registro y recuperación.
 *
 * Mínimo 8 caracteres; máximo 128 para acotar el costo de scrypt (la entrada
 * se procesa completa antes de derivar).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Valida la fortaleza de `plain` y devuelve la lista de violaciones (vacía si
 * la contraseña es válida). No lanza y no normaliza la entrada.
 */
export function validatePasswordStrength(plain: string): string[] {
  const violations: string[] = [];
  if (plain.length < PASSWORD_MIN_LENGTH) {
    violations.push(
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    );
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    violations.push(
      `La contraseña no puede tener más de ${PASSWORD_MAX_LENGTH} caracteres.`,
    );
  }
  return violations;
}
