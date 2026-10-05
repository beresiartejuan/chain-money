"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormErrorBanner } from "@/app/(auth)/_components/form-fields";
import { actionFieldErrors, zodFieldErrors } from "@/app/(auth)/_lib/forms";
import { Card, PrimaryButton } from "@/app/dashboard/_components/ui";
import { currencyExponent } from "@/lib/currency";
import {
  COUNTERPARTY_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  transactionSchema,
} from "@/lib/validation/transaction";
import { createTransactionAction } from "@/server/transactions/actions";

/**
 * T073 — Formulario de transacción (deposit/withdraw) en la vista detalle.
 *
 * - Toggle de tipo con radios nativos (segmented control visual).
 * - Validación client con `transactionSchema(currencyExponent(currency))`:
 *   el monto se valida al vuelo (onChange) y todos los campos al submit,
 *   así el mensaje es exactamente el que devolvería el server (mismo
 *   schema compartido, T056).
 * - Errores server reflejados: `validation` → fieldErrors por campo;
 *   `insufficient_funds` → banner de saldo; `unauthorized`/`not_found`/
 *   `forbidden` → banners específicos (la sesión o los permisos cambiaron).
 * - Al éxito: `router.refresh()` recarga la page server con el balance y
 *   el historial actualizados; los campos se limpian para el siguiente
 *   movimiento.
 *
 * Solo se renderiza con `create:transactions` (lo decide la page; T079
 * verificará el gate).
 */

type MovementType = "deposit" | "withdraw";

/** Errores por campo del form (el schema solo valida estos tres). */
type FormFieldErrors = Partial<
  Record<"amount" | "counterparty" | "note", string>
>;

/** Input crudo del form, en la forma que espera `createTransactionAction`. */
type TransactionFormInput = {
  type: MovementType;
  amount: string;
  counterparty?: string;
  note?: string;
};

/** Texto de error bajo un campo, en rojo, con id estable para a11y. */
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

const inputClassName =
  "h-10 w-full rounded-md border border-line bg-elevated px-3 text-sm text-fg outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/15";

const textareaClassName =
  "min-h-20 w-full rounded-md border border-line bg-elevated px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/15";

const labelClassName = "text-sm font-medium text-muted";

/**
 * Arma el input para el schema/action: los opcionales vacíos (o con solo
 * espacios) van como `undefined`, igual que haría el trim del server.
 */
function buildInput(
  type: MovementType,
  amount: string,
  counterparty: string,
  note: string,
): TransactionFormInput {
  return {
    type,
    amount,
    counterparty: counterparty.trim() === "" ? undefined : counterparty,
    note: note.trim() === "" ? undefined : note,
  };
}

