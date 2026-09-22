import { v7 } from "uuid";

/**
 * Genera un UUIDv7 (ordenable por tiempo) para usar como ID primario.
 */
export function newId(): string {
  return v7();
}

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Valida que `value` sea un UUID con formato correcto y versión 7.
 */
export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}
