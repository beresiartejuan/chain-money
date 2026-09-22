# T036 — Rate limit de recovery

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T035, T030

## Objetivo

Frenar fuerza bruta de frases (espacio de búsqueda grande pero conviene limitar).

## Alcance

- `checkRateLimit` sobre `recoverAccount`: key `recover:{email}`, p. ej. 5 intentos/10 min.
- Error de rate limit distinto del genérico de credenciales (para que la UI pueda mostrar "esperá").

## Criterios de aceptación

- [ ] 6to intento en ventana bloqueado con error específico.
- [ ] El límite no bloquea a usuarios legítimos que se equivocan 1–2 veces.

## Tests

- `recovery-rate-limit.test.ts`: ventana, bloqueo, liberación.