export function TransactionForm({
  boxId,
  currency,
}: {
  boxId: string;
  currency: string;
}) {
  const router = useRouter();
  const exponent = currencyExponent(currency);
  const [type, setType] = useState<MovementType>("deposit");
  const [amount, setAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FormFieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);

  /**
   * Valida el monto al vuelo (onChange) con el schema compartido: el
   * mensaje es exactamente el que devolvería el server. Campo vacío no
   * marca error (lo bloquea el submit).
   */
  function handleAmountChange(next: string): void {
    setAmount(next);
    if (next.trim() === "") {
      setFieldErrors((previous) => ({ ...previous, amount: undefined }));
      return;
    }
    const parsed = transactionSchema(exponent).safeParse(
      buildInput(type, next, counterparty, note),
    );
    setFieldErrors((previous) => ({
      ...previous,
      amount: parsed.success ? undefined : zodFieldErrors(parsed.error).amount,
    }));
  }

  async function handleSubmit(): Promise<void> {
    const input = buildInput(type, amount, counterparty, note);

    // Validación client con el mismo schema del server: errores sin
    // roundtrip (decimales de más, nota > 150, monto 0, etc.).
    const parsed = transactionSchema(exponent).safeParse(input);
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }

    setPending(true);
    setBanner(null);
    setFieldErrors({});

    const result = await createTransactionAction(boxId, input);

    if (result.ok) {
      setPending(false);
      setAmount("");
      setCounterparty("");
      setNote("");
      // La page server recarga con el balance y el historial nuevos.
      router.refresh();
      return;
    }
    setPending(false);

    if (result.error.code === "validation") {
      setFieldErrors(actionFieldErrors(result.error.fieldErrors));
      return;
    }
    if (result.error.code === "insufficient_funds") {
      setBanner("Saldo insuficiente: el balance no alcanza para este retiro.");
      return;
    }
    if (result.error.code === "unauthorized") {
      setBanner("Tu sesión expiró. Recargá la página e iniciá sesión.");
      return;
    }
    if (result.error.code === "not_found") {
      setBanner(
        "Esta alcancía ya no existe o dejó de estar compartida con vos.",
      );
      return;
    }
    if (result.error.code === "forbidden") {
      setBanner(
        "No tenés permiso para registrar movimientos en esta alcancía.",
      );
      return;
    }
    setBanner("No se pudo registrar el movimiento. Intentá de nuevo.");
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-fg">Nuevo movimiento</h2>

      <form action={handleSubmit} className="flex flex-col gap-4">
        {banner !== null && <FormErrorBanner>{banner}</FormErrorBanner>}

        <div className="flex flex-col gap-1.5">
          <span className={labelClassName}>Tipo de movimiento</span>
          <div
            aria-label="Tipo de movimiento"
            className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-elevated p-1"
            role="radiogroup"
          >
            <label className="cursor-pointer">
              <input
                checked={type === "deposit"}
                className="peer sr-only"
                name="transaction-type"
                onChange={() => {
                  setType("deposit");
                }}
                type="radio"
                value="deposit"
              />
              <span className="block rounded-md px-3 py-1.5 text-center text-sm font-medium text-muted transition-colors peer-checked:bg-accent/15 peer-checked:text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
                ▲ Depósito
              </span>
            </label>
            <label className="cursor-pointer">
              <input
                checked={type === "withdraw"}
                className="peer sr-only"
                name="transaction-type"
                onChange={() => {
                  setType("withdraw");
                }}
                type="radio"
                value="withdraw"
              />
              <span className="block rounded-md px-3 py-1.5 text-center text-sm font-medium text-muted transition-colors peer-checked:bg-accent/15 peer-checked:text-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
                ▼ Extracción
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelClassName} htmlFor="transaction-amount">
            Monto ({currency})
          </label>
          <input
            aria-describedby={
              fieldErrors.amount ? "transaction-amount-error" : undefined
            }
            aria-invalid={fieldErrors.amount ? true : undefined}
            autoComplete="off"
            className={inputClassName}
            id="transaction-amount"
            inputMode="decimal"
            name="amount"
            onChange={(event) => {
              handleAmountChange(event.target.value);
            }}
            type="text"
            value={amount}
          />
          {fieldErrors.amount ? (
            <FieldError id="transaction-amount-error">
              {fieldErrors.amount}
            </FieldError>
          ) : (
            <p className="text-xs text-faint">
              {exponent === 0
                ? "Esta moneda no usa decimales."
                : `Hasta ${exponent} decimales.`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={labelClassName} htmlFor="transaction-counterparty">
            Contraparte (opcional)
          </label>
          <input
            aria-describedby={
              fieldErrors.counterparty
                ? "transaction-counterparty-error"
                : undefined
            }
            aria-invalid={fieldErrors.counterparty ? true : undefined}
            className={inputClassName}
            id="transaction-counterparty"
            maxLength={COUNTERPARTY_MAX_LENGTH}
            name="counterparty"
            onChange={(event) => {
              setCounterparty(event.target.value);
              if (fieldErrors.counterparty !== undefined) {
                setFieldErrors((previous) => ({
                  ...previous,
                  counterparty: undefined,
                }));
              }
            }}
            type="text"
            value={counterparty}
          />
          <FieldError id="transaction-counterparty-error">
            {fieldErrors.counterparty}
          </FieldError>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className={labelClassName} htmlFor="transaction-note">
              Nota (opcional)
            </label>
            <span className="text-xs tabular-nums text-faint">
              {note.length}/{NOTE_MAX_LENGTH}
            </span>
          </div>
          <textarea
            aria-describedby={
              fieldErrors.note ? "transaction-note-error" : undefined
            }
            aria-invalid={fieldErrors.note ? true : undefined}
            className={textareaClassName}
            id="transaction-note"
            maxLength={NOTE_MAX_LENGTH}
            name="note"
            onChange={(event) => {
              setNote(event.target.value);
              if (fieldErrors.note !== undefined) {
                setFieldErrors((previous) => ({
                  ...previous,
                  note: undefined,
                }));
              }
            }}
            rows={2}
            value={note}
          />
          <FieldError id="transaction-note-error">
            {fieldErrors.note}
          </FieldError>
        </div>

        <div className="flex justify-end">
          <PrimaryButton disabled={pending} type="submit">
            {pending ? "Registrando…" : "Registrar movimiento"}
          </PrimaryButton>
        </div>
      </form>
    </Card>
  );
}
