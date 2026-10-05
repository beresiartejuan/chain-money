"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormErrorBanner } from "@/app/(auth)/_components/form-fields";
import {
  Badge,
  Card,
  PrimaryButton,
  SmallButton,
} from "@/app/dashboard/_components/ui";
import {
  createTokenAction,
  expireTokenAction,
  revokeTokenAction,
} from "@/server/tokens/actions";
import { ConfirmDialog } from "./confirm-dialog";
import { TokenRevealModal } from "./token-reveal-modal";

/**
 * T076 — Panel "Compartir" del owner en la vista detalle: crear tokens de
 * un solo uso y administrar los existentes (expirar/borrar). Solo se
 * renderiza con `isOwner` (lo decide la page); un guest no ve nada.
 *
 * - **Crear**: checkboxes sobre el catálogo de permisos; `view:transactions`
 *   va checked + disabled (siempre incluido, es el mínimo). El catálogo
 *   está declarado acá (espejo del de `@/server/permissions/access`, que
 *   es `server-only` y no puede importarse desde un módulo cliente).
 * - **Reveal (T077)**: al crear, el token crudo pasa al estado local
 *   `revealToken` y se muestra UNA vez en el modal; al cerrarlo se descarta
 *   y `router.refresh()` trae la lista nueva (el token aparece por su
 *   prefix, status activo).
 * - **Lista**: la page resuelve la lista inicial server-side; tras cada
 *   mutación `router.refresh()` re-resuelve props y el estado local se
 *   re-alinea (patrón "ajustar estado durante el render", sin Effect).
 * - **Errores**: expirar/borrar muestran el error dentro del diálogo de
 *   confirmación (se puede reintentar); `token_already_redeemed` y
 *   `forbidden` tienen mensajes propios.
 */

/** Shape serializable de un token en la lista (sin hash ni token crudo). */
export type TokenListItem = {
  id: string;
  tokenPrefix: string;
  permissions: string[];
  status: string;
  createdAt: number;
  redeemedAt: number | null;
  redeemedByName: string | null;
};

/**
 * Catálogo de permisos del form (espejo local de `ALL_PERMISSIONS`, en el
 * mismo orden canónico): `view:transactions` es obligatorio y el resto,
 * opcional.
 */
const PERMISSION_OPTIONS = [
  {
    id: "token-perm-view",
    label: "Ver transacciones",
    locked: true,
    value: "view:transactions",
  },
  {
    id: "token-perm-create",
    label: "Registrar transacciones",
    locked: false,
    value: "create:transactions",
  },
  {
    id: "token-perm-reset",
    label: "Poder resetear",
    locked: false,
    value: "reset:box",
  },
] as const;

/** Permiso siempre incluido en cada token creado. */
const ALWAYS_INCLUDED = "view:transactions";

/** Etiquetas cortas de los badges de permisos de la lista. */
const PERMISSION_BADGE_LABELS: Record<string, string> = {
  "create:transactions": "Registrar",
  "reset:box": "Resetear",
  "view:transactions": "Ver",
};

/** Badge de estado del token, con color por estado ("Usado" usa el neutro). */
function StatusBadge({ status }: { status: string }) {
  if (status === "active") {
    return (
      <span className="rounded-full border border-accent/30 bg-accent-dim px-2 py-0.5 text-xs font-medium text-accent">
        Activo
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-400">
        Expirado
      </span>
    );
  }
  return <Badge>Usado</Badge>;
}

/**
 * Fecha determinista `dd/mm/aaaa HH:MM` (UTC, 2 dígitos con cero), igual
 * que en el historial (mismo formato a mano, sin `Intl` con zona): server
 * e hidratación producen exactamente el mismo string.
 */
