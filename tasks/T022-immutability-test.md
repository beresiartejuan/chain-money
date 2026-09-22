# T022 — Test: UPDATE/DELETE sobre transactions falla

- **Fase:** 1 · Dominio
- **Estado:** ⬜
- **Depende de:** T019, T021

## Objetivo

Fijar la inmutabilidad como contrato testeado a nivel DB.

## Alcance

- En `src/db/__tests__/immutability.test.ts`:
  - insertar transacción de prueba,
  - `UPDATE` vía cliente libsql crudo → expect rejects con mensaje del trigger,
  - `DELETE` crudo → expect rejects,
  - `INSERT` sigue funcionando (control positivo).

## Criterios de aceptación

- [ ] Los 3 asserts pasan.
- [ ] El test corre en `pnpm test` (no manual).

## Verificación

```bash
pnpm test -- src/db/__tests__/immutability.test.ts
```