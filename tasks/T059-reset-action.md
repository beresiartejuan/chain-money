# T059 — Server action `resetBox`

- **Fase:** 6 · Transacciones
- **Estado:** ⬜
- **Depende de:** T055

## Objetivo

Resetear balance a 0 con UNA transacción tipo `reset`, dentro de transacción de DB.

## Alcance

- `resetBox(boxId)`:
  - gate `assertPermission(reset:box)`,
  - en transacción: calcular balance actual (misma fórmula que T058), si ≠ 0 insertar transacción `reset` con `amountMinor = -balance`, nota autogenerada "Reset de alcancía", `createdBy` = actor,
  - lock implícito de SQLite para evitar carrera con transacciones simultáneas.

## Criterios de aceptación

- [ ] Balance queda 0 tras reset (sumando todo el historial).
- [ ] El actor del reset queda registrado.
- [ ] Sin permiso `reset:box` → PermissionError.

## Tests

- `reset.test.ts`: balance a 0, atribución, permisos.