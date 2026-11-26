# Cocos Challenge — Backend

API de un broker de inversiones. Permite ver el portfolio de un usuario, buscar instrumentos, enviar órdenes de compra y venta (MARKET y LIMIT), cancelar las LIMIT pendientes y registrar depósitos y retiros.

**Stack:** NestJS sobre Express, TypeScript, PostgreSQL y Prisma.

## Cómo levantarlo

**Necesitás** Node.js 22.22.3, 24.15 o 26 o superior, y Docker para PostgreSQL. La imagen es `postgres:17`.

```bash
npm install
cp .env.example .env      # cocos / cocos, base cocos, puerto 5432
npm run db:up             # levanta PostgreSQL, migra y carga el seed si la base está vacía
npm run start:dev         # arranca la API en http://localhost:3000
```

`db:up` solo acepta un `DATABASE_URL` local (`localhost`, `127.0.0.1` o `::1`). Espera a que Postgres esté sano, aplica las migraciones y, si todavía no hay usuarios, carga la fixture. Si la base ya tiene datos, no la vuelve a sembrar. No corre contra una base remota y no usa `prisma db push`.

La API escucha en `http://localhost:3000` salvo que `PORT` diga otra cosa. Las próximas veces alcanza con `npm run db:up` (si la base no está corriendo) y `npm run start:dev`.

Con el seed cargado, este pedido devuelve el portfolio de Emiliano (cuenta `10001`), con $783.800 de efectivo asentado, $125.500 reservados y un valor total de $890.500.

```bash
curl http://localhost:3000/portfolio \
  -H "X-User-Id: a1000000-0000-4000-8000-000000000001"
```

## Cómo probarlo

- **ReDoc:** http://localhost:3000/docs. La documentación y su JavaScript se sirven desde la aplicación. No hace falta Internet para abrirla.
- **OpenAPI:** http://localhost:3000/openapi.json.
- **Postman:** importá `postman/cocos-api.postman_collection.json` y el environment `postman/cocos-local.postman_environment.json`. Seleccioná **Cocos local**.

El environment trae a Emiliano y a GGAL:

| Variable | Valor |
|---|---|
| `userId` | `a1000000-0000-4000-8000-000000000001` |
| `instrumentId` | `a3000000-0000-4000-8000-000000000022` (GGAL) |
| `baseUrl` | `http://localhost:3000` |

La búsqueda guarda el primer `id` en `instrumentId`. Crear una orden guarda su `id` en `orderId`. Cada escritura genera una `Idempotency-Key` nueva.

Recorrido sugerido, con la API y el seed levantados:

1. `Search instruments` con `q=ggal`.
2. `Read a portfolio` con Emiliano.
3. `MARKET BUY by quantity`.
4. `LIMIT BUY by amount`.
5. `Cancel a new limit order` con el `orderId` que guardó la orden límite.
6. `Deposit` y `Withdrawal`. El servidor elige el instrumento ARS.

| Endpoint | Qué hace |
|---|---|
| `GET /instruments?q=texto` | Busca instrumentos por ticker o nombre. Excluye las monedas (`MONEDA`). |
| `GET /portfolio` | Efectivo asentado, reservado y disponible, valor total y posiciones de la cuenta de `X-User-Id`. |
| `POST /orders` | Envía una orden MARKET o LIMIT, por cantidad (`quantity`) o por monto (`amount`). |
| `POST /orders/:orderId/cancel` | Cancela una LIMIT en estado `NEW` y libera lo que tenía reservado. |
| `POST /cash-movements` | Registra un depósito (`CASH_IN`) o un retiro (`CASH_OUT`) contra ARS. |

Por ejemplo, para comprar 2 acciones de GGAL al precio de mercado:

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -H "X-User-Id: a1000000-0000-4000-8000-000000000001" \
  -H "Idempotency-Key: compra-ggal-1" \
  -d '{
    "instrumentId": "a3000000-0000-4000-8000-000000000022",
    "side": "BUY",
    "type": "MARKET",
    "quantity": "2"
  }'
