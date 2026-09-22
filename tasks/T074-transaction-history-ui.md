# T074 — Historial con autor/timestamp y reset resaltado

- **Fase:** 8 · UI producto
- **Estado:** ⬜
- **Depende de:** T072

## Objetivo

Historial inmutable visible con metadata completa.

## Alcance

- Lista bajo el form:
  - cada fila: tipo (icono/signo), monto formateado según moneda, contraparte, nota, **autor**, fecha/hora local,
  - transacciones `reset` resaltadas visualmente,
  - paginación "cargar más" usando el endpoint incremental (T062).

## Criterios de aceptación

- [ ] Metadata completa visible (autor + fecha).
- [ ] Reset distinguible.
- [ ] Cargar más trae el delta correcto.

## Verificación

- Manual con seed de datos.