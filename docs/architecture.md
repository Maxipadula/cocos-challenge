# Arquitectura

Documento de la inicialización. Describe lo que el código hace hoy y separa las decisiones que siguen pendientes.

## Arquitectura elegida

Monolito modular con NestJS 12, TypeScript en modo strict y módulos ESM. PostgreSQL se accede con Prisma ORM 7.

Los módulos de negocio son `orders`, `portfolio` e `instruments`. `shared` concentra la infraestructura que esos módulos van a compartir. Cada módulo reserva las capas `domain`, `application`, `infrastructure` y `presentation`.

```text
src/
  main.ts
  app.module.ts
  shared/
    application/unit-of-work.ts
    infrastructure/prisma/
    presentation/
    shared.module.ts
  orders/
  portfolio/
  instruments/
prisma/schema.prisma
prisma.config.ts
test/unit
test/integration
test/functional
```

`orders` será la fuente de verdad financiera. Esa regla está acordada y todavía no hay modelo ni cálculos implementados.

## Responsabilidad de los módulos

| Módulo        | Estado            | Responsabilidad prevista                                                                |
| ------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `shared`      | Activo            | Cliente de Prisma, transacción interactiva y el cliente que deben usar los repositorios |
| `orders`      | Registrado, vacío | Órdenes, cancelación y movimientos de efectivo                                          |
| `portfolio`   | Registrado, vacío | Valorización de la cuenta                                                               |
| `instruments` | Registrado, vacío | Búsqueda de instrumentos y lectura de market data                                       |

Los módulos vacíos existen para fijar la frontera. No tienen entidades, repositorios ni endpoints.

## Reglas de dependencia

Convención del proyecto. Todavía no hay una regla de ESLint que la imponga.

- `domain` solo podrá depender de otros tipos de dominio.
- `application` depende del dominio y define los puertos. `UnitOfWork` no importa NestJS ni Prisma.
- `infrastructure` implementa los puertos e importa Prisma.
- `presentation` llamará a los casos de uso. Hoy no hay controllers.
- Un módulo de negocio no importa el dominio de otro módulo.

`AppModule` importa `SharedModule`, `OrdersModule`, `PortfolioModule` e `InstrumentsModule`.

## Puertos y adaptadores

| Puerto       | Ubicación                                | Adaptador          |
| ------------ | ---------------------------------------- | ------------------ |
| `UnitOfWork` | `src/shared/application/unit-of-work.ts` | `PrismaUnitOfWork` |

`PrismaModule` registra `PrismaUnitOfWork` bajo el token `UnitOfWork`. Los casos de uso futuros inyectan `UnitOfWork`, no la clase de Prisma.

`PrismaService` abre la conexión y las transacciones. Permanece como proveedor interno de `PrismaModule` y no se exporta. Los repositorios no lo inyectan.

`PrismaClientProvider` es el acceso de los repositorios al cliente:

- `getClient()` sirve para consultas que pueden ejecutarse fuera de una transacción. Si hay una transacción activa, devuelve ese cliente. Si no hay, devuelve `PrismaService`.
- `getTransactionClient()` sirve para escrituras y para `SELECT … FOR UPDATE`. Devuelve solo el cliente transaccional. Si no hay una transacción activa, lanza `ActiveTransactionRequiredError` y no cae al cliente raíz.
- Toda operación que modifica información usa `getTransactionClient()` dentro de `UnitOfWork.run`.

## Estrategia de transacciones

`UnitOfWork.run` abre una transacción interactiva de Prisma:

1. Si ya hay una transacción activa en el contexto asíncrono, lanza `NestedTransactionError` y no abre otra.
2. Ejecuta el callback dentro de `AsyncLocalStorage`, con el cliente transaccional publicado para los adaptadores.
3. Usa aislamiento `ReadCommitted`.
4. Si el callback resuelve, Prisma confirma. Si lanza, Prisma revierte y el contexto queda limpio.