```

Para tener en cuenta:

- **No hay autenticación.** Quien llama se indica con el header `X-User-Id`, un UUID. Las escrituras además exigen `Idempotency-Key`, una clave opaca de hasta 255 caracteres. No tiene que ser un UUID.
- **El `id` de la orden lo genera el servidor** (UUID v4). La misma clave y el mismo pedido devuelven el resultado guardado y no lo ejecutan de nuevo. La misma clave con otro pedido responde `409`.
- **Una orden sin efectivo o sin acciones suficientes se guarda igual.** Queda `REJECTED`, con el motivo, y el endpoint responde `201`.
- **Las MARKET se ejecutan al último cierre** y quedan `FILLED`. Las LIMIT aceptadas quedan `NEW` y reservan efectivo (compra) o acciones (venta). No hay matching ni ejecución de LIMIT.
- **Los montos y las cantidades viajan como texto** (`"1000.00"`, `"2"`). La API no acepta números JSON para esos campos.
- **Los errores** tienen la forma `{ "message": "..." }`.

Para correr la suite automatizada, con la base local levantada y migrada: `npm test`. El detalle está en [Pruebas](#pruebas).

---

- [Campos](#campos)
- [Arquitectura](#arquitectura)
- [Estructura de carpetas](#estructura-de-carpetas)
- [Pruebas](#pruebas)
- [Comandos](#comandos)
- [Si algo no funciona](#si-algo-no-funciona)
- [Documentación del diseño](#documentación-del-diseño)
- [Fuera de alcance](#fuera-de-alcance)

---

## Campos

Los montos van como texto decimal. Una cantidad de acciones es un entero en texto. Un campo en `null` significa que no hay datos para calcularlo (por ejemplo, un instrumento sin cotización).

### `GET /instruments`

**Request**

| Parámetro | Dónde | Qué es |
|---|---|---|
| `q` | query | Fragmento de ticker o de nombre. Se recorta y se pasa a minúsculas. Obligatorio, de 1 a 64 caracteres. |
| `limit` | query | Máximo de resultados, de 1 a 50. Opcional; por defecto, 20. |

**Response `200`:** un array. Cada elemento:

| Campo | Qué es |
|---|---|
| `id` | UUID del instrumento. |
| `ticker` | Ticker. |
| `name` | Nombre. |
| `type` | Tipo guardado en la base, por ejemplo `ACCIONES`. |

El ticker exacto queda primero. Después se ordena por ticker y por `id`. Una búsqueda sin coincidencias devuelve `[]`. Las monedas no aparecen. Un `q` vacío, un `limit` fuera de rango o un query param desconocido responden `400`. Este endpoint no usa `X-User-Id`.

### `GET /portfolio`

**Request**

| Parámetro | Dónde | Qué es |
|---|---|---|
| `X-User-Id` | header | UUID del usuario dueño de la cuenta. Obligatorio. |

**Response `200`**

| Campo | Qué es |
|---|---|
| `accountId` | Cuenta del usuario. |
| `settledCash` | Efectivo asentado por órdenes ejecutadas y por movimientos de efectivo. |
| `reservedCash` | Efectivo reservado por compras LIMIT que siguen en `NEW`. |
| `availableCash` | `settledCash − reservedCash`. Puede ser negativo si las reservas superan el efectivo asentado. |
| `totalValue` | Efectivo asentado más el valor de mercado de las cantidades asentadas. Las reservas no se restan. `null` si alguna posición no tiene cotización. |
| `positions[].instrumentId`, `ticker`, `name` | El instrumento. |
| `positions[].quantity` | Cantidad asentada. Puede ser negativa. |
| `positions[].reservedQuantity` | Acciones reservadas por ventas LIMIT en `NEW`. |
| `positions[].availableQuantity` | Cantidad asentada menos la reservada, nunca por debajo de cero. |
| `positions[].close` | Último cierre. `null` si no hay cotización. |
| `positions[].marketValue` | `quantity × close`. `null` si no hay cotización. |
| `positions[].dailyReturnPercentage` | Variación del último cierre contra el anterior, con cuatro decimales. `null` si falta la cotización o el cierre anterior es cero. |

Los movimientos de efectivo no se devuelven como posiciones. Un usuario sin cuenta responde `404` con `{ "message": "Portfolio account was not found." }`.

Con el seed, Emiliano (`a1000000-0000-4000-8000-000000000001`, cuenta `a2000000-0000-4000-8000-000000000001`) tiene `settledCash` `783800`, `reservedCash` `125500`, `availableCash` `658300` y `totalValue` `890500`. José, Francisco y Juan arrancan con el portfolio vacío.

### `POST /orders`

**Request**

| Campo | Dónde | Qué es |
|---|---|---|
| `X-User-Id` | header | UUID del usuario que opera. |
| `Idempotency-Key` | header | Clave opaca, hasta 255 caracteres. |
| `instrumentId` | body | Instrumento. Un instrumento de tipo `MONEDA` se rechaza. |
| `side` | body | `BUY` o `SELL`. |
| `type` | body | `MARKET` o `LIMIT`. |
| `quantity` | body | Cantidad entera de acciones, como texto. Se manda `quantity` o `amount`, no los dos. |
| `amount` | body | Monto, como texto decimal. El tamaño de la orden es la división entera de `amount` por el precio. El resto no se reserva. |
| `limitPrice` | body | Precio límite, como texto decimal. Obligatorio en LIMIT y prohibido en MARKET. |

**Response `201`:** [una orden](#una-orden). También es `201` cuando la orden queda `REJECTED` y cuando se reenvía la misma clave con el mismo pedido.

`400` si el body o los headers son inválidos, si faltan o sobran `quantity` y `amount`, o si el monto no alcanza para una acción. `404` si el usuario no tiene cuenta. `409` si la clave se reutiliza con otro pedido. `422` si el instrumento no existe, es una moneda, o una MARKET no tiene último cierre.

### `POST /orders/:orderId/cancel`

**Request**

| Parámetro | Dónde | Qué es |
|---|---|---|
| `orderId` | ruta | UUID de la orden. Tiene que ser LIMIT y estar en `NEW`. |
| `X-User-Id` | header | Dueño de la cuenta. |
| `Idempotency-Key` | header | Clave de esta cancelación. |

**Response `200`:** la orden, ahora `CANCELLED`, con `id`, `accountId`, `instrumentId`, `side`, `type` (`LIMIT`), `status`, `size`, `price` y `placedAt`. Cancelar libera exactamente esa reserva.

Si la orden no existe para esa cuenta, `404`. Si ya no está en `NEW`, `409` y la reserva no se libera de nuevo. Repetir la misma clave devuelve la cancelación guardada.

### `POST /cash-movements`

**Request**

| Campo | Dónde | Qué es |
|---|---|---|
| `X-User-Id` | header | UUID del usuario. |
| `Idempotency-Key` | header | Clave opaca, hasta 255 caracteres. |
| `side` | body | `CASH_IN` o `CASH_OUT`. |
| `amount` | body | Monto positivo, como texto decimal. |

El cliente no envía instrumento, precio ni tipo de orden. El servidor usa el instrumento ARS.

**Response `201`**

| Campo | Qué es |
|---|---|
| `id`, `accountId` | El movimiento y la cuenta. |
| `instrumentId` | El instrumento ARS elegido por el servidor. |
| `side` | `CASH_IN` o `CASH_OUT`. |
| `status` | `FILLED` o `REJECTED`. |
| `amount` | El monto enviado. |
| `rejectionReason` | `INSUFFICIENT_CASH` si el retiro no entra en el efectivo disponible. Si no, `null`. |
| `placedAt` | Fecha de alta. |

Un depósito queda `FILLED` y suma efectivo asentado. Un retiro queda `FILLED` si entra en el disponible, o `REJECTED` si no. El efectivo reservado no se puede retirar. El retiro rechazado se guarda y la respuesta sigue siendo `201`.

### Una orden

Es lo que devuelve `POST /orders`.

| Campo | Qué es |
|---|---|
| `id` | UUID generado por el servidor. |
| `accountId`, `instrumentId` | Cuenta e instrumento. |
| `side`, `type` | Igual que en el pedido. |
| `size` | Cantidad de acciones. Si se mandó `amount`, es el piso de `amount / precio`. |
| `price` | Último cierre en las MARKET. Precio límite en las LIMIT. |
| `status` | `FILLED`, `NEW` o `REJECTED`. |
| `rejectionReason` | `INSUFFICIENT_CASH` o `INSUFFICIENT_SHARES`. `null` si no se rechazó. |
| `placedAt` | Fecha de alta. |

## Arquitectura

- **Monolito modular.** Una sola aplicación NestJS. Los módulos de negocio son tres, más la infraestructura compartida:

  | Módulo | Qué hace |
  |---|---|
  | `orders` | Órdenes, cancelación, movimientos de efectivo y la cuenta que bloquean |
  | `instruments` | Búsqueda de instrumentos y última cotización |
  | `portfolio` | Valuación de la cuenta |
  | `shared` | Dinero, UUID, transacciones, idempotencia y el cliente de Prisma |

- **Capas.** Cada módulo separa dominio, aplicación, infraestructura y presentación. El dominio no importa NestJS ni Prisma. `orders` y `portfolio` hablan con instrumentos a través del puerto `InstrumentQueries`.
- **La cuenta no guarda saldos.** El efectivo, las tenencias y las reservas salen de las órdenes y de los movimientos de efectivo. `orders` es la fuente de verdad.
- **Sin carreras.** Cada escritura corre dentro de `UnitOfWork` con aislamiento `ReadCommitted`. Antes de operar se bloquea la única cuenta del usuario con `SELECT … FOR UPDATE`. Una transacción anidada se rechaza.
- **Dinero exacto.** Los importes se modelan con el value object `Money` y se persisten como `NUMERIC(38, 18)`. No se usa `number` de JavaScript para precios ni cantidades.
- **Idempotencia.** La clave única es `(user_id, idempotency_key)`. El resultado queda guardado y un reintento con el mismo pedido lo devuelve.

## Estructura de carpetas

```
src/
  main.ts               arranque de la API
  app.module.ts
  docs/                 OpenAPI, ReDoc y la colección de Postman
  seed/                 fixture de desarrollo
  shared/               dinero, UUID, Prisma, transacciones e idempotencia
  instruments/          búsqueda y cotizaciones
  orders/               órdenes, cuenta y movimientos de efectivo
  portfolio/            valuación
