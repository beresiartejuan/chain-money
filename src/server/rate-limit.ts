import "server-only";

/**
 * Rate limit en memoria para el MVP (T030): primitiva genérica de ventana
 * fija por key, pensada para frenar fuerza bruta sobre login.
 *
 * ## Algoritmo elegido: ventana fija (fixed window)
 *
 * Por key se guarda `{ count, windowStart, windowMs }`. La primera llamada
 * fuera de la ventana previa abre una ventana nueva con contador en 1.
 * Es la opción más simple y suficiente para frenar fuerza bruta: no requiere
 * guardar timestamps individuales (sliding window) ni más de un contador.
 * Consecuencia aceptada: un cliente puede "duplicar" intentos pegándose al
 * borde de dos ventanas consecutivas (hasta ~2× limit en un tramo corto);
 * para login en el MVP ese trade-off es razonable frente a la complejidad
 * extra del sliding window.
 *
 * ## Almacenamiento y limpieza (sin leak)
 *
 * El estado vive en un `Map` a nivel de módulo (por proceso/instancia de
 * servidor — en serverless cada instancia tiene el suyo; limitación conocida
 * y aceptada del MVP). Para que keys que nunca vuelven no acumulen memoria:
 *
 * - La entrada de la key checkeada se purga implícitamente: si su ventana
 *   venció, el check abre una ventana nueva en su lugar.
 * - Además, cada `SWEEP_EVERY_CHECKS` checks corre un sweep global que borra
 *   todas las entradas vencidas, así el `Map` queda acotado a las keys
 *   activas más las del tramo entre sweeps.
 *
 * ## Uso previsto (la integración en login la hace otra tarea; T083 consolida)
 *
 * ```ts
 * // 5 intentos por minuto por email:
 * const result = checkRateLimit(`login:${email}`, 5, 60_000);
 * if (!result.allowed) {
 *   // error de rate limit, informando `retryAfterMs`
 * }
 * ```
 *
 * Suposición: una misma key debe consultarse siempre con el mismo
 * `windowMs` (el sweep usa el `windowMs` guardado en la entrada).
 */

/** Resultado de un check de rate limit. */
export interface RateLimitResult {
  /** `true` si la llamada tiene cupo dentro de la ventana actual. */
  allowed: boolean;
  /**
   * `0` si la llamada está permitida; si está bloqueada, los milisegundos
   * que faltan para que la ventana reinicie y vuelva a haber cupo.
   */
  retryAfterMs: number;
}

/** Estado por key: intentos en la ventana actual y cuándo arrancó. */
interface RateLimitEntry {
  count: number;
  windowStart: number;
  windowMs: number;
}

/** Estado del limiter: una entrada por key con ventana activa. */
const store = new Map<string, RateLimitEntry>();

/**
 * Frecuencia del sweep global: una entrada vencida de una key que no vuelve
 * a checkearse vive a lo sumo ~`SWEEP_EVERY_CHECKS` checks más.
 */
const SWEEP_EVERY_CHECKS = 1000;

/** Contador que programa el sweep ocasional. */
let checksUntilSweep = SWEEP_EVERY_CHECKS;

/** Borra del store todas las entradas cuya ventana venció a `now`. */
function sweepExpired(now: number): void {
  for (const [key, entry] of store) {
    if (now - entry.windowStart >= entry.windowMs) {
      store.delete(key);
    }
  }
}

/**
 * Aplica el límite de `limit` llamadas por ventana de `windowMs` ms para
 * `key`.
 *
 * Las llamadas bloqueadas no incrementan el contador ni estiran la ventana:
 * la key vuelve a tener cupo recién cuando la ventana actual termina. Usa
 * `Date.now()`, así en tests la ventana se controla con fake timers
 * (`vi.useFakeTimers` + `vi.advanceTimersByTime`).
 *
 * @returns `allowed: true` con `retryAfterMs: 0` si queda cupo; si no,
 *   `allowed: false` con los ms restantes hasta el reinicio de la ventana.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  // Sweep ocasional: purga entradas vencidas de keys que ya no vuelven.
  checksUntilSweep -= 1;
  if (checksUntilSweep <= 0) {
    checksUntilSweep = SWEEP_EVERY_CHECKS;
    sweepExpired(now);
  }

  const entry = store.get(key);

  // Sin entrada, o ventana vencida: abre una ventana nueva con esta llamada.
  if (entry === undefined || now - entry.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now, windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  // Dentro de la ventana y con cupo: suma el intento.
  if (entry.count < limit) {
    entry.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  // Límite agotado: bloquear hasta que termine la ventana.
  return { allowed: false, retryAfterMs: entry.windowStart + windowMs - now };
}

/**
 * Borra el contador de `key`: el próximo check abre una ventana limpia.
 * Pensado para tests y para desbloqueos manuales explícitos; no afecta a
 * las demás keys.
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
