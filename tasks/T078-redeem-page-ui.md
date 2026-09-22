# T078 — Página `/redeem` (canje)

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T050

## Objetivo

Canjear token desde la UI.

## Alcance

- `src/app/redeem/page.tsx` (ruta privada):
  - input del token, al pegarlo muestra feedback de formato,
  - confirmación: "vas a obtener acceso a [nombre de alcancía] con permisos X",
  - al éxito: redirige a la alcancía,
  - errores: token usado/expirado/inválido con mensajes diferenciados si la API los provee (sin filtrar más de lo que la API devuelve).

## Criterios de aceptación

- [ ] Canje feliz accede a la alcancía.
- [ ] Errores claros para cada caso.

## Verificación

- Manual.