# T103a — Landing pública en `/`

## Objetivo

Reemplazar el placeholder del scaffold en `src/app/page.tsx` por una landing
pública del producto, con identidad visual derivada de
`docs/images/hero.png` (base casi negra con tinte verde y acento verde-agua).

## Comportamiento

- `/` sin sesión **muestra la landing** (ya no redirige a `/login`).
- `/` con sesión **sigue redirigiendo a `/dashboard`** (comportamiento de
  T040, sin cambios).
- Landing es un **server component** sin JS de cliente: navegación por
  anchors y CTAs a `/register`.

## Contenido y diseño

- **Paleta**: base `#040b09` con glows radiales esmeralda; acento
  `#2ee19b` (verde-agua); texto `zinc-100/400/500`.
- **Tipografía**: Geist Sans para display/cuerpo (ya en el layout raíz) y
  Geist Mono como "voz de libro contable" en eyebrows, fechas y montos.
- **Elemento distintivo**: tira de "libro contable en vivo" — filas de
  movimientos que se anotan con una animación **scroll-driven**
  (`animation-timeline: view()` en `globals.css`, clase `ledger-reveal`),
  degradando a contenido visible sin soporte o con reduced motion.
- **Secciones**: hero con capturas reales del producto, libro contable,
  cómo funciona (4 pasos), inmutabilidad (contraste), tokens de un solo
  uso y CTA final.

## Detalles técnicos

- Capturas en `public/landing/`: `dashboard.png` (copia de la original) y
  `box-detail-cropped.png` (recorte superior de la original a 1284×1700).
- `prefers-reduced-motion` desactiva la animación y el smooth scroll.
- Foco visible (`focus-visible`) en CTAs y nav.

## Verificación

- `pnpm test` (17 tests del proxy actualizados: `/` sin sesión no
  redirige) y `pnpm lint && pnpm build` en verde.
- Revisado en navegador desktop y mobile (390px) + reduced motion.