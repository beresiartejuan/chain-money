# T033 — Persistencia de frase encriptada + hash

- **Fase:** 2 · Auth
- **Estado:** ⬜
- **Depende de:** T012, T032, T025

## Objetivo

Guardar la frase en `users` sin texto plano: AES-GCM + SHA-256, y mostrarla una vez en el registro.

## Alcance

- En `register` (T025): generar frase → `encrypt` (key de `env.ENCRYPTION_KEY`) → `recoveryPhraseEncrypted`; SHA-256 → `recoveryPhraseHash`.
- La action devuelve la frase cruda **una sola vez** para la UI post-registro (no se vuelve a obtener sin auth, ver T034).
- Nunca loguear la frase.

## Criterios de aceptación

- [ ] DB contiene encrypted + hash; grep de la frase cruda en DB da 0 resultados.
- [ ] Registro devuelve la frase una vez.

## Tests

- `recovery-persist.test.ts`: no hay plaintext en DB, encrypted es roundtrip-able con la key.