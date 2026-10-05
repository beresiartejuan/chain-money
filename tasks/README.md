# Tasks — Construcción de Chain Money

Plan de trabajo para llevar el proyecto desde el **estado actual** (Next.js 16 + Drizzle/Turso configurados, sin lógica de app) hasta el **estado final** definido en [`docs/PRODUCT.md`](../docs/PRODUCT.md).

Las tareas son **casi atómicas**: pequeñas, acotadas y verificables de forma aislada con un comando o una inspección directa. Ninguna debería tomar más de un puñado de commits.

## Estado actual (baseline)

- Next.js 16.3.5 + React 19 + Tailwind v4 + Biome + pnpm funcionando (`pnpm lint`, `pnpm build` en verde).
- Drizzle ORM + Turso configurados con migración inicial (`users_table` placeholder, se reemplaza).
- Sin auth, sin dominio, sin UI de producto.

## Estado final (definición de listo)

- [ ] Registro/login con email + password + name y recovery phrase encriptada.
- [ ] Hasta 5 alcancías por usuario con UUIDv7 y moneda fija.
- [ ] Transacciones inmutables (deposit/withdraw/reset) con autor y timestamp.
- [ ] Tokens de acceso de un solo uso con permisos configurables (crear/borrar/expirar).
- [ ] API incremental de transacciones (por fecha o por ID) + caché incremental en el cliente.
- [ ] Suite de tests unitarios y de integración en verde con cobertura ≥ 80% en `src/lib` y `src/server`.
- [ ] `pnpm lint && pnpm build && pnpm test` pasando sin errores.

## Leyenda de estado

⬜ pendiente · 🔶 en progreso · ✅ done · ❌ cancelada

## Fases y tareas

