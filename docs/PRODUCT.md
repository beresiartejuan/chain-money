# Chain Money — Definición de producto

## Resumen

**Chain Money** es una aplicación web para registrar las transacciones de dinero de una cuenta, organizadas en **alcancías** (savings boxes). Cada usuario puede crear hasta **5 alcancías**, y dentro de cada una registrar **depósitos y extracciones** que nunca se editan ni se borran.

La app tiene **backend + frontend** y está pensada para uso personal y para compartir alcancías con amigos o conocidos mediante **tokens de acceso**.

## Usuarios

Cada usuario se registra con:

| Campo | Notas |
|---|---|
| `email` | Identificador único de la cuenta. |
| `password` | Hash en base de datos, nunca en texto plano. |
| `name` | Nombre visible. |

### Recovery phrase

- No hay forma de enviar emails, por lo que la recuperación de cuenta no depende de correos.
- El usuario tiene una **frase de recuperación** que le permite recuperar el acceso si olvida su contraseña.
- La frase se guarda **encriptada** en la base de datos. Nunca en texto plano.

> Nota: no se usa Better Auth ni ninguna librería de auth de terceros; la autenticación se implementa a medida.

## Alcancías

- Cada usuario puede crear **hasta 5 alcancías** (límite duro).
- Cada alcancía tiene su propio **UUIDv7**.
- El usuario elige la **moneda** al crear la alcancía. La moneda queda fija para esa alcancía.
- Las transacciones viven dentro de la alcancía (relación por `savingsBoxId`).

## Transacciones

Cada transacción registra:

| Campo | Notas |
|---|---|
| Tipo | `deposit` (depósito) o `withdraw` (extracción). |
| Monto | Cantidad de dinero en la moneda de la alcancía. |
| Contraparte | Destinatario (si es extracción) u origen (si es depósito) del dinero. |
| Nota | Texto libre, **máximo 150 caracteres**. |
| Autor | Quién hizo la transacción (siempre). |
| Fecha y hora | Timestamp de cuándo se hizo (siempre). |

### Inmutabilidad (regla crítica)

- Las transacciones **NUNCA se pueden editar**.
- Las transacciones **NUNCA se pueden borrar**.
- No existen endpoints, acciones ni operaciones de edición/borrado.

## Reset de alcancía

- La operación de **reseteo** devuelve el balance de la alcancía a `0`.
- Se implementa como un **tipo especial de transacción** (`reset`), no como un borrado.
- El **historial nunca se borra**: el reset queda registrado como un evento más, con su autor y timestamp.

## Tokens de acceso (compartir alcancías)

Cada alcancía tiene **tokens de acceso** que permiten compartir el acceso con amigos o conocidos.

- **Un solo uso**: canjear el token lo consume. No expira por tiempo; solo se consume al canjearse, o cuando el dueño lo borra o lo expira manualmente.
- **Con permisos configurables**: el dueño elige los permisos de cada token al crearlo (por ejemplo: solo ver / ver + crear transacciones / con reset).
- **Gestión limitada**: el dueño de la alcancía solo puede **crear**, **borrar** o **expirar** tokens. No existe edición de tokens: para cambiar un token se crea uno nuevo.
- **Canje por usuarios registrados**: solo un usuario registrado puede canjear un token. Tras canjearlo, el usuario obtiene acceso a la alcancía según los permisos del token.
- **Toda transacción registra quién la hizo**: si A hace una transacción en la alcancía de B, queda registrado que fue A y no B.

### Decisión: expirar/borrar un token NO revoca el acceso ya canjeado

El token **controla el canje**, no el acceso ya otorgado. Decisión confirmada por el owner (T092):

