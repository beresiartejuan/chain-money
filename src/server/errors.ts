/**
 * Errores de aplicación usados por toda la app.
 *
 * El contrato para la UI es el `code` estable (la UI compara códigos, nunca
 * mensajes, que pueden cambiar o traducirse). `AppError` es la base: los
 * catch de dominio filtran con `instanceof AppError` y dejan propagar lo
 * inesperado (que Next redacta antes de llegar al cliente).
 */

/** Códigos estables de error de dominio. La UI compara contra estos valores. */
export type ErrorCode =
  | "unauthorized"
  | "invalid_credentials"
  | "email_taken"
  | "validation"
  | "rate_limited"
  | "no_recovery_phrase"
  | "recovery_phrase_unreadable"
  | "limit_reached"
  | "not_found"
  | "forbidden"
  | "token_invalid"
  | "token_already_redeemed"
  | "token_expired"
  | "own_box_redeem"
  | "insufficient_funds";

/** Base de los errores de dominio: todos llevan un `code` estable. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** No hay sesión activa (o expiró). */
export class UnauthorizedError extends AppError {
  constructor(message = "Se requiere una sesión activa.") {
    super("unauthorized", message);
  }
}

/**
 * Credenciales incorrectas. Email inexistente y password erróneo comparten
 * este error a propósito: no se revela cuál de los dos falló.
 */
export class InvalidCredentialsError extends AppError {
  constructor(message = "Email o contraseña incorrectos.") {
    super("invalid_credentials", message);
  }
}

/** El email ya tiene una cuenta. */
export class EmailTakenError extends AppError {
  constructor(message = "El email ya está registrado.") {
    super("email_taken", message);
  }
}

/** Validación de entrada rechazada, con un error por campo para la UI. */
export class ValidationError extends AppError {
  /** Mensajes por campo (clave = nombre del campo del formulario). */
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    fieldErrors: Record<string, string[]>,
    message = "Revisa los campos marcados.",
  ) {
    super("validation", message);
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Se agotó el cupo de intentos en la ventana vigente. A diferencia de
 * `invalid_credentials`, la UI puede mostrar "esperá N segundos" con
 * `retryAfterMs`.
 */
export class RateLimitError extends AppError {
  /** Milisegundos que faltan para que la ventana reinicie y haya cupo. */
  readonly retryAfterMs: number;

  constructor(
    retryAfterMs: number,
    message = "Demasiados intentos. Probá de nuevo más tarde.",
  ) {
    super("rate_limited", message);
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * La cuenta no tiene frase de recuperación guardada (registros previos a
 * T033). Solo aplica a endpoints autenticados: nunca se expone en el flujo
 * público de recovery, que responde `invalid_credentials` genérico.
 */
export class NoRecoveryPhraseError extends AppError {
  constructor(
    message = "Esta cuenta no tiene una frase de recuperación guardada.",
  ) {
    super("no_recovery_phrase", message);
  }
}

/**
 * No se pudo desencriptar la frase guardada (payload alterado o key
 * incorrecta). Envuelve un `AeadError` para que el detalle interno nunca
 * escape al cliente: la UI solo ve el code estable `recovery_phrase_unreadable`.
 */
export class RecoveryPhraseUnreadableError extends AppError {
  constructor(message = "No se pudo leer la frase de recuperación guardada.") {
    super("recovery_phrase_unreadable", message);
  }
}

/**
 * El usuario alcanzó el cupo máximo de alcancías (`MAX_BOXES_PER_USER`).
 * Se lanza dentro de la transacción de creación, así que el rollback deja la
 * DB exactamente como estaba: la 6ta alcancía es imposible, incluso con
 * requests simultáneos (SQLite serializa escrituras).
 */
export class LimitReachedError extends AppError {
  constructor(message = "Alcanzaste el límite de alcancías por usuario.") {
    super("limit_reached", message);
  }
}

/** El recurso pedido no existe (o se decide no revelar su existencia). */
export class NotFoundError extends AppError {
  constructor(message = "El recurso no existe.") {
    super("not_found", message);
  }
}

/**
 * La sesión es válida pero no tiene permiso sobre el recurso (guest sin el
 * permiso requerido, o extraño sobre una alcancía ajena).
 */
export class PermissionError extends AppError {
  constructor(message = "No tenés permiso para esta acción.") {
    super("forbidden", message);
  }
}

/**
 * El token de acceso es inválido: malformado o inexistente. A propósito es
 * UN solo error para ambos casos (no se filtra si un token existe), igual
 * que login no distingue email de password.
 */
export class TokenInvalidError extends AppError {
  constructor(message = "El token de acceso es inválido.") {
    super("token_invalid", message);
  }
}

/** El token existe pero ya fue canjeado (single-use vencido por canje). */
export class TokenAlreadyRedeemedError extends AppError {
  constructor(message = "El token ya fue canjeado.") {
    super("token_already_redeemed", message);
  }
}

/** El token existe pero expiró (vencido por tiempo, aún sin canjear). */
export class TokenExpiredError extends AppError {
  constructor(message = "El token expiró.") {
    super("token_expired", message);
  }
}

/**
 * El owner no puede canjear un token de su propia alcancía: el canje es el
 * flujo para OTORGAR acceso a terceros, y un owner ya tiene acceso total.
 */
export class OwnBoxRedeemError extends AppError {
  constructor(message = "No podés canjear un token de tu propia alcancía.") {
    super("own_box_redeem", message);
  }
}

/**
 * Un withdraw excede el balance actual de la alcancía (regla de T058,
 * `ALLOW_NEGATIVE_BALANCE = false`). Se lanza DENTRO de la transacción de DB,
 * así que el rollback deja el historial exactamente como estaba: el withdraw
 * rechazado nunca llega a insertarse, incluso con requests simultáneos
 * (SQLite serializa escrituras).
 */
export class InsufficientFundsError extends AppError {
  constructor(
    message = "El balance de la alcancía no alcanza para este retiro.",
  ) {
    super("insufficient_funds", message);
  }
}
