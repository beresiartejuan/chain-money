import { describe, expect, it } from "vitest";
import {
  applyTransactions,
  type BalanceState,
  balanceFromTransactions,
  emptyBalanceState,
} from "@/lib/client/balance-cache";
import { parseCursor } from "@/lib/cursor";
import { tx } from "./helpers";

describe("emptyBalanceState", () => {
  it("returns the zeroed initial state", () => {
    expect(emptyBalanceState()).toEqual({
      cursor: null,
      balanceMinor: 0,
      transactionCount: 0,
      updatedAt: 0,
    });
  });
});

describe("applyTransactions — basic sequence", () => {
  it("applies deposit + withdraw and tracks cursor, count and updatedAt", () => {
    const deposit = tx("a", "deposit", 1000, 1000);
    const withdraw = tx("b", "withdraw", 400, 2000);

    const state = applyTransactions(emptyBalanceState(), [
      withdraw,
      deposit, // desorden a propósito: el módulo no debe asumir orden
    ]);

    expect(state.balanceMinor).toBe(600);
    expect(state.transactionCount).toBe(2);
    expect(state.updatedAt).toBe(2000);
    expect(parseCursor(state.cursor ?? "")).toEqual({
      createdAtMs: 2000,
      id: "b",
    });
  });

  it("does not mutate the input state", () => {
    const before = emptyBalanceState();
    applyTransactions(before, [tx("a", "deposit", 500, 1000)]);

    expect(before).toEqual({
      cursor: null,
      balanceMinor: 0,
      transactionCount: 0,
      updatedAt: 0,
    });
  });

  it("allows negative balances from over-withdrawing", () => {
    const state = applyTransactions(emptyBalanceState(), [
      tx("a", "withdraw", 300, 1000),
    ]);

    expect(state.balanceMinor).toBe(-300);
  });
});

describe("balanceFromTransactions", () => {
  it("reduces a delta to the total balance from scratch", () => {
    const total = balanceFromTransactions([
      tx("a", "deposit", 1000, 1000),
      tx("b", "withdraw", 400, 2000),
      tx("c", "deposit", 50, 3000),
    ]);

    expect(total).toBe(650);
  });

  it("honors reset as the final normalizer", () => {
    const total = balanceFromTransactions([
      tx("a", "deposit", 1000, 1000),
      tx("b", "reset", 0, 2000),
    ]);

    expect(total).toBe(0);
  });
});

describe("T066 — reset handling", () => {
  it("reset as the only tx of the delta zeroes the balance", () => {
    const state = applyTransactions(emptyBalanceState(), [
      tx("r1", "reset", 0, 5000),
    ]);

    expect(state.balanceMinor).toBe(0);
    expect(state.transactionCount).toBe(1);
    expect(parseCursor(state.cursor ?? "")).toEqual({
      createdAtMs: 5000,
      id: "r1",
    });
  });

  it("reset zeroes the balance even with a negative cached balance", () => {
    // Se construye manualmente un estado "corrupto"/incompleto con balance
    // negativo, como puede pasar con una caché parcial.
    const corrupted: BalanceState = {
      cursor: null,
      balanceMinor: -2500,
      transactionCount: 3,
      updatedAt: 1000,
    };

    const state = applyTransactions(corrupted, [tx("r1", "reset", 0, 5000)]);

    expect(state.balanceMinor).toBe(0);
    // Los contadores persisten y crecen; el reset no borra el historial.
    expect(state.transactionCount).toBe(4);
    expect(state.updatedAt).toBe(5000);
  });

  it("reset after deposits and withdrawals leaves the balance at 0", () => {
    const withBalance = applyTransactions(emptyBalanceState(), [
      tx("a", "deposit", 1000, 1000),
      tx("b", "withdraw", 1500, 2000), // balance -500
    ]);

    const state = applyTransactions(withBalance, [tx("c", "reset", 0, 3000)]);

    expect(state.balanceMinor).toBe(0);
    expect(state.transactionCount).toBe(3);
    expect(state.updatedAt).toBe(3000);
  });
});

describe("T066 — empty deltas", () => {
  it("returns the exact same reference for an empty delta", () => {
    const state = applyTransactions(emptyBalanceState(), [
      tx("a", "deposit", 100, 1000),
    ]);
    const after = applyTransactions(state, []);

    expect(after).toBe(state); // identidad referencial, no solo deep equal
  });

  it("keeps cursor, count and updatedAt intact across an empty delta", () => {
    const state = applyTransactions(emptyBalanceState(), [
      tx("a", "deposit", 100, 1000),
      tx("b", "withdraw", 30, 2000),
    ]);
    const after = applyTransactions(state, []);

    expect(after.cursor).toBe(state.cursor);
    expect(after.transactionCount).toBe(state.transactionCount);
    expect(after.updatedAt).toBe(state.updatedAt);
    expect(after.balanceMinor).toBe(state.balanceMinor);
  });

  it("returns the empty state itself when nothing has been applied yet", () => {
    const empty = emptyBalanceState();
    expect(applyTransactions(empty, [])).toBe(empty);
  });
});

describe("T066 — cursor and count persistence across applies", () => {
  it("chains cursor and accumulates count across sequential deltas", () => {
    let state = emptyBalanceState();

    state = applyTransactions(state, [tx("a", "deposit", 100, 1000)]);
    const firstCursor = state.cursor;
    expect(parseCursor(firstCursor ?? "")).toEqual({
      createdAtMs: 1000,
      id: "a",
    });
    expect(state.transactionCount).toBe(1);

    state = applyTransactions(state, [tx("b", "withdraw", 40, 2000)]);
    expect(parseCursor(state.cursor ?? "")).toEqual({
      createdAtMs: 2000,
      id: "b",
    });
    expect(state.transactionCount).toBe(2);

    state = applyTransactions(state, [tx("c", "reset", 0, 3000)]);
    expect(parseCursor(state.cursor ?? "")).toEqual({
      createdAtMs: 3000,
      id: "c",
    });
    expect(state.transactionCount).toBe(3);
    expect(state.balanceMinor).toBe(0);

    // El cursor anterior no se reutiliza: siempre queda el de la última tx.
    expect(state.cursor).not.toBe(firstCursor);
  });
});

describe("order and tie-breaking invariants", () => {
  it("final balance is independent of application order (commutative total)", () => {
    const txs = [
      tx("a", "deposit", 1000, 1000),
      tx("b", "withdraw", 400, 2000),
      tx("c", "deposit", 250, 3000),
      tx("d", "withdraw", 100, 4000),
    ];

    const forward = applyTransactions(emptyBalanceState(), txs);
    const reversed = applyTransactions(emptyBalanceState(), [...txs].reverse());

    expect(reversed.balanceMinor).toBe(forward.balanceMinor);
    expect(forward.balanceMinor).toBe(750);
    // El cursor sí depende del orden de tupla, no del orden del array.
    expect(parseCursor(reversed.cursor ?? "")).toEqual(
      parseCursor(forward.cursor ?? ""),
    );
  });

  it("breaks ties by id so the cursor is the greater tuple", () => {
    // Misma createdAt: gana el id mayor lexicográficamente, aunque llegue
    // primero en el array.
    const state = applyTransactions(emptyBalanceState(), [
      tx("z", "deposit", 100, 1000),
      tx("a", "deposit", 100, 1000),
    ]);

    expect(parseCursor(state.cursor ?? "")).toEqual({
      createdAtMs: 1000,
      id: "z",
    });
  });
});
