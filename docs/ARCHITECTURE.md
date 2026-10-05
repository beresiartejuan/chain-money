# Arquitectura

## Visión general

```text
chain-money
├── src/
│   ├── app/                        # Frontend + Route Handlers (Next.js App Router)
│   │   ├── (auth)/                 # Rutas de autenticación (route group)
│   │   │   ├── _components/        # form-fields (campos de formulario)
│   │   │   ├── _lib/               # helpers puros de formularios (zod → errores)
│   │   │   ├── login/              # /login (page + login-form)
│   │   │   ├── recover/            # /recover (page + recover-form)
│   │   │   ├── register/           # /register (page + register-form)
│   │   │   └── layout.tsx
│   │   ├── api/
│   │   │   └── boxes/
│   │   │       └── [boxId]/
│   │   │           └── transactions/
│   │   │               └── route.ts  # GET sync incremental (T062–T064)
│   │   ├── dashboard/              # Rutas privadas (proxy protege /dashboard)
│   │   │   ├── _components/        # box-card, create-box-dialog, modal, ui…
│   │   │   ├── _lib/               # currency-ui (formato de moneda para UI)
│   │   │   ├── boxes/
│   │   │   │   └── [id]/           # Detalle de alcancía
│   │   │   │       ├── _components/  # confirm-dialog, reset-box, token-panel,
│   │   │   │       │                 # token-reveal-modal, transaction-form,
│   │   │   │       │                 # transaction-history
│   │   │   │       ├── _lib/         # history (transformación del historial)
│   │   │   │       └── page.tsx
│   │   │   └── page.tsx            # Lista de alcancías
│   │   ├── redeem/                 # /redeem (page + redeem-form, canje de token)
│   │   ├── layout.tsx
│   │   ├── page.tsx                # Landing pública (T103a, server component)
│   │   └── globals.css             # + animación scroll-driven del libro contable
│   ├── db/                         # Capa de datos (solo servidor)
│   │   ├── schema.ts               # 6 tablas Drizzle + tipos inferidos
│   │   ├── index.ts                # Cliente Drizzle (libSQL) + server-only
│   │   └── __tests__/              # Tests contra DB real (createTestDb)
│   ├── lib/                        # Lógica pura compartida, sin I/O de Next
│   │   ├── money.ts                # Montos en unidades menores (int)
│   │   ├── currency.ts             # Monedas ISO 4217 + exponentes
│   │   ├── cursor.ts               # Cursores opacos de paginación incremental
│   │   ├── ids.ts                  # UUIDv7
│   │   ├── env.ts                  # Validación de env con zod (export `env`)
│   │   ├── recovery.ts             # Generación/parseo de recovery phrase
│   │   ├── recovery-words.ts       # Wordlist de 12 palabras
│   │   ├── crypto/                 # aead (AES-256-GCM), password (scrypt), token
│   │   ├── validation/             # Schemas zod: auth, box-name, transaction
│   │   ├── ui/                     # auth-messages (código de error → mensaje ES)
│   │   └── client/                 # Corre en el navegador
│   │       ├── balance-cache.ts    # Cálculo puro de balance + applyTransactions
│   │       └── sync.ts             # syncBox: delta incremental + storage
│   ├── server/                     # Backend de dominio (solo servidor)
│   │   ├── errors.ts               # AppError + códigos estables para la UI
│   │   ├── rate-limit.ts           # checkRateLimit (contador en memoria)
│   │   ├── rate-limits.ts          # Tabla RATE_LIMITS (única fuente, T083)
│   │   ├── auth/                   # service, session, cookies, recovery,
│   │   │                           # encryption-key + actions (Server Actions)
│   │   ├── boxes/                  # service + actions (createBox, listBoxes…)
│   │   ├── tokens/                 # service + actions (create/redeem/revoke…)
│   │   ├── transactions/           # service, sync, config + actions
│   │   └── permissions/            # access (resolución efectiva) + assert (gate)
│   └── proxy.ts                    # Proxy de rutas (ex middleware, Next.js 16)
├── public/                         # Assets estáticos
│   └── landing/                    # Capturas del producto para la landing
├── docs/                           # Documentación del proyecto
├── drizzle/                        # Migraciones generadas por Drizzle Kit
├── tasks/                          # Plan de tareas con estado por ID
├── .env                            # Variables de entorno locales (no commitear)
├── drizzle.config.ts               # Configuración de Drizzle Kit
├── vitest.config.mts               # Vitest: alias @, cobertura, umbrales
├── biome.json                      # Linter/formatter
├── next.config.ts
├── package.json
└── tsconfig.json
```

