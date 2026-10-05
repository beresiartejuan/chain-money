import type { Metadata } from "next";
import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Landing pública de Chain Money. Server component puro, sin JS de cliente:
 * la única interacción son enlaces de navegación y CTAs hacia la app.
 * Estética derivada de `docs/images/hero.png`: base casi negra con tinte
 * verde, glow esmeralda en esquinas y verde-agua (#2ee19b) como acento.
 */

export const metadata: Metadata = {
  title: "Alcancías compartidas con historial inmutable",
  description:
    "Registrá depósitos y extracciones en alcancías compartidas. Nada se edita ni se borra: el balance se calcula desde el historial completo.",
};

/** Fondo con glow esmeralda en esquinas, sobre base casi negra verdosa. */
const GLOW_BG =
  "bg-canvas bg-[radial-gradient(60rem_40rem_at_-10%_-10%,rgba(16,185,129,0.14),transparent_60%),radial-gradient(60rem_40rem_at_110%_110%,rgba(16,185,129,0.12),transparent_60%),radial-gradient(50rem_30rem_at_50%_0%,rgba(45,212,191,0.06),transparent_70%)]";

const ACCENT = "#2ee19b";

/** Isotipo: chanchito rosado sobre tile verde-agua, como en el README. */
function PiggyMark({ className }: { className?: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-lg bg-gradient-to-b from-[#34e0a1] to-[#26b07f] shadow-[0_0_16px_rgba(46,225,155,0.35)] ${className ?? "h-8 w-8"}`}
    >
      <svg
        viewBox="0 0 26 26"
        fill="none"
        className="h-3/5 w-3/5"
        aria-hidden="true"
      >
        <ellipse cx="13.8" cy="14.4" rx="6.9" ry="5.7" fill="#f8a9c0" />
        <path d="M16.9 9.1c1.4-1 3-.5 3.4.5.3 1-.5 2-1.8 2.2" fill="#f8a9c0" />
        <path
          d="M20.4 12.6c1.2.5 1.3 1.9.3 2.4"
          stroke="#ef8fb0"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M10.6 18.4v2M16.6 18.4v2"
          stroke="#ef8fb0"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <ellipse cx="7.7" cy="14.9" rx="2.1" ry="1.7" fill="#ef8fb0" />
        <path
          d="M7.1 14.6v.9M8.3 14.6v.9"
          stroke="#c25e7e"
          strokeWidth="0.9"
          strokeLinecap="round"
        />
        <path
          d="M12 8.4h4.4"
          stroke="#c25e7e"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="11.2" cy="12.4" r="0.8" fill="#c25e7e" />
      </svg>
    </span>
  );
}

/** Ojo de línea para los íconos de pasos. */
const ICON_CLASS = "h-5 w-5";

function VaultIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={ACCENT}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={ICON_CLASS}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="12" cy="12" r="4" />
      <path d="M9 8h6" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={ACCENT}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={ICON_CLASS}
      aria-hidden="true"
    >
      <path d="M4 5h16" />
      <path d="M4 10h16" />
      <path d="M4 15h10" />
      <path d="M4 20h6" />
      <path d="M17.5 19.5 21 16l-3.5-3.5" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={ACCENT}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={ICON_CLASS}
      aria-hidden="true"
    >
      <circle cx="8" cy="16" r="3.5" />
      <path d="M10.5 13.5 20 4" />
      <path d="M16.5 7.5 20 11" />
    </svg>
  );
}

function CalcIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={ACCENT}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={ICON_CLASS}
      aria-hidden="true"
    >
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6" />
      <path d="M9 12h2M13.5 12h1.5M9 16h2M13.5 16h1.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={ACCENT}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M4 12l5 5L20 7" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

type Step = {
  number: string;
  title: string;
  description: string;
  icon: ReactNode;
};

const STEPS: Step[] = [
  {
    number: "01",
    title: "Creás tu alcancía",
    description:
      "Hasta 5 alcancías por cuenta, cada una con su moneda fija desde el día uno y su identificador único.",
    icon: <VaultIcon />,
  },
  {
    number: "02",
    title: "Anotás cada movimiento",
    description:
      "Depósitos y extracciones con contraparte, nota, autor y fecha. Cada registro es definitivo, siempre.",
    icon: <LedgerIcon />,
  },
  {
    number: "03",
    title: "Compartís con un token",
    description:
      "Invitás a alguien con un token de un solo uso y elegís qué puede hacer: ver, registrar movimientos o resetear.",
    icon: <KeyIcon />,
  },
  {
    number: "04",
    title: "El balance se calcula solo",
    description:
      "Nada se edita ni se borra, así que el saldo es siempre la suma exacta del historial, sincronizado de forma incremental.",
    icon: <CalcIcon />,
  },
];