function formatTimestamp(createdAt: number): string {
  const date = new Date(createdAt);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes} UTC`;
}

/** Texto de error bajo el grupo de checkboxes, con id estable para a11y. */
function FieldError({ id, children }: { id: string; children?: string }) {
  if (!children) {
    return null;
  }
  return (
    <p className="text-sm text-red-400" id={id}>
      {children}
    </p>
  );
}

/** Tipo del diálogo de confirmación pendiente (expirar o borrar). */
type PendingConfirm = {
  kind: "expire" | "revoke";
  token: TokenListItem;
};

export function TokenPanel({
  boxId,
  initialTokens,
}: {
  boxId: string;
  /** Lista inicial, ya resuelta server-side por la page. */
  initialTokens: TokenListItem[];
}) {
  const router = useRouter();

  const [tokens, setTokens] = useState<TokenListItem[]>(initialTokens);
  // Tras un `router.refresh()` la page re-resuelve la lista (nuevos props);
  // el estado local vuelve a alinearse con ella, sin Effect.
  const [previousInitial, setPreviousInitial] = useState(initialTokens);
  if (previousInitial !== initialTokens) {
    setPreviousInitial(initialTokens);
    setTokens(initialTokens);
  }

  const [selected, setSelected] = useState<string[]>([ALWAYS_INCLUDED]);
  const [pending, setPending] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [revealToken, setRevealToken] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  function togglePermission(value: string, checked: boolean): void {
    setSelected((previous) =>
      checked
        ? previous.includes(value)
          ? previous
          : [...previous, value]
        : previous.filter((permission) => permission !== value),
    );
  }

  async function handleCreate(): Promise<void> {
    setPending(true);
    setBanner(null);
    setPermissionError(null);

    const result = await createTokenAction(boxId, selected);

    if (result.ok) {
      setPending(false);
      // El form vuelve al mínimo (solo view); el crudo se revela una vez.
      setSelected([ALWAYS_INCLUDED]);
      setRevealToken(result.token);
      return;
    }
    setPending(false);

    if (result.error.code === "validation") {
      const first = result.error.fieldErrors.permissions?.[0];
      setPermissionError(
        first ?? "No se pudo crear el token. Intentá de nuevo.",
      );
      return;
    }
    if (result.error.code === "unauthorized") {
      setBanner("Tu sesión expiró. Recargá la página e iniciá sesión.");
      return;
    }
    if (result.error.code === "not_found") {
      setBanner("Esta alcancía ya no existe o dejó de estar compartida.");
      return;
    }
    if (result.error.code === "forbidden") {
      setBanner("No tenés permiso para crear tokens de esta alcancía.");
      return;
    }
    setBanner("No se pudo crear el token. Intentá de nuevo.");
  }

  /** Al cerrar el reveal el crudo se descarta y la lista trae el nuevo. */
  function handleRevealClose(): void {
    setRevealToken(null);
    router.refresh();
  }

  function openConfirm(
    kind: PendingConfirm["kind"],
    token: TokenListItem,
  ): void {
    setConfirmError(null);
    setConfirm({ kind, token });
  }

  /** Mensaje para un fallo de expire/revoke (mismos códigos, textos por verbo). */
  function confirmErrorMessage(
    kind: PendingConfirm["kind"],
    code: "token_already_redeemed" | "not_found" | "forbidden" | "unauthorized",
  ): string {
    switch (code) {
      case "token_already_redeemed":
        return kind === "revoke"
          ? "No se puede borrar un token ya canjeado."
          : "No se puede expirar un token ya canjeado.";
      case "not_found":
        return "El token ya no existe. Recargá la página.";
      case "forbidden":
        return "No tenés permiso para administrar los tokens de esta alcancía.";
      case "unauthorized":
        return "Tu sesión expiró. Recargá la página e iniciá sesión.";
    }
  }

  async function handleConfirmAction(): Promise<void> {
    if (confirm === null) {
      return;
    }
    const { kind, token } = confirm;
    setConfirmPending(true);
    setConfirmError(null);

    const result =
      kind === "expire"
        ? await expireTokenAction(token.id)
        : await revokeTokenAction(token.id);

    if (result.ok) {
      setConfirmPending(false);
      setConfirm(null);
      // La page server re-resuelve la lista con el estado nuevo.
      router.refresh();
      return;
    }
    setConfirmPending(false);
    setConfirmError(confirmErrorMessage(kind, result.error.code));
  }

  return (
    <>
      <Card>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-fg">Compartir</h2>
          <p className="text-sm text-muted">
            Creá un token de un solo uso para invitar a alguien a esta alcancía:
            quien lo canjee obtiene los permisos que elijas.
          </p>
        </div>

        <form action={handleCreate} className="flex flex-col gap-3">
          <fieldset
            aria-describedby={
              permissionError !== null ? "token-permissions-error" : undefined
            }
            className="flex flex-col gap-2"
          >
            <legend className="text-sm font-medium text-muted">
              Permisos para quien canjee el token
            </legend>
            {PERMISSION_OPTIONS.map((option) => (
              <label
                className="flex items-center gap-2 text-sm text-fg"
                key={option.id}
              >
                <input
                  checked={selected.includes(option.value)}
                  className="size-4 rounded border-line accent-[#2ee19b]"
                  disabled={option.locked}
                  id={option.id}
                  name="token-permissions"
                  onChange={(event) => {
                    togglePermission(option.value, event.target.checked);
                  }}
                  type="checkbox"
                  value={option.value}
                />
                {option.label}
                {option.locked && (
                  <span className="text-xs text-faint">(siempre activo)</span>
                )}
              </label>
            ))}
          </fieldset>
          <FieldError id="token-permissions-error">
            {permissionError ?? undefined}
          </FieldError>

          {banner !== null && <FormErrorBanner>{banner}</FormErrorBanner>}

          <div className="flex justify-end">
            <PrimaryButton disabled={pending} type="submit">
              {pending ? "Creando…" : "Crear token"}
            </PrimaryButton>
          </div>
        </form>

        <div className="flex items-baseline justify-between gap-2 border-t border-rowline pt-4">
          <h3 className="text-sm font-semibold text-fg">Tokens compartidos</h3>
          <p className="text-sm text-muted">
            {tokens.length} {tokens.length === 1 ? "token" : "tokens"}
          </p>
        </div>

        {tokens.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-elevated px-4 py-6 text-center text-sm text-muted">
            Todavía no compartiste esta alcancía.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tokens.map((token) => (
              <li
                className="flex items-start justify-between gap-3 rounded-lg border border-rowline bg-elevated px-3 py-2.5"
                key={token.id}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm text-fg">
                      {token.tokenPrefix}…
                    </code>
                    <StatusBadge status={token.status} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {token.permissions.map((permission) => (
                      <Badge key={permission}>
                        {PERMISSION_BADGE_LABELS[permission] ?? permission}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-faint">
                    Creado{" "}
                    <time dateTime={new Date(token.createdAt).toISOString()}>
                      {formatTimestamp(token.createdAt)}
                    </time>
                    {token.redeemedAt !== null && (
                      <>
                        {" · Canjeado "}
                        <time
                          dateTime={new Date(token.redeemedAt).toISOString()}
                        >
                          {formatTimestamp(token.redeemedAt)}
                        </time>
                        {token.redeemedByName !== null &&
                          ` por ${token.redeemedByName}`}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {token.status === "active" && (
                    <SmallButton
                      onClick={() => {
                        openConfirm("expire", token);
                      }}
                    >
                      Expirar
                    </SmallButton>
                  )}
                  <SmallButton
                    onClick={() => {
                      openConfirm("revoke", token);
                    }}
                  >
                    Borrar
                  </SmallButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {confirm !== null && (
        <ConfirmDialog
          confirmLabel={confirm.kind === "expire" ? "Expirar" : "Borrar"}
          description={
            confirm.kind === "expire" ? (
              <p className="text-sm text-muted">
                El token{" "}
                <code className="font-mono text-fg">
                  {confirm.token.tokenPrefix}…
                </code>{" "}
                va a quedar expirado: ya no se podrá canjear, pero sigue en la
                lista como registro.
              </p>
            ) : (
              <p className="text-sm text-muted">
                El token{" "}
                <code className="font-mono text-fg">
                  {confirm.token.tokenPrefix}…
                </code>{" "}
                se va a borrar definitivamente. Si ya lo compartiste, quien lo
                tenga no va a poder canjearlo.
              </p>
            )
          }
          error={confirmError}
          onClose={() => {
            setConfirm(null);
          }}
          onConfirm={() => {
            void handleConfirmAction();
          }}
          pending={confirmPending}
          pendingLabel={confirm.kind === "expire" ? "Expirando…" : "Borrando…"}
          title={confirm.kind === "expire" ? "Expirar token" : "Borrar token"}
        />
      )}

      {revealToken !== null && (
        <TokenRevealModal onClose={handleRevealClose} token={revealToken} />
      )}
    </>
  );
}
