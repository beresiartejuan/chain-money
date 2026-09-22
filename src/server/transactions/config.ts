/**
 * Config de dominio de transacciones (T058): banderas de reglas de negocio
 * que pueden cambiar por decisión de producto, separadas de la lógica para
 * que el flip sea un cambio de una línea documentado.
 */

/**
 * ¿Se permiten balances negativos en una alcancía?
 *
 * `false` (default del producto, T058): un `withdraw` mayor al balance
 * actual se rechaza con `InsufficientFundsError` (code `insufficient_funds`).
 * La regla se enforcea dentro de la transacción de DB de `createTransaction`
 * (SELECT del balance + insert, `BEGIN IMMEDIATE`): SQLite serializa
 * escrituras, así que no hay carrera en la que dos withdrawals pasen juntos.
 *
 * Si el producto decidiera permitir descubierto, se pone `true` y el branch
 * de `createTransaction` queda inerte (el test lo cubre con la constante,
 * no con la lógica).
 */
export const ALLOW_NEGATIVE_BALANCE = false;
