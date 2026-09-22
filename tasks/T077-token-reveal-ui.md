# T077 — Reveal de token crudo una vez + copiar

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T076

## Objetivo

El token crudo se muestra exactamente una vez, con copia al portapapeles.

## Alcance

- Tras crear token:
  - pantalla/modal con el token, botón copiar (clipboard API), advertencia "no lo vas a ver de nuevo, un solo uso",
  - checkbox/botón "ya lo guardé" para cerrar,
  - el token no se guarda en ningún storage ni estado global.

## Criterios de aceptación

- [ ] Token visible solo en ese paso; al cerrar no hay forma de recuperarlo (solo crear uno nuevo).
- [ ] Copiar funciona.

## Verificación

- Manual.