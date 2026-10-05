# T103b — Aplicar el tema de la landing a toda la app

## Objetivo

Extender la identidad visual de la landing (T103a) al resto de la app:
auth, dashboard, detalle de alcancía y canje. Dark-first, una sola paleta,
sin variantes `dark:`.

## Cambios

- **Tokens de marca** en `src/app/globals.css` (`@theme` de Tailwind v4):
  `canvas` (#040b09), `surface` (#0c1512), `elevated` (#14211c), `fg`,
  `muted`, `faint`, `line`, `rowline`, `accent` (#2ee19b), `accent-dim`.
  Clases semánticas (`bg-surface`, `text-fg`, `border-line`, …).
- **`body`** usa la fuente Geist (antes Arial heredado del scaffold).
- Barrido de clases en todos los componentes: cards, modales, inputs,
  botones, badges, banners, filas del historial, toggles y checkboxes.
- **`src/app/page.tsx` (landing)** refactorizada para consumir los mismos
  tokens (única fuente de verdad del color).
- Semántica de color: acento = depósitos/CTAs; `red-400` = extracciones y
  destructivo; `amber-400` = reset/token warning; balance en Geist Mono.
- `(auth)/layout.tsx` y `/redeem` sobre `bg-canvas`; header de la app
  (isotipo + wordmark) reusable en auth.
- `next.config.ts`: `allowedDevOrigins: ["127.0.0.1"]` para el preview del
  agente (HMR sin bloqueo cross-origin; no afecta producción).

## Verificación

- Suite 536 tests en verde; lint y build limpios.
- Preview E2E contra copia de `local.db`: registro, login, creación de
  alcancía (`createBoxAction`), token (`createTokenAction` + reveal), reset
  modal, `/redeem` y landing anónima — todos en el tema.

## Docs

- `docs/ARCHITECTURE.md`: nueva sección "Tema de marca (T103b)" con la
  tabla de tokens y las reglas de uso.