/**
 * Cursores incrementales de sincronización.
 *
 * Un cursor es la tupla `(createdAtMs, id)` del último ítem visto en una
 * consulta ordenada: `createdAtMs` marca la posición y `id` desempata los
 * ítems con el mismo timestamp. Se codifica como string opaco (base64url de
 * JSON) para poder pasarlo en URLs, headers o almacenarlo sin acoplarse a la
 * representación interna.
 */
export interface Cursor {
  createdAtMs: number;
  id: string;
}

interface CursorPayload {
  t: number;
  i: string;
}

/**
 * Codifica `text` en base64url sin padding, portable entre Node y navegador:
 * usa `Buffer` si está disponible y si no, `btoa` sobre bytes UTF-8.
 */
function encodeBase64Url(text: string): string {
  if (typeof Buffer === "function") {
    return Buffer.from(text, "utf8").toString("base64url");
  }

  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * Decodifica base64url a texto UTF-8, o `null` si la entrada no se puede
 * decodificar. Es tolerante con padding faltante; la validación estricta del
 * contenido queda a cargo del formato del cursor.
 */
function decodeBase64Url(raw: string): string | null {
  try {
    if (typeof Buffer === "function") {
      return Buffer.from(raw, "base64url").toString("utf8");
    }

    const base64 = raw.replaceAll("-", "+").replaceAll("_", "/");
    const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new TextDecoder().decode(bytes);
  } catch {
    // Caracteres inválidos para base64: el cursor está corrupto.
    return null;
  }
}

/**
 * Codifica un cursor como string opaco: base64url (sin padding) del JSON
 * `{"t":<createdAtMs>,"i":"<id>"}`.
 */
export function makeCursor(createdAtMs: number, id: string): string {
  return encodeBase64Url(JSON.stringify({ t: createdAtMs, i: id }));
}

/**
 * Decodifica un cursor producido por `makeCursor`.
 *
 * Nunca lanza: devuelve `null` ante cualquier entrada inválida (garbage, JSON
 * inválido, tipos incorrectos o campos faltantes). Tolera campos extra para
 * no romper con versiones futuras del formato.
 */
export function parseCursor(raw: string): Cursor | null {
  const json = decodeBase64Url(raw);
  if (json === null) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    // El string decodificado no es JSON válido: cursor corrupto.
    return null;
  }

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const payload = value as Partial<CursorPayload>;
  if (
    typeof payload.t !== "number" ||
    !Number.isFinite(payload.t) ||
    typeof payload.i !== "string"
  ) {
    return null;
  }

  return { createdAtMs: payload.t, id: payload.i };
}

/**
 * Compara dos cursores: primero por `createdAtMs` y, con empate, por `id` en
 * orden lexicográfico. Compatible con `Array.prototype.sort` para obtener un
 * orden total y estable.
 */
export function compareTuples(a: Cursor, b: Cursor): number {
  if (a.createdAtMs !== b.createdAtMs) {
    return a.createdAtMs < b.createdAtMs ? -1 : 1;
  }

  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }

  return 0;
}
