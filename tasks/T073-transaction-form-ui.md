# T073 — Formulario de transacción (150 chars, decimales)

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T072, T055, T056

## Objetivo

Cargar depósitos/extracciones desde la UI con validación en vivo.

## Alcance

- Form en la vista detalle:
  - tipo toggle deposit/withdraw, monto (decimal según moneda), contraparte, nota con contador 150,
  - validación client con `transactionSchema` (T056) + errores server (`insufficient_funds`),
  - deshabilitado sin `create:transactions` (se oculta en T079),
  - al éxito: refresca balance + historial.

## Criterios de aceptación

- [ ] Deposita y extrae; balance se actualiza.
- [ ] Nota > 150 bloqueada con contador.
- [ ] Decimales inválidos para la moneda bloqueados client-side.

## Verificación

- Manual o RTL.