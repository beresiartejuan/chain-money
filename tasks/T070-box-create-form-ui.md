# T070 — Formulario de creación de alcancía

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T069, T041

## Objetivo

Crear alcancías desde la UI con validación.

## Alcance

- Modal/form en `/dashboard`:
  - name + select de moneda (solo `CURRENCY_EXPONENTS` keys, con nombres),
  - errores server reflejados (límite, moneda),
  - al crear, refresca la lista.

## Criterios de aceptación

- [ ] Crea y aparece en la lista.
- [ ] 6ta → error de límite visible.
- [ ] Solo monedas soportadas en el select.

## Verificación

- Manual o test de la lógica de options.