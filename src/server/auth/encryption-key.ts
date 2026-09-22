import "server-only";

const KEY_LENGTH_BYTES = 32;

/**
 * Decodifica la variable de entorno `ENCRYPTION_KEY` (base64) al Buffer de
 * 32 bytes que espera `encrypt`/`decrypt` de `@/lib/crypto/aead`.
 *
 * Aquí vive la decisión de dónde sale la key: siempre de `env.encryptionKey`
 * (que a su vez lee `process.env.ENCRYPTION_KEY` vía `@/lib/env`). El service
 * de auth la recibe por parámetro para seguir siendo puro y testeable.
 *
 * Devuelve `null` si la variable no está configurada (en desarrollo puede
 * faltar; `parseEnv` exige su presencia en producción). Lanza si está
 * configurada pero no decodifica a exactamente 32 bytes: una key con formato
 * incorrecto es un error de deploy, no algo de lo que recuperarse.
 */
export function decodeEncryptionKey(
  base64Key: string | undefined,
): Buffer | null {
  if (base64Key === undefined || base64Key === "") {
    return null;
  }

  const key = Buffer.from(base64Key, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY inválida: se esperaban ${KEY_LENGTH_BYTES} bytes en base64, se decodificaron ${key.length}.`,
    );
  }
  return key;
}