type LedgerRow = {
  index: string;
  date: string;
  concept: string;
  detail: string;
  amount: string;
  sign: "in" | "out";
};

const LEDGER_ROWS: LedgerRow[] = [
  {
    index: "01",
    date: "05/10 17:28",
    concept: "Extra del mes",
    detail: "Freelance de diseño",
    amount: "+480.75",
    sign: "in",
  },
  {
    index: "02",
    date: "05/10 17:29",
    concept: "Aporte de septiembre",
    detail: "Ahorro conjunto",
    amount: "+250.00",
    sign: "in",
  },
  {
    index: "03",
    date: "05/10 17:30",
    concept: "Seña de hostel en Lisboa",
    detail: "Vacaciones 2027",
    amount: "-85.50",
    sign: "out",
  },
  {
    index: "04",
    date: "05/10 17:31",
    concept: "Regalo para mamá",
    detail: "Fondo compartido",
    amount: "+100.00",
    sign: "in",
  },
];

type LedgerLine = {
  label: string;
  value: string;
};

const TOKEN_LINES: LedgerLine[] = [
  { label: "Permiso", value: "ver + registrar movimientos" },
  { label: "Estado", value: "se consume al canjearse" },
  { label: "Canje", value: "solo usuarios registrados" },
];

export default function Landing() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-canvas font-sans text-fg">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-rowline bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <a href="/" className="flex items-center gap-2.5">
            <PiggyMark />
            <span className="text-base font-semibold tracking-tight text-fg">
              Chain Money
            </span>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
            <a
              href="#como-funciona"
              className="transition-colors hover:text-accent"
            >
              Cómo funciona
            </a>
            <a
              href="#inmutabilidad"
              className="transition-colors hover:text-accent"
            >
              Inmutabilidad
            </a>
            <a
              href="#compartir"
              className="transition-colors hover:text-accent"
            >
              Compartir
            </a>
          </nav>
          <a
            href="/register"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black transition-shadow hover:shadow-[0_0_24px_rgba(46,225,155,0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Empezar
          </a>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero + capturas + tira de libro contable, dentro del campo de glow */}
        <section className={`relative overflow-hidden ${GLOW_BG}`}>
          <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-24 pb-28 sm:pt-32">
            <div className="flex flex-col items-center text-center">
              <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-white/5 px-4 py-1.5 text-sm text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Alcancías compartidas, historial inmutable
              </span>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-balance text-fg sm:text-6xl">
                Tus movimientos, escritos{" "}
                <span className="text-accent">para siempre</span>.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-pretty leading-relaxed text-muted">
                Anotá depósitos y extracciones en tus alcancías compartidas.
                Nada se edita ni se borra: el balance se calcula sobre la
                totalidad del historial.
              </p>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                <a
                  href="/register"
                  className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-black transition-shadow hover:shadow-[0_0_32px_rgba(46,225,155,0.55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Crear mi primera alcancía
                </a>
                <a
                  href="#como-funciona"
                  className="rounded-full border border-line bg-white/5 px-6 py-3 text-sm font-medium text-fg transition-colors hover:border-accent/40 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Ver cómo funciona
                </a>
              </div>
              <p className="mt-6 font-mono text-[11px] tracking-[0.22em] text-faint uppercase">
                Inmutable · Tokens de un solo uso · Balance calculado
              </p>
            </div>

            {/* Capturas del producto, enmarcadas con glow */}
            <div className="relative mt-20 grid grid-cols-1 items-start gap-8 lg:grid-cols-[5fr_4fr]">
              <div
                aria-hidden="true"
                className="absolute -inset-x-6 -inset-y-10 -z-10 rounded-4xl bg-accent/10 blur-3xl"
              />
              <div className="relative">
                <Image
                  src="/landing/dashboard.png"
                  alt="Dashboard de Chain Money con el listado de alcancías y sus balances"
                  width={1284}
                  height={994}
                  sizes="(min-width: 1024px) 55vw, 92vw"
                  loading="eager"
                  className="h-auto w-full rounded-xl ring-1 ring-line"
                />
              </div>
              <div className="relative mx-auto w-full max-w-md lg:mx-0 lg:mt-24 lg:max-w-none">
                <Image
                  src="/landing/box-detail-cropped.png"
                  alt="Detalle de una alcancía: balance, movimientos inmutables y panel para compartir con tokens"
                  width={1284}
                  height={1700}
                  sizes="(min-width: 1024px) 45vw, 92vw"
                  className="h-auto w-full rounded-xl ring-1 ring-line"
                />
              </div>
            </div>

            {/* Tira de libro contable: la inmutabilidad contada en vivo */}
            <div className="relative mt-28">
              <p className="font-mono text-[11px] tracking-[0.22em] text-accent uppercase">
                Libro contable en vivo
              </p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
                Cada movimiento, anotado a mano.
              </h2>
              <div className="mt-8 grid grid-cols-1 overflow-hidden rounded-xl border border-line bg-white/[0.03] backdrop-blur-sm lg:grid-cols-[1fr_16rem]">
                <ol className="p-6 sm:p-8">
                  {LEDGER_ROWS.map((row) => (
                    <li
                      key={row.index}
                      className="ledger-reveal flex items-baseline gap-3 border-b border-rowline py-3 last:border-b-0 sm:gap-4"
                    >
                      <span className="w-5 font-mono text-xs text-faint">
                        {row.index}
                      </span>
                      <span className="hidden w-24 font-mono text-xs text-faint sm:block">
                        {row.date}
                      </span>
                      <span className="flex-1 text-sm text-fg">
                        {row.concept}
                        <span className="block text-xs text-faint">
                          {row.detail}
                        </span>
                      </span>
                      <span
                        className={`font-mono text-sm tabular-nums ${
                          row.sign === "in" ? "text-accent" : "text-red-400"
                        }`}
                      >
                        {row.amount}
                      </span>
                    </li>
                  ))}
                  <li
                    className="ledger-reveal mt-3 flex items-baseline justify-between font-mono"
                    aria-label="Reset: el balance vuelve a cero, registrado como un evento más"
                  >
                    <span className="text-xs tracking-[0.22em] text-faint uppercase">
                      Reset
                    </span>
                    <span className="text-sm text-accent">▷ balance → 0</span>
                  </li>
                </ol>
                <div className="flex flex-col justify-between border-t border-line p-6 sm:p-8 lg:border-t-0 lg:border-l">
                  <p className="font-mono text-[11px] tracking-[0.22em] text-faint uppercase">
                    Balance
                  </p>
                  <div>
                    <p className="ledger-reveal font-mono text-5xl tabular-nums text-fg">
                      745.25
                    </p>
                    <p className="ledger-reveal mt-2 flex gap-4 font-mono text-xs">
                      <span className="text-accent">+830.75</span>
                      <span className="text-red-400">-85.50</span>
                    </p>
                  </div>
                  <p className="mt-6 text-xs leading-relaxed text-faint">
                    Calculado desde el historial, nunca almacenado ni corregido
                    a mano.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Cómo funciona */}
        <section id="como-funciona" className="scroll-mt-24">
          <div className="mx-auto w-full max-w-6xl px-6 py-24">
            <p className="font-mono text-[11px] tracking-[0.22em] text-accent uppercase">
              Cómo funciona
            </p>
            <h2 className="mt-3 max-w-xl text-2xl font-semibold text-balance tracking-tight text-fg sm:text-3xl">
              De la alcancía vacía al saldo exacto, en cuatro pasos.
            </h2>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step) => (
                <div
                  key={step.number}
                  className="flex flex-col rounded-xl border border-line bg-white/[0.03] p-6 transition-colors hover:border-accent/30"
                >
                  <div className="flex items-center justify-between">
                    {step.icon}
                    <span className="font-mono text-xs text-faint">
                      {step.number}/04
                    </span>
                  </div>
                  <h3 className="mt-5 text-base font-medium text-fg">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Inmutabilidad, contraste con apps de banco corrientes */}
        <section id="inmutabilidad" className="scroll-mt-24">
          <div className="mx-auto w-full max-w-6xl px-6 py-24">
            <p className="font-mono text-[11px] tracking-[0.22em] text-accent uppercase">
              Inmutabilidad
            </p>
            <h2 className="mt-3 max-w-xl text-2xl font-semibold text-balance tracking-tight text-fg sm:text-3xl">
              Lo escrito, escrito está.
            </h2>
            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-rowline bg-white/[0.02] p-6 sm:p-8">
                <h3 className="font-mono text-[11px] tracking-[0.22em] text-faint uppercase">
                  Apps de banco corrientes
                </h3>
                <ul className="mt-6 flex flex-col gap-4 text-sm text-faint">
                  <li className="flex items-start gap-3">
                    <CrossIcon />
                    <span className="line-through decoration-faint">
                      Editar un movimiento
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CrossIcon />
                    <span className="line-through decoration-faint">
                      Borrar un movimiento
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CrossIcon />
                    <span className="line-through decoration-faint">
                      Corregir el saldo a mano
                    </span>
                  </li>
                </ul>
                <p className="mt-6 text-xs text-faint">
                  Si el historial cambia, deja de ser un registro confiable.
                </p>
              </div>
              <div className="rounded-xl border border-accent/25 bg-white/[0.04] p-6 shadow-[0_0_40px_rgba(46,225,155,0.08)] sm:p-8">
                <h3 className="font-mono text-[11px] tracking-[0.22em] text-accent uppercase">
                  Chain Money
                </h3>
                <ul className="mt-6 flex flex-col gap-4 text-sm text-fg">
                  <li className="flex items-start gap-3">
                    <CheckIcon />
                    Depósitos: anotados.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckIcon />
                    Extracciones: anotadas.
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckIcon />
                    Reseteos: anotados con autor y fecha, como un evento más.
                  </li>
                </ul>
                <p className="mt-8 text-xs text-accent/70">
                  No existe botón de edición — ni siquiera existe el endpoint.
                  La base de datos lo garantiza con triggers.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Compartir con tokens de un solo uso */}
        <section id="compartir" className="scroll-mt-24">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-[1fr_minmax(0,26rem)]">
            <div>
              <p className="font-mono text-[11px] tracking-[0.22em] text-accent uppercase">
                Compartir
              </p>
              <h2 className="mt-3 max-w-xl text-2xl font-semibold text-balance tracking-tight text-fg sm:text-3xl">
                Invitá sin dar las llaves.
              </h2>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted">
                Para compartir una alcancía generás un token de un solo uso: se
                muestra una única vez y se consume al canjearse. Vos elegís los
                permisos — solo ver, registrar movimientos o resetear — y cada
                movimiento queda firmado por quien lo hizo.
              </p>
            </div>
            <div className="rounded-xl border border-line bg-white/[0.03] p-6 sm:p-8">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-fg">Fondo de viajes</span>
                <span className="rounded-full border border-accent/30 bg-accent-dim px-2.5 py-0.5 text-xs text-accent">
                  Activo
                </span>
              </div>
              <dl className="mt-6 flex flex-col gap-3 text-xs">
                {TOKEN_LINES.map((line) => (
                  <div
                    key={line.label}
                    className="flex items-baseline justify-between gap-4 border-b border-rowline pb-3 last:border-b-0 last:pb-0"
                  >
                    <dt className="text-faint">{line.label}</dt>
                    <dd className="text-right font-mono text-accent">
                      {line.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 rounded-lg bg-black/40 p-3 font-mono text-xs break-all text-accent/90">
                CM-7F4K-2MQX-9P2L-77TZ
              </p>
              <p className="mt-4 text-xs text-faint">
                Se muestra una sola vez. Guardalo antes de cerrar.
              </p>
            </div>
          </div>
        </section>

        {/* CTA final, con glow de cierre */}
        <section className={`relative overflow-hidden ${GLOW_BG}`}>
          <div className="relative z-10 flex flex-col items-center px-6 py-28 text-center">
            <PiggyMark className="h-12 w-12 rounded-xl text-2xl shadow-[0_0_24px_rgba(46,225,155,0.4)]" />
            <h2 className="mt-6 max-w-2xl text-3xl font-semibold text-balance tracking-tight text-fg sm:text-4xl">
              El ahorro compartido merece un registro confiable.
            </h2>
            <p className="mt-4 max-w-md text-base text-balance leading-relaxed text-muted">
              Creá tu cuenta, abrí tu primera alcancía y anotá el primer
              movimiento. El resto del historial queda escrito para siempre.
            </p>
            <a
              href="/register"
              className="mt-8 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-black transition-shadow hover:shadow-[0_0_32px_rgba(46,225,155,0.55)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Crear mi primera alcancía
            </a>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-rowline">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-8 text-xs text-faint">
          <span>© 2026 Chain Money</span>
          <span className="flex items-center gap-2">
            <PiggyMark className="h-5 w-5 rounded-md" />
            Historial inmutable, siempre.
          </span>
        </div>
      </footer>
    </div>
  );
}
