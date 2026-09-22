"use server";

import { db } from "@/db";
import { requireCurrentUser } from "@/server/auth/session";
import {
  type CreateBoxInput,
  createBox as createBoxInDb,
  getBox as getBoxInDb,
  listBoxes as listBoxesInDb,
  MAX_BOXES_PER_USER,
  renameBox as renameBoxInDb,
} from "@/server/boxes/service";
import {
  type ErrorCode,
  LimitReachedError,
  NotFoundError,
  PermissionError,
  UnauthorizedError,
  ValidationError,
} from "@/server/errors";

/**
 * Server action de creación de alcancías (capa delgada): resuelve la sesión
 * con `requireCurrentUser` y delega toda la lógica (validación, límite
 * atómico e insert) a `service.ts`. Devuelve resultados tipados y
 * serializables: los errores de dominio se convierten en
 * `{ ok: false, error: { code, ... } }`; los inesperados se propagan y Next
 * los redacta antes de llegar al cliente.
 */

/** Éxito de createBox: la alcancía tal como quedó en la DB. */
export type CreateBoxActionSuccess = {
  ok: true;
  box: {
    id: string;
    ownerId: string;
    name: string;
    currency: string;
    createdAt: number;
    updatedAt: number;
  };
};

/** Shape serializable de una box + balance (lo que consume la UI). */
export type ActionBoxWithBalance = CreateBoxActionSuccess["box"] & {
  balanceMinor: number;
};

/** Fallo tipado devuelto por la action: `code` estable para la UI. */
export type CreateBoxActionError =
  | { code: "validation"; fieldErrors: Record<string, string[]> }
  | {
      code: "limit_reached";
      maxBoxes: typeof MAX_BOXES_PER_USER;
    };

/** Unión de resultados de `createBoxAction`. */
export type CreateBoxActionResult =
  | CreateBoxActionSuccess
  | { ok: false; error: CreateBoxActionError };

/** Shape serializable de una box en las actions (igual en todos lados). */
type ActionBox = CreateBoxActionSuccess["box"];

/** Mapea la fila de DB al shape serializable de la action. */
function toActionBox(box: {
  id: string;
  ownerId: string;
  name: string;
  currency: string;
  createdAt: number;
  updatedAt: number;
}): ActionBox {
  return {
    id: box.id,
    ownerId: box.ownerId,
    name: box.name,
    currency: box.currency,
    createdAt: box.createdAt,
    updatedAt: box.updatedAt,
  };
}

/** Mapea la fila de DB + balance al shape serializable con `balanceMinor`. */
function toActionBoxWithBalance(box: ActionBox, balanceMinor: number) {
  return { ...toActionBox(box), balanceMinor };
}

/**
 * Crea una alcancía para el usuario con sesión activa. Devuelve
 * `{ ok: true, box }` o un error tipado: `validation` (con `fieldErrors`
 * por campo) o `limit_reached` (cupo de 5 agotado; la UI puede mostrar el
 * tope con `maxBoxes`).
 */
export async function createBoxAction(
  input: CreateBoxInput,
): Promise<CreateBoxActionResult> {
  const user = await requireCurrentUser();

  try {
    const box = await createBoxInDb(db, user.id, input);
    return {
      ok: true,
      box: {
        id: box.id,
        ownerId: box.ownerId,
        name: box.name,
        currency: box.currency,
        createdAt: box.createdAt,
        updatedAt: box.updatedAt,
      },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        ok: false,
        error: {
          code: "validation" satisfies ErrorCode,
          fieldErrors: error.fieldErrors,
        },
      };
    }
    if (error instanceof LimitReachedError) {
      return {
        ok: false,
        error: {
          code: "limit_reached" satisfies ErrorCode,
          maxBoxes: MAX_BOXES_PER_USER,
        },
      };
    }
    throw error; // errores inesperados: los redacta Next
  }
}

/** Éxito de listBoxes: propias y compartidas ya diferenciadas, con balance. */
export type ListBoxesActionSuccess = {
  ok: true;
  own: ActionBoxWithBalance[];
  shared: Array<{
    box: ActionBoxWithBalance;
    permissions: string[];
  }>;
};