| ID | Tarea | Fase | Estado | Depende de |
|---|---|---|---|---|
| [T001](./T001-env-module.md) | Módulo de env validado con zod | 0 · Fundaciones | ✅ | — |
| [T002](./T002-env-example.md) | Documentar variables en `.env.example` y docs | 0 · Fundaciones | ✅ | T001 |
| [T003](./T003-testing-infra.md) | Vitest + scripts de test | 0 · Fundaciones | ✅ | — |
| [T004](./T004-test-alias-config.md) | Alias `@` en Vitest + exclusiones de cobertura | 0 · Fundaciones | ✅ | T003 |
| [T005](./T005-coverage-thresholds.md) | Umbrales de cobertura en Vitest | 0 · Fundaciones | ✅ | T003 |
| [T006](./T006-uuidv7-lib.md) | Helper UUIDv7 (`src/lib/ids.ts`) | 0 · Fundaciones | ✅ | T003 |
| [T007](./T007-money-lib.md) | Dinero en unidades menores (`src/lib/money.ts`) | 0 · Fundaciones | ✅ | T003 |
| [T008](./T008-currency-list.md) | Lista de monedas y exponentes ISO 4217 | 0 · Fundaciones | ✅ | T003 |
| [T009](./T009-cursor-lib.md) | Cursores incrementales (`src/lib/cursor.ts`) | 0 · Fundaciones | ✅ | T003 |
| [T010](./T010-password-hash.md) | Hash/verify de password (scrypt) | 0 · Fundaciones | ✅ | T003 |
| [T011](./T011-password-policy.md) | Política de contraseña | 0 · Fundaciones | ✅ | T010 |
| [T012](./T012-aead-lib.md) | AES-256-GCM encrypt/decrypt (`src/lib/crypto/aead.ts`) | 0 · Fundaciones | ✅ | T001 |
| [T013](./T013-token-lib.md) | Generación/hash de tokens de acceso | 0 · Fundaciones | ✅ | T003 |
| [T014](./T014-session-cookies.md) | Helpers de cookie de sesión | 0 · Fundaciones | ✅ | T003 |
| [T015](./T015-schema-users-sessions.md) | Schema: tablas `users` + `sessions` | 1 · Dominio | ✅ | T001, T010 |
| [T016](./T016-schema-boxes.md) | Schema: tabla `savings_boxes` | 1 · Dominio | ✅ | T015, T006, T008 |
| [T017](./T017-schema-tokens.md) | Schema: tablas `box_tokens` + `box_access` | 1 · Dominio | ✅ | T016, T013 |
| [T018](./T018-schema-transactions.md) | Schema: tabla `transactions` | 1 · Dominio | ✅ | T016, T007 |
| [T019](./T019-immutability-triggers.md) | Triggers SQL de inmutabilidad en migración | 1 · Dominio | ✅ | T018 |
| [T020](./T020-db-types-export.md) | Tipos inferidos de Drizzle exportados | 1 · Dominio | ✅ | T019 |
| [T021](./T021-schema-test.md) | Test de schema (tablas + uniques) | 1 · Dominio | ✅ | T020 |
| [T022](./T022-immutability-test.md) | Test: UPDATE/DELETE sobre transactions falla | 1 · Dominio | ✅ | T019, T021 |
| [T023](./T023-drop-placeholder-table.md) | Migración: eliminar tabla placeholder `users_table` | 1 · Dominio | ✅ | T015 |
| [T024](./T024-zod-schemas-auth.md) | Schemas zod de auth (register/login/recover) | 1 · Dominio | ✅ | T011 |
| [T025](./T025-register-action.md) | Server action `register` | 2 · Auth | ✅ | T015, T024 |
| [T026](./T026-login-action.md) | Server action `login` | 2 · Auth | ✅ | T025 |
| [T027](./T027-logout-action.md) | Server action `logout` | 2 · Auth | ✅ | T026 |
| [T028](./T028-session-resolver.md) | Resolver de sesión actual | 2 · Auth | ✅ | T026 |
| [T029](./T029-auth-generic-errors.md) | Errores genéricos en login (no filtrar email) | 2 · Auth | ✅ | T026 |
| [T030](./T030-login-rate-limit.md) | Rate limit de login | 2 · Auth | ✅ | T026 |
| [T031](./T031-recovery-words.md) | Wordlist de recovery phrase (12 palabras) | 2 · Auth | ✅ | T003 |
| [T032](./T032-recovery-generate.md) | Generación de recovery phrase | 2 · Auth | ✅ | T031 |
| [T033](./T033-recovery-persist.md) | Persistencia de frase encriptada + hash | 2 · Auth | ✅ | T012, T032 |
| [T034](./T034-recovery-reveal.md) | `revealRecoveryPhrase` con rate limit | 2 · Auth | ✅ | T033, T028 |
| [T035](./T035-recovery-flow.md) | Flujo `recoverAccount` (reset password + matar sesiones) | 2 · Auth | ✅ | T033 |
| [T036](./T036-recovery-rate-limit.md) | Rate limit de recovery | 2 · Auth | ✅ | T035 |
| [T037](./T037-auth-ui-register.md) | UI `/register` (muestra frase una vez) | 2 · Auth | ✅ | T025, T033 |
| [T038](./T038-auth-ui-login.md) | UI `/login` + errores genéricos | 2 · Auth | ✅ | T026 |
| [T039](./T039-auth-ui-recover.md) | UI `/recover` | 2 · Auth | ✅ | T035 |
| [T040](./T040-middleware.md) | Middleware de rutas privadas | 2 · Auth | ✅ | T028 |
| [T041](./T041-create-box-action.md) | Server action `createBox` (≤5, moneda fija) | 3 · Alcancías | ✅ | T016, T028 |
| [T042](./T042-box-limit-guard.md) | Guard atómico del límite de 5 alcancías | 3 · Alcancías | ✅ | T041 |
| [T043](./T043-list-boxes.md) | `listBoxes` (propias + compartidas) | 3 · Alcancías | ✅ | T017, T041 |
| [T044](./T044-get-box.md) | `getBox` con 404 oculto | 3 · Alcancías | ✅ | T043 |
| [T045](./T045-rename-box.md) | `renameBox` (solo owner) | 3 · Alcancías | ✅ | T044 |
| [T046](./T046-effective-access.md) | Resolución de acceso efectivo (owner/guest) | 4 · Permisos | ✅ | T017 |
| [T047](./T047-assert-permission.md) | `assertPermission` + errores tipados | 4 · Permisos | ✅ | T046 |
| [T048](./T048-refactor-actions-permissions.md) | Refactor: acciones usan `assertPermission` | 4 · Permisos | ✅ | T047, T041–T045 |
| [T049](./T049-create-token-action.md) | Server action `createToken` (permisos configurables) | 5 · Compartir | ✅ | T017, T047 |
| [T050](./T050-redeem-token-action.md) | Server action `redeemToken` (canje atómico) | 5 · Compartir | ✅ | T049 |
| [T051](./T051-redeem-idempotent-guard.md) | Guard: canje doble/concurrente solo gana uno | 5 · Compartir | ✅ | T050 |
| [T052](./T052-revoke-expire-token.md) | `revokeToken` + `expireToken` (solo owner) | 5 · Compartir | ✅ | T049 |
| [T053](./T053-list-tokens.md) | `listTokens` (solo owner, solo prefixes) | 5 · Compartir | ✅ | T049 |
| [T054](./T054-token-redeem-rules.md) | Reglas de canje (hash, status, owner no canjea propio) | 5 · Compartir | ✅ | T050 |
| [T055](./T055-create-transaction-action.md) | Server action `createTransaction` | 6 · Transacciones | ✅ | T018, T047 |
| [T056](./T056-transaction-validation.md) | Validación de montos/nota/contraparte | 6 · Transacciones | ✅ | T055, T007 |
| [T057](./T057-server-attribution.md) | Atribución forzada de autor y `createdAt` de server | 6 · Transacciones | ✅ | T055 |
| [T058](./T058-withdraw-balance-rule.md) | Regla `insufficient_funds` en withdrawals | 6 · Transacciones | ✅ | T055 |
| [T059](./T059-reset-action.md) | Server action `resetBox` (transacción `reset`) | 6 · Transacciones | ✅ | T055 |
| [T060](./T060-reset-idempotent.md) | Reset idempotente con balance 0 | 6 · Transacciones | ✅ | T059 |
| [T061](./T061-reset-negative-balance.md) | Reset con balance negativo | 6 · Transacciones | ✅ | T059 |
| [T062](./T062-incremental-api.md) | Endpoint incremental por fecha o ID | 7 · Sync | ✅ | T055, T009 |
| [T063](./T063-incremental-ordering.md) | Orden estable `(createdAt, id)` + paginación | 7 · Sync | ✅ | T062 |
| [T064](./T064-incremental-authz.md) | Authz en endpoint incremental | 7 · Sync | ✅ | T062, T047 |
| [T065](./T065-balance-cache-module.md) | Módulo puro de caché de balance | 7 · Sync | ✅ | T003 |
| [T066](./T066-balance-cache-reset.md) | Caché: aplicación de `reset` y deltas vacíos | 7 · Sync | ✅ | T065 |
| [T067](./T067-client-sync.md) | `syncBox` con storage inyectable | 7 · Sync | ✅ | T065, T062 |
| [T068](./T068-invalid-cursor-resync.md) | Resync completo ante cursor inválido | 7 · Sync | ✅ | T067 |
| [T069](./T069-dashboard-ui.md) | UI `/dashboard` con lista de alcancías | 8 · UI producto | ✅ | T043 |
| [T070](./T070-box-create-form-ui.md) | Formulario de creación de alcancía | 8 · UI producto | ✅ | T069 |
| [T071](./T071-box-rename-ui.md) | Renombrar alcancía en UI (solo owner) | 8 · UI producto | ✅ | T069, T045 |
| [T072](./T072-box-detail-ui.md) | Vista detalle de alcancía (header + balance) | 8 · UI producto | ✅ | T069, T044 |
| [T073](./T073-transaction-form-ui.md) | Formulario de transacción (150 chars, decimales) | 8 · UI producto | ✅ | T072, T055 |
| [T074](./T074-transaction-history-ui.md) | Historial con autor/timestamp y reset resaltado | 8 · UI producto | ✅ | T072 |
| [T075](./T075-reset-ui.md) | Botón Reset con confirmación (solo con permiso) | 8 · UI producto | ✅ | T072, T059 |
| [T076](./T076-token-management-ui.md) | UI de gestión de tokens (crear/borrar/expirar) | 8 · UI producto | ✅ | T072, T049, T052 |
| [T077](./T077-token-reveal-ui.md) | Reveal de token crudo una vez + copiar | 8 · UI producto | ✅ | T076 |
| [T078](./T078-redeem-page-ui.md) | Página `/redeem` (canje) | 8 · UI producto | ✅ | T050 |
| [T079](./T079-permission-ui.md) | UI refleja permisos (ocultar/deshabilitar) | 8 · UI producto | ⬜ | T072, T046 |
| [T080](./T080-cache-integration-ui.md) | Integrar caché incremental en la vista de alcancía | 9 · Cierre | ⬜ | T067, T072 |
| [T081](./T081-no-mutation-audit.md) | Verificación: sin UPDATE/DELETE de transacciones en src/ | 9 · Cierre | ✅ | T055 |
| [T082](./T082-immutability-audit-test.md) | Test de auditoría anti-edición/borrado | 9 · Cierre | ✅ | T081, T003 |
| [T083](./T083-rate-limits-consolidated.md) | Rate limits consolidados (login/recovery/redeem) | 9 · Cierre | ✅ | T030, T036 |
| [T084](./T084-error-hardening.md) | Hardening de errores (sin leaks, códigos estables) | 9 · Cierre | ✅ | T048 |
| [T085](./T085-cookie-hardening.md) | Cookie hardening (httpOnly/sameSite/secure) | 9 · Cierre | ✅ | T014 |
| [T086](./T086-login-no-leak-test.md) | Test: login no filtra existencia de email | 9 · Cierre | ✅ | T029 |
| [T087](./T087-flow-lifecycle.md) | Tests de flujo: lifecycle (register→recovery→login) | 9 · Cierre | ❌ | T039 |
| [T088](./T088-flow-boxes.md) | Tests de flujo: boxes (5 límite, rename, list) | 9 · Cierre | ❌ | T071 |
| [T089](./T089-flow-transactions.md) | Tests de flujo: transacciones inmutables + reset | 9 · Cierre | ❌ | T075 |
| [T090](./T090-flow-sharing.md) | Tests de flujo: compartir (token → canje → atribución) | 9 · Cierre | ❌ | T078 |
| [T091](./T091-flow-sync.md) | Tests de flujo: sync delta exacto | 9 · Cierre | ❌ | T080 |
| [T092](./T092-token-decision-doc.md) | Decisión documentada: token expirado vs acceso canjeado | 9 · Cierre | ✅ | T090 |
| [T093](./T093-coverage-report.md) | Coverage report y umbrales verdes | 9 · Cierre | ✅ | T005, T087–T091 |
| [T094](./T094-update-docs.md) | Actualizar `/docs` con arquitectura real | 9 · Cierre | ✅ | T087–T091 |
| [T095](./T095-root-readme.md) | README raíz del producto | 9 · Cierre | ✅ | T094 |
| [T096](./T096-final-verification.md) | Verificación final: lint + test + build en verde | 9 · Cierre | ✅ | T083–T095 |
| [T103a](./T103a-landing-page.md) | Landing pública en `/` con identidad de hero.png | + · Post-plan | ✅ | T096 |
| [T103b](./T103b-theme-app.md) | Tema de la landing aplicado a toda la app (tokens) | + · Post-plan | ✅ | T103a |

## Cómo trabajar una tarea

1. Leer la tarea y sus dependencias antes de codear.
2. Implementar el mínimo que la tarea pide (sin adelantar alcance de otras).
3. Correr los tests de la tarea; si no hay, crearlos como parte de la tarea.
4. `pnpm lint && pnpm build` en verde antes de cerrar.
5. Marcar ✅ en la tabla y commitear con el ID de la tarea (ej. `T006: uuidv7 helper`).