## Capas y reglas de dependencia

- **`src/lib/`**: funciones puras, sin `next/headers` ni I/O de servidor. El
  submódulo `client/` es lo único pensado para correr en el navegador
  (caché de balance y sync incremental); el resto lo consumen server y UI.
- **`src/server/`**: lógica de dominio. Los **services** reciben la db como
  primer parámetro (tipo `LibSQLDatabase`) y **no tocan `next/headers`**:
  son testeables con una DB real y reutilizables desde actions, Route
  Handlers o jobs. Los **actions** (`"use server"`) son la capa delgada:
  resuelven la sesión actual, llaman al service y mapean los errores de
  dominio (`AppError.code`) a resultados con códigos estables para la UI.
- **`src/db/`**: schema Drizzle + cliente (import `server-only`; nunca en
  componentes `"use client"`).
- **`src/app/`**: páginas/componentes (React 19, Tailwind v4), Server
  Actions exportadas desde los módulos `actions.ts` de `src/server/*/`, y
  un único Route Handler (`src/app/api/boxes/[boxId]/transactions/route.ts`).
- **`src/proxy.ts`**: gate de rutas (Next.js 16 renombró `middleware.ts` a
  `proxy.ts`). Solo chequea la presencia de la cookie `cm_session`; la
  validación real de sesión la hace el server en cada action/página.
  `/` no redirige: sin sesión muestra la landing pública; con sesión lleva
  a `/dashboard`.

## Permisos: módulo central

La autorización vive en `src/server/permissions/` y es **un solo lugar**:

- `access.ts` — resolución de acceso efectivo (`resolveEffectiveAccess`):
  owner ⇒ permisos completos; guest ⇒ permisos de la fila `box_access`.
  Incluye las partes puras (catálogo de permisos, unión de conjuntos,
  parseo/serialización tolerante del JSON de `permissions`).
- `assert.ts` — el gate único `assertPermission` / `requireBoxAccess`:
  lanza `NotFoundError` (404 oculto) o `PermissionError` según corresponda.
  Todas las acciones de dominio (boxes, tokens, transactions) pasan por acá.

## Flujos de datos

### 1. Escritura: Server Action → service → Drizzle

```text
Componente cliente (form)
  → Server Action (src/server/<dominio>/actions.ts, "use server")
      · requireCurrentUser()  → sesión desde cookie (src/server/auth/session.ts)
      · checkRateLimit()       → si el endpoint es sensible (login, recover, reveal, redeem)
      · validate con zod       → schemas de src/lib/validation/
  → service (src/server/<dominio>/service.ts; db pasada por parámetro)
      · assertPermission()     → gate de permisos (src/server/permissions/)
      · escritura en Drizzle; operaciones multi-paso en transacción
        (BEGIN IMMEDIATE default del driver libSQL)
  → resultado o AppError; la action mapea el `code` del error y la UI
    muestra el mensaje correspondiente (mapeo estable código → texto)
```

Detalles clave:

- **Atribución forzada en el server**: autor y `createdAt` de cada
  transacción los asigna el server; el cliente no puede falsificarlos.
- **Límite de 5 alcancías**: guard atómico en `createBox` (count dentro de
  la misma transacción que inserta).
- **Regla `insufficient_funds`**: un `withdraw` mayor al balance se
  rechaza; la bandera vive en `src/server/transactions/config.ts` y el
  chequeo corre dentro de la transacción de DB (sin carreras).
- **Reset**: es una transacción de tipo `reset` con `amountMinor = 0`; el
  balance queda en 0 pero el historial permanece intacto.

### 2. Lectura incremental: Route Handler con cursor