/** Resultado de `listBoxesAction`. */
export type ListBoxesActionResult =
  | ListBoxesActionSuccess
  | { ok: false; error: { code: "unauthorized" } };

/**
 * Lista las alcancías del usuario con sesión activa (T043): propias y
 * compartidas, con los permisos efectivos de cada access. Sin sesión
 * devuelve `{ ok: false, error: { code: "unauthorized" } }` (no lanza: la
 * UI puede renderizar el estado de "logueate" con el resultado).
 */
export async function listBoxesAction(): Promise<ListBoxesActionResult> {
  let userId: string;
  try {
    const user = await requireCurrentUser();
    userId = user.id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: { code: "unauthorized" } };
    }
    throw error;
  }

  const { own, shared } = await listBoxesInDb(db, userId);
  return {
    ok: true,
    own: own.map((entry) =>
      toActionBoxWithBalance(entry.box, entry.balanceMinor),
    ),
    shared: shared.map((entry) => ({
      box: toActionBoxWithBalance(entry.box, entry.balanceMinor),
      permissions: entry.permissions,
    })),
  };
}

/** Éxito de getBox: la box (con balance) + acceso efectivo del caller. */
export type GetBoxActionSuccess = {
  ok: true;
  box: ActionBoxWithBalance;
  isOwner: boolean;
  permissions: string[];
};

/** Resultado de `getBoxAction`. */
export type GetBoxActionResult =
  | GetBoxActionSuccess
  | { ok: false; error: { code: "unauthorized" | "not_found" } };

/**
 * Devuelve una alcancía con el acceso efectivo del usuario con sesión
 * activa (T044). La box inexistente y la ajena (sin relación) comparten el
 * mismo `not_found`: nunca se revela la existencia a extraños.
 */
export async function getBoxAction(boxId: string): Promise<GetBoxActionResult> {
  let userId: string;
  try {
    const user = await requireCurrentUser();
    userId = user.id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: { code: "unauthorized" } };
    }
    throw error;
  }

  try {
    const { box, isOwner, permissions, balanceMinor } = await getBoxInDb(
      db,
      userId,
      boxId,
    );
    return {
      ok: true,
      box: toActionBoxWithBalance(box, balanceMinor),
      isOwner,
      permissions,
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { ok: false, error: { code: "not_found" satisfies ErrorCode } };
    }
    throw error;
  }
}

/** Éxito de renameBox: la alcancía ya renombrada. */
export type RenameBoxActionSuccess = {
  ok: true;
  box: CreateBoxActionSuccess["box"];
};

/** Resultado de `renameBoxAction`. */
export type RenameBoxActionResult =
  | RenameBoxActionSuccess
  | {
      ok: false;
      error:
        | { code: "unauthorized" }
        | { code: "validation"; fieldErrors: Record<string, string[]> }
        | { code: "not_found" }
        | { code: "forbidden" };
    };

/**
 * Renombra una alcancía (T045): solo el owner puede hacerlo (un guest con
 * cualquier permiso recibe `forbidden`), y la box inexistente o ajena sin
 * relación responde `not_found` (no se filtra la existencia a extraños).
 */
export async function renameBoxAction(
  boxId: string,
  newName: string,
): Promise<RenameBoxActionResult> {
  let userId: string;
  try {
    const user = await requireCurrentUser();
    userId = user.id;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return { ok: false, error: { code: "unauthorized" } };
    }
    throw error;
  }

  try {
    const box = await renameBoxInDb(db, userId, boxId, newName);
    return { ok: true, box: toActionBox(box) };
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        ok: false,
        error: {
          code: "validation" satisfies ErrorCode,
          fieldErrors: error.fieldErrors,
        },
      };
    }
    if (error instanceof NotFoundError) {
      return { ok: false, error: { code: "not_found" satisfies ErrorCode } };
    }
    if (error instanceof PermissionError) {
      return { ok: false, error: { code: "forbidden" satisfies ErrorCode } };
    }
    throw error;
  }
}