El cliente transaccional expone `$queryRaw` y `$executeRaw`. Esas consultas parametrizadas son el mecanismo previsto para el `SELECT id FROM accounts WHERE user_id = $1 FOR UPDATE`. El adaptador de ese bloqueo todavía no existe.

La transacción no envuelve el arranque de la aplicación. `PrismaService` conecta en `onModuleInit` y cierra en `onModuleDestroy`.

## Convenciones de código

- Archivos en kebab-case. Las clases de Nest conservan el sufijo de rol: `prisma.service.ts`, `orders.module.ts`.
- Los imports ESM conservan la extensión `.js`. Entre módulos se usa `package.json#imports`:
  - `#shared/*` apunta a `src/shared/*`.
  - `#orders/*` apunta a `src/orders/*`.
  - `#instruments/*` apunta a `src/instruments/*`.
  - `#portfolio/*` apunta a `src/portfolio/*`.
    Dentro de un módulo el import sigue siendo relativo. `main.ts` importa `./app.module.js` y el cliente generado de Prisma también se importa en relativo: no hay alias para ellos. Un alias no autoriza a entrar al dominio interno de otro módulo.
    TypeScript y Vitest usan la condición `cocos-source`, que resuelve el alias al `.ts` de `src`. Los tests no dependen de `dist`. Node, al correr el JavaScript compilado, usa el target `default` y carga `dist`.
    ESLint ordena los imports en cinco grupos, separados por una línea en blanco y en orden alfabético dentro de cada uno: módulos nativos de Node, dependencias externas, `#shared`, luego `#instruments`, `#orders` y `#portfolio`, y al final los imports relativos. Los imports del mismo archivo se combinan. Si todo lo importado son tipos, se escribe `import type`.
- TypeScript `strict`. `strictPropertyInitialization` queda desactivado, igual que el preset strict de Nest, porque la inyección por decoradores no siempre es visible para ese chequeo.
- Sin `any`. ESLint lo marca como error, junto con promesas flotantes.
- Prettier: comillas simples, punto y coma, trailing comma, ancho 80, fin de línea LF.
- El cliente generado de Prisma queda en `src/generated` y no se versiona. `prisma generate` corre antes del build, de los tests y del typecheck.
- Los mensajes de error del código están en inglés. Este documento está en español.
- El dominio no deja archivos sueltos en `domain/`. Cada módulo usa solo las carpetas que tengan tipos con responsabilidad propia:
  - `domain/entities/`
  - `domain/value-objects/`
  - `domain/errors/`
  - `domain/services/`, para comportamiento que no cabe en una entidad ni en un value object.
