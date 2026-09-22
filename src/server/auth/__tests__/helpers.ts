import { randomBytes } from "node:crypto";

/**
 * Key de 32 bytes para tests del service de auth (T033): `registerUser` la
 * exige para encriptar la frase de recuperación. Aleatoria por suite, en
 * base64, como la que genera `openssl rand -base64 32` para `ENCRYPTION_KEY`.
 */
export function encodeEncryptionKeyForTests(): Buffer {
  return Buffer.from(randomBytes(32).toString("base64"), "base64");
}
