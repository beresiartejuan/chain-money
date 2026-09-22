# Project context for agents

Before writing any code, read the project documentation in `/docs`. Start with [`/docs/README.md`](/docs/README.md), then check [`/docs/AGENTS.md`](/docs/AGENTS.md) for coding conventions and [`/docs/PRODUCT.md`](/docs/PRODUCT.md) for the product definition.

Key reminders:
- This app has **backend + frontend**. Server/database code lives under `src/db/` and future `src/server/`; UI lives in `src/app/`.
- Database layer: **Drizzle ORM + Turso** (see [`/docs/DATABASE.md`](/docs/DATABASE.md)).
- Package manager: **pnpm**. Formatter/linter: **Biome**.
- Do not commit `.env*` files.
- Keep `/docs` up to date when changing architecture, dependencies, conventions, or env vars.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