- `shared/domain` contiene exclusivamente conceptos de un Shared Kernel explícitamente acordado. La reutilización de código no es motivo suficiente para compartir value objects entre bounded contexts. Hoy el kernel es `Money` y `Uuid`. Los identificadores de un contexto se construyen sobre `Uuid` dentro de ese contexto. Un error de un value object compartido vive en `shared/domain/errors/`. El error de un módulo permanece en su `domain/errors/`.
- No se crean carpetas ni clases vacías para completar esa estructura. La convención vale para todos los módulos.
- Los identificadores generados por el sistema son UUID v4 en `string` marcado. El dominio valida el formato y lo guarda en minúsculas. PostgreSQL usa el tipo `UUID` para esas primary y foreign keys, no secuencias numéricas. `UuidGenerator`, en `shared/application`, es el puerto de generación. Su adaptador usa `crypto.randomUUID()`. La `Idempotency-Key` la envía el cliente y sigue siendo un identificador opaco: no se exige que sea un UUID.
- `User` es la persona. `Account` es su cuenta de inversión. La relación inicial es uno a uno: `accounts.user_id` será único. No hay entidad de dominio `Account`; el dominio de órdenes solo necesita `AccountId`. `UserId` vive en la aplicación, porque identifica a quien llama y no al dueño financiero de una orden.
- Toda orden y todo movimiento de efectivo pertenecen a una cuenta. El portfolio futuro se calcula por `AccountId`. La cuenta no persiste efectivo, posiciones, reservas ni balances: eso sigue saliendo de las órdenes.
- `AccountLock.acquireForUser` resuelve y bloquea esa única cuenta dentro de `UnitOfWork`. Si no hay fila, lanza `AccountNotFoundError` y no crea la cuenta. El alta y la cancelación siguen recibiendo `userId`. La idempotencia permanece en `(userId, idempotencyKey)`.
- Los datos iniciales y las pruebas de integración crean cada usuario junto con su cuenta, en la misma operación. No hay módulo de usuarios ni endpoint de alta de cuentas. El envío de una orden no inserta ninguna de las dos filas.
- `Money` admite como máximo 18 decimales y 20 dígitos enteros significativos. Los ceros a la izquierda no cuentan. `ShareQuantity` admite hasta `10^20 - 1`. Esos topes coinciden con `NUMERIC(38, 18)`: 18 dígitos fraccionarios y 20 enteros. Las sumas, restas y productos pueden superarlos porque no se persisten. Las factories de `TradeOrder` y `CashMovement` rechazan un tamaño o un importe que ya no entra en esa columna.

Tests con Vitest, que es el runner del scaffold ESM de Nest 12:

- `npm run test:unit` corre `test/unit`.
- `npm run test:integration` corre `test/integration`. Si `DATABASE_URL` no está definida, la prueba de PostgreSQL queda salteada.
- `npm run test:functional` levanta la aplicación Nest con `PrismaService` reemplazado y comprueba que `UnitOfWork` está registrado.

## Versiones

Comprobado contra Node.js 26.13.0:

| Pieza                         | Versión                     | Motivo                                                                                 |
| ----------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| NestJS                        | 12.6.2                      | Estable. La aplicación corre en Node 20.19 o superior; el CLI pide 22.22.3, 24.15 o 26 |
| Prisma ORM y `@prisma/client` | 7.10.1                      | Estable. Su rango de Node incluye `>=24`, así que cubre Node 26                        |
| Prisma ORM 8                  | No usado                    | Sigue en release candidate                                                             |
| TypeScript                    | 6.0.3                       | Nest 12 declara TypeScript 6. `typescript-eslint` 8 admite hasta 6.0                   |
| Driver                        | `@prisma/adapter-pg` 7.10.1 | Prisma 7 exige un driver adapter. El paquete trae `pg`                                 |
| Vitest                        | 4.1.12                      | Runner de tests del scaffold ESM de Nest 12. Vitest 5 no forma parte de ese scaffold   |
| ESLint                        | 10.15.0                     | ESLint 9 quedó fuera de soporte. `typescript-eslint` 8 acepta la versión 10            |

`DATABASE_URL` se lee desde el entorno. `.env.example` tiene valores locales de ejemplo, sin secretos personales. `.env` está en `.gitignore`. `main.ts` carga `.env` con `dotenv` si el archivo existe. Sin `DATABASE_URL`, `PrismaService` no arranca. `prisma.config.ts` carga ese mismo archivo y, si la variable no está, usa un placeholder solo para que `prisma generate` pueda ejecutarse. `prisma migrate deploy` tiene que correr con el `DATABASE_URL` real del `.env`.

PostgreSQL local está descrito en `docker-compose.yml`: imagen oficial `postgres:17`, usuario, contraseña, base y puerto configurables, volumen `postgres_data` y healthcheck con `pg_isready`. El contenedor no fue levantado y la migración no fue aplicada.

Para usarlo más adelante, copiar `.env.example` a `.env` y ejecutar:

- `npm run db:up` levanta PostgreSQL.
- `npm run db:down` lo detiene y conserva el volumen.
- `npm run db:migrate` aplica las migraciones versionadas con `prisma migrate deploy`.
- `npm run db:migrate:status` consulta el estado de esas migraciones.
- `npm run prisma:generate` regenera el cliente.