- **Expirar un token ya canjeado** no tiene efecto: la operación rechaza con `token_already_redeemed` (el canje ya consumió el token).
- **Borrar (revocar) un token ya canjeado** también rechaza con `token_already_redeemed`: la FK `box_access.tokenId` es `NOT NULL` sin `ON DELETE` hacia `box_tokens`, así que borrar la fila dejaría el acceso huérfano y rompería la trazabilidad de quién otorgó el acceso.
- **Borrar o expirar un token activo** solo previene canjes **futuros**; el acceso otorgado por canjes anteriores **persiste**.
- Borrar un token **nunca borra filas de `box_access`**: el acceso y su autoría quedan preservados.
- La gestión del acceso de un invitado (revoke sobre `box_access`) queda como evolución futura del producto; hoy el guest conserva el acceso hasta que el owner decida lo contrario.

## Balance y sincronización

- El balance de una alcancía **no se almacena**: se **calcula** a partir de sus transacciones.
- La API permite pedir transacciones de forma **incremental**:
  - desde una **fecha** dada, o
  - desde un **ID de transacción** dado, para una alcancía dada.
- El cliente guarda en **caché local** el cálculo del balance y, al consultar la API, solo pide y procesa **lo que le falta** en lugar de descargar todo el historial.

## Invariantes de negocio (resumen)

1. Máximo **5 alcancías** por usuario.
2. Las transacciones son **inmutables**: sin edición, sin borrado.
3. El **reset** es un tipo especial de transacción; el historial permanece intacto.
4. La nota de una transacción tiene **máximo 150 caracteres**.
5. La **moneda es fija por alcancía** y la elige el usuario al crearla.
6. Toda transacción registra **autor + timestamp**.
7. El token de acceso es de **un solo uso**, con **permisos configurables** por el dueño, y solo se puede **crear, borrar o expirar**. Solo lo puede canjear un **usuario registrado**.
8. La **recovery phrase** va **encriptada** en la base de datos.
9. El balance se **calcula**, no se almacena.
10. Expirar o borrar un token **no revoca el acceso ya canjeado**: el token controla el canje, no el acceso otorgado (ver [decisión en Tokens de acceso](#decisión-expirarborrar-un-token-no-revoca-el-acceso-ya-canjeado)).

## Fuera de alcance (no goals)

- Envío de emails (verificación, notificaciones, reset por correo).
- Conversión o mezcla de monedas dentro de una alcancía.
- Edición o borrado de transacciones.
- Autenticación con terceros (OAuth, magic links).
- Librerías de auth como Better Auth.

## Preguntas abiertas

No hay preguntas abiertas. Las decisiones resueltas están integradas en las secciones anteriores.

<details>
<summary>Decisiones resueltas (historial)</summary>

1. **Identidad de quien canjea un token** → Resuelto: solo **usuarios registrados** pueden canjear tokens.
2. **Permisos del token** → Resuelto: **configurables por el dueño** al crear cada token.
3. **Expiración del token** → Resuelto: **solo por uso**; además, el dueño puede borrarlo o expirarlo manualmente.
4. **Token expirado/borrado vs. acceso ya canjeado** (T092) → Resuelto: **el acceso ya canjeado persiste**. El token controla el canje, no el acceso otorgado: expirar/borrar un token canjeado rechaza con `token_already_redeemed` (la FK `box_access.tokenId` es `NOT NULL` sin cascade, preservando la trazabilidad) y `box_access` nunca se borra al borrar un token. La gestión de acceso de invitados (revoke de `box_access`) queda a futuro.

</details>

## Glosario

| Término | Definición |
|---|---|
| **Alcancía** | Contenedor de transacciones con moneda propia, máximo 5 por usuario. |
| **Transacción** | Registro inmutable de un depósito o extracción con autor y timestamp. |
| **Reset** | Transacción especial que lleva el balance de la alcancía a 0. |
| **Token de acceso** | Credencial de un solo uso con permisos configurables, para compartir una alcancía; solo se crea, borra o expira, y lo canjea un usuario registrado. Controla el canje: borrarlo o expirarlo no revoca accesos ya otorgados. |
| **Recovery phrase** | Frase encriptada que permite recuperar una cuenta sin email. |
| **Contraparte** | Persona o entidad destino (extracción) u origen (depósito) del dinero. |