```text
GET /api/boxes/[boxId]/transactions?cursor=<opaco>&limit=…
  → Route Handler (capa delgada): resuelve sesión, parsea query params,
    mapea AppError.code → status HTTP
  → src/server/transactions/sync.ts (service puro respecto al request)
      · authz vía módulo de permisos
      · delta ASC por la tupla (createdAt, id) — índice
        transactions_box_created_at_id_idx
      · cursor opaco (src/lib/cursor.ts) que codifica el punto de partida
        (precedencia: sinceTransactionId > since > sinceMs)
  → { transactions, nextCursor } | 400 cursor inválido | 403/404 sin acceso
```

Orden estable `(createdAt, id)`: determinista incluso cuando dos
transacciones comparten `createdAt` (T063).

### 3. Caché incremental del cliente

```text
syncBox (src/lib/client/sync.ts, corre en el navegador)
  · lee el BalanceState guardado vía storage inyectable (SyncStorage;
    en producción envuelve localStorage; en tests, memoria)
  · pide el delta al endpoint con el cursor guardado
      → delta vacío: nada que aplicar
      → cursor inválido (resync completo, T068): arranca desde cero
  · applyTransactions (src/lib/client/balance-cache.ts):
      deposit suma, withdraw resta, **reset normaliza balance a 0**
      (el historial previo de la caché no es confiable tras un reset)
  · persiste el nuevo estado y devuelve balance + transacciones para la UI
```

Ambos módulos son puros y testeados sin navegador: el storage y el
`fetchPage` son inyectados por quien integra (T080 conecta los adapters
reales sobre `localStorage`).

## Backend

- Next.js provee el backend a través de:
  - **Server Actions** (acciones asíncronas exportadas desde archivos `"use server"` en `src/server/*/actions.ts`).
  - **Route Handlers**: hoy solo el de sync incremental
    (`src/app/api/boxes/[boxId]/transactions/route.ts`).
- La capa de datos se encuentra en `src/db/` y se consume exclusivamente
  desde el servidor.

## Base de datos

- **Drizzle ORM** sobre **Turso (libSQL)**.
- Drizzle Kit gestiona migraciones, incluida una custom con los triggers de
  inmutabilidad de `transactions`.
- Ver [`DATABASE.md`](./DATABASE.md) para detalles.

## Tema de marca (T103b)

La identidad visual de toda la app es la de la landing (derivada de
`docs/images/hero.png`): **dark-first, una sola paleta, sin variantes
`dark:`**. Los tokens viven en `src/app/globals.css` (`@theme` de Tailwind
v4) y se consumen con clases semánticas:

| Token | Uso |
|---|---|
| `bg-canvas` | Fondo de la app (`#040b09`, verdoso casi negro). |
| `bg-surface` | Cards, paneles, modales (`#0c1512`). |
| `bg-elevated` | Inputs y filas dentro de una card (`#14211c`). |
| `text-fg` | Texto principal (`#f2f7f4`). |
| `text-muted` | Texto secundario (`#9db3a9`). |
| `text-faint` | Texto terciario / hairlines de texto (`#647870`). |
| `border-line` | Hairline de cards/paneles (blanco al 8%). |
| `border-rowline` | Hairline interna (blanco al 5%). |
| `bg-accent` / `text-accent` | Acento verde-agua único (`#2ee19b`). |
| `bg-accent-dim` | Relleno tenue del acento (badges, banners de éxito). |

Reglas:

- El **acento es único**: primarios yCTAs en `bg-accent` con texto negro;
  hover con glow `shadow-[0_0_16px_rgba(46,225,155,0.35)]`.
- **Deposit/plus = acento** (`text-accent`); rojo (`text-red-400`) solo para
  extracciones y destructivo; ámbar (`text-amber-400`) solo para reset y su
  badge; el toggle Depósito/Extracción usa `peer-checked:bg-accent/15`.
- Balances y montos en **Geist Mono** (`font-mono tabular-nums`), la "voz
  de libro contable".
- Estados interactivos de inputs: `focus:border-accent/60` +
  `focus:ring-accent/15`; links: `text-accent underline`.
- No usar `zinc-*` ni `dark:` en componentes: si hace falta un color
  nuevo, agregar un token semántico en `@theme` y usarlo.

## Convenciones de rutas

- Usar import aliases `@/*` → `./src/*`.
- Agrupar funcionalidad por dominio en subcarpetas de `src/server/`; los
  assets privados de un segmento de UI van en `_components/` y `_lib/`.
- Mantener lógica de presentación separada de la lógica de datos.