No se usa `prisma db push`. La validación contra PostgreSQL queda para cuando existan los adaptadores: levantar la base desde cero, aplicar las migraciones, revisar constraints e índices, cargar el seed y correr los tests de integración, transacciones, rollback, idempotencia y concurrencia.

## Persistencia

El schema está en `prisma/schema.prisma`. La migración inicial está en `prisma/migrations/20261126054100_init`. No fue aplicada contra una base: no hay `DATABASE_URL` de trabajo. Los repositorios y los adaptadores todavía no existen.

```text
users
  id UUID PK
  email UNIQUE

accounts
  id UUID PK
  user_id UUID NOT NULL UNIQUE → users.id
  account_number UNIQUE

instruments
  id UUID PK
  ticker UNIQUE
  name
  type

market_data
  id UUID PK
  instrument_id UUID → instruments.id
  high, low, open, close, previous_close
  observed_at
  UNIQUE (instrument_id, observed_at)

orders
  id UUID PK
  account_id UUID → accounts.id
  instrument_id UUID → instruments.id
  side, size, price?, type?, status, rejection_reason?, placed_at
  INDEX (account_id, instrument_id)

idempotency_records
  id UUID PK
  user_id UUID → users.id
  idempotency_key, operation, request_hash, result JSONB, created_at, completed_at
  UNIQUE (user_id, idempotency_key)
```

Todos los `id` son `UUID` sin default y sin secuencia. Los genera `UuidGenerator` en la aplicación, también para el seed futuro. Las foreign keys usan `ON DELETE RESTRICT`. Prisma agrega `ON UPDATE CASCADE`, que no se usa porque las primary keys no se reescriben.

`NUMERIC(38, 18)` guarda precios, cotizaciones y `orders.size`. Son 18 decimales, el máximo de `Money`, y 20 dígitos enteros, el tope de `Money.parse` y de `ShareQuantity`. El efectivo y las acciones comparten `size`: las acciones tienen que ser enteras por `orders_shape_chk`.

Ese `CHECK` cierra las combinaciones de side, type, status, size, price y rejection reason. `market_data_prices_chk` exige OHLC positivo, `previous_close >= 0` y que high y low contengan a open y close. Que un movimiento de efectivo apunte al instrumento ARS no está en SQL: lo va a exigir el adaptador.

Índices y la consulta que los usa:

| Índice | Consulta |
| --- | --- |
| `users.email` único | Identidad por email. |
| `accounts.user_id` único | `SELECT id FROM accounts WHERE user_id = $1 FOR UPDATE`. |
| `accounts.account_number` único | Número de cuenta. |
| `instruments.ticker` único | Búsqueda exacta por ticker. |
| `orders (account_id, instrument_id)` | Órdenes de una cuenta y, dentro, las de un instrumento. El prefijo cubre el listado por cuenta. |
| `market_data (instrument_id, observed_at)` único | Último close de un instrumento, recorriendo la fecha al revés. |
| `idempotency_records (user_id, idempotency_key)` único | Replay y conflicto. `operation` no forma parte de la clave. |

La primary key de `orders` alcanza para buscar una orden por id y filtrar `account_id` sobre esa fila. No hay otro índice encima.

## Decisiones de diseño pendientes

- Adaptador del bloqueo de cuenta con `SELECT … FOR UPDATE`.
- Repositorios de órdenes, instrumentos, cotizaciones e idempotencia.
- Seed de cada usuario con su cuenta y del instrumento ARS.
- Portfolio, búsqueda de instrumentos y movimientos de efectivo como casos de uso.
- Endpoints y códigos HTTP, incluido el status de una orden `REJECTED`.
- Tests de integración contra PostgreSQL, incluida la concurrencia de dos transacciones.