prisma/                 schema, migraciones y el upgrade de la base legacy
test/
  unit/                 lógica sin base
  integration/          PostgreSQL local
  functional/           HTTP con casos de uso simulados
docs/architecture.md
postman/                colección y environment
```

Un módulo de negocio tiene esta forma. Solo se crean las carpetas que tienen tipos propios. `instruments` no tiene entidades: valida el término y consulta.

```
orders/
  domain/               entidades, value objects, servicios y errores
  application/
    ports/              lo que el caso de uso necesita
    use-cases/          enviar, cancelar, depositar y retirar
  infrastructure/prisma/  repositorios y el bloqueo de la cuenta
  presentation/         controllers y DTOs
  orders.module.ts
```

## Pruebas

Hay tres suites. Hoy suman 257 pruebas: 215 unitarias, 31 de integración y 11 funcionales.

**Unitarias — `npm run test:unit`.** Corren sin base y sin servidor. Están en `test/unit` y cubren dinero, estados de una orden, la decisión de aceptar o rechazar, la valuación del portfolio, la búsqueda y los casos de uso con adaptadores en memoria.

**Integración — `npm run test:integration`.** Usan PostgreSQL de verdad, el de `DATABASE_URL`. Si la variable no está o el host no es local, la suite se saltea. Corren en serie. Cubren el seed de Emiliano, reservas, movimientos de efectivo, el bloqueo de la cuenta y la API HTTP contra la base. No usan una base aparte: operan sobre `cocos`.

**Funcionales — `npm run test:functional`.** Levantan Nest y reemplazan los casos de uso. Comprueban status, headers y el cuerpo de la respuesta, y que ReDoc y OpenAPI respondan.

`npm test` corre las tres, en ese orden.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run start:dev` | Arranca la API en modo desarrollo, con recarga. |
| `npm run build` | Genera el cliente de Prisma y compila a `dist`. |
| `npm run start:prod` | Corre `node dist/main.js`. Hay que haber compilado antes. |
| `npm run db:up` / `db:down` | Levanta Postgres, aplica las migraciones y siembra la base si está vacía. `db:down` la apaga y conserva el volumen. |
| `npm run db:migrate` | Aplica las migraciones con `prisma migrate deploy`. `db:up` ya lo hace. |
| `npm run db:migrate:status` | Muestra el estado de esas migraciones. |
| `npm run db:seed` | Compila y vuelve a cargar la fixture local. Hace falta `SEED_DEV=1`, que el script ya define. |
| `npm test` | Unitarias, integración y funcionales. |
| `npm run test:unit` | Solo unitarias. |
| `npm run test:integration` | Solo integración, contra la base local. |
| `npm run test:functional` | Solo HTTP con casos de uso simulados. |
| `npm run lint` / `npm run typecheck` | Estilo y tipos. |
| `npm run docs:generate` | Regenera `openapi/openapi.json` y los archivos de Postman. |
| `npm run db:legacy:rehearse` | Ensaya el upgrade del esquema original en `cocos_legacy_test`. No toca la base `cocos`. |

