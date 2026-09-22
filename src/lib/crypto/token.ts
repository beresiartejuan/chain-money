import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_LENGTH_BYTES = 32;
const PREFIX_LENGTH_CHARS = 8;

/**
 * Genera un token de acceso crudo (efímero, solo para mostrar/compartir una vez)
 * junto con su hash SHA-256 (para persistir) y un prefix de 8 caracteres
 * (para identificar el token en la UI sin exponer el valor completo).
 */
export function generateAccessToken(): {
  token: string;
  hash: string;
  prefix: string;
} {
  const token = randomBytes(TOKEN_LENGTH_BYTES).toString("base64url");
  const hash = hashAccessToken(token);
  const prefix = token.slice(0, PREFIX_LENGTH_CHARS);
  return { token, hash, prefix };
}

/**
 * Calcula el hash SHA-256 en hex de un token crudo, de forma determinista.
 */
export function hashAccessToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Comparación en tiempo constante de dos strings, para evitar timing attacks.
 * Si las longitudes difieren devuelve `false` sin lanzar.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
