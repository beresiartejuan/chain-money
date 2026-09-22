# T050 — Server action `redeemToken`

- **Fase:** 5 · Compartir
- **Estado:** ⬜
- **Depende de:** T049

## Objetivo

Canjear un token crudo por acceso a la alcancía.

## Alcance

- `redeemToken(rawToken)`:
  - requiere sesión (T028), valida formato,
  - busca por **hash**; status `active` requerido,
  - marca `redeemed` + `redeemedAt` + `redeemedBy` (transacción),
  - crea `box_access` (unique por boxId+userId; si ya existe, uniona permisos y actualiza),
  - owner no puede canjear tokens de su propia alcancía (error claro),
  - rate limit (reusar T030, key `redeem:{userId}`).

## Criterios de aceptación

- [ ] Canje activo otorga acceso con los permisos del token.
- [ ] `redeemed`/`expired` rechazados.
- [ ] Owner de la alcancía no puede canjear.

## Tests

- `redeem-token.test.ts`: activo ok, usado, expirado, owner, formato inválido.