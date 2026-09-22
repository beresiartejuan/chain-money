# T052 — `revokeToken` + `expireToken` (solo owner)

- **Fase:** 5 · Compartir
- **Estado:** ⬜
- **Depende de:** T049

## Objetivo

Las dos únicas mutaciones de token: borrado y expiración.

## Alcance

- `revokeToken(tokenId)`: **solo owner**, DELETE físico de la fila,
- `expireToken(tokenId)`: **solo owner**, status → `expired`.
- Ambos: NotFound si el token no es de una alcancía propia; sobre token ya redeemed → revoke OK (borra), expire → error claro (ya consumido).
- **Decisión a documentar (T092):** el acceso ya canjeado persiste; estas acciones solo previenen canjes futuros.

## Criterios de aceptación

- [ ] Owner puede borrar y expirar.
- [ ] Guest/extraño no puede (Permission/NotFound según corresponda).
- [ ] Token redeemed no se puede expirar (pero sí borrar).

## Tests

- `token-mutations.test.ts`: owner ok, guest no, redeemed rules.