Para borrar los datos de Docker y empezar de cero: `docker compose down -v` y después `npm run db:up`.

El upgrade de una base remota que todavía tiene el esquema original es otro procedimiento. Está en `prisma/legacy-upgrade/README.md`. No se corre contra la base local.

## Si algo no funciona

| Qué ves | Qué hacer |
|---|---|
| `address already in use` en el puerto 5432 | Otro PostgreSQL ya usa ese puerto. Cambiá `POSTGRES_PORT` en el `.env` y el puerto de `DATABASE_URL`. |
| `ECONNREFUSED` al arrancar | La base no está corriendo o el `.env` apunta a otro host. Corré `npm run db:up` y revisá `DATABASE_URL`. |
| `db:up` se niega a correr | `DATABASE_URL` no es local. Copiá `.env.example` a `.env`. El comando no migra ni siembra una base remota. |
| El portfolio de Emiliano no coincide con el seed | La integración y las órdenes de prueba escriben en la misma base. Recreala con `docker compose down -v` y `npm run db:up`. |
| `404` en el portfolio | `X-User-Id` no es el UUID de un usuario sembrado. Emiliano es `a1000000-0000-4000-8000-000000000001`. |

## Documentación del diseño

Las convenciones, el modelo de datos y la estrategia de transacciones están en `docs/architecture.md`. Ese documento se escribió al armar el proyecto. Lo que la API hace hoy es lo que describe este README: órdenes, portfolio, búsqueda y movimientos de efectivo ya están implementados.

El camino para transformar una base que todavía tiene el esquema original del challenge está en `prisma/legacy-upgrade/README.md`.

## Fuera de alcance

- **Autenticación.** El llamador se identifica con `X-User-Id`.
- **Ejecución automática de las LIMIT.** Quedan en `NEW` hasta que se cancelan.
- **Listado de órdenes.** No hay `GET /orders`.
- **Alta de usuarios o de cuentas.** El seed crea cada usuario con su cuenta. Enviar una orden no inserta ninguna de las dos.
