import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const VERSION = "v1";
const PAYLOAD_PARTS = 4;

/**
 * Error lanzado cuando un payload AEAD tiene formato inválido, versión
 * desconocida, o la autenticación (tag) falla al descifrar.
 */
export class AeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AeadError";
  }
}

/**
 * Valida que `key` sea un Buffer de exactamente 32 bytes (AES-256).
 */
function assertValidKey(key: Buffer): void {
  if (!Buffer.isBuffer(key)) {
    throw new AeadError("La key debe ser un Buffer");
  }
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new AeadError(
      `La key debe tener exactamente ${KEY_LENGTH_BYTES} bytes (AES-256), recibió ${key.length}`,
    );
  }
}

/**
 * Encripta `plaintext` con AES-256-GCM usando un IV aleatorio de 12 bytes.
 *
 * Devuelve un payload de la forma `v1$<iv-base64>$<tag-base64>$<ciphertext-base64>`.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  assertValidKey(key);

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join("$");
}

/**
 * Descifra un payload producido por `encrypt`.
 *
 * Lanza `AeadError` si el formato es inválido, la versión es desconocida,
 * o la autenticación falla (cualquier alteración del payload o de la key).
 */
export function decrypt(payload: string, key: Buffer): string {
  assertValidKey(key);

  const parts = payload.split("$");
  if (parts.length !== PAYLOAD_PARTS) {
    throw new AeadError(
      `Formato de payload inválido: se esperaban ${PAYLOAD_PARTS} partes separadas por '$'`,
    );
  }

  const [version, ivBase64, tagBase64, ciphertextBase64] = parts;
  if (version !== VERSION) {
    throw new AeadError(`Versión de payload desconocida: "${version}"`);
  }

  const iv = Buffer.from(ivBase64, "base64");
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new AeadError(
      `IV inválido: se esperaban ${IV_LENGTH_BYTES} bytes, recibió ${iv.length}`,
    );
  }

  const tag = Buffer.from(tagBase64, "base64");
  const ciphertext = Buffer.from(ciphertextBase64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AeadError(
      "La autenticación falló: el payload fue alterado o la key es incorrecta",
    );
  }
}
