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

El cliente transaccional expone `$queryRaw` y `$executeRaw`. Esas consultas parametrizadas son el mecanismo previsto para un `SELECT … FOR UPDATE` posterior. El bloqueo del usuario no está implementado.

La transacción no envuelve el arranque de la aplicación. `PrismaService` conecta en `onModuleInit` y cierra en `onModuleDestroy`.

## Convenciones de código

- Archivos en kebab-case. Las clases de Nest conservan el sufijo de rol: `prisma.service.ts`, `orders.module.ts`.
- Imports relativos ESM con extensión `.js`.
- TypeScript `strict`. `strictPropertyInitialization` queda desactivado, igual que el preset strict de Nest, porque la inyección por decoradores no siempre es visible para ese chequeo.
- Sin `any`. ESLint lo marca como error, junto con promesas flotantes.
- Prettier: comillas simples, punto y coma, trailing comma, ancho 80, fin de línea LF.
- El cliente generado de Prisma queda en `src/generated` y no se versiona. `prisma generate` corre antes del build, de los tests y del typecheck.
- Los mensajes de error del código están en inglés. Este documento está en español.

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

`DATABASE_URL` se lee desde el entorno. `.env.example` tiene una URL de ejemplo, sin credenciales reales. `main.ts` carga `.env` con `dotenv` si el archivo existe. Sin `DATABASE_URL`, `PrismaService` no arranca. `prisma.config.ts` usa un placeholder solo para que `prisma generate` pueda ejecutarse antes de tener una base local.

## Decisiones de diseño pendientes

Ninguna de estas decisiones está implementada:

- Entidades, value objects y reglas de negocio.
- Modelos de Prisma para usuarios, instrumentos, órdenes y market data.
- Tabla de idempotencia HTTP, hash del payload y respuesta guardada.
- Bloqueo del usuario con `SELECT … FOR UPDATE`.
- Casos de uso de órdenes, portfolio, búsqueda y efectivo.
- Endpoints y códigos HTTP, incluido el status de una orden `REJECTED`.
- Fórmulas de efectivo, reservas, posición y retorno diario.
- Aritmética decimal de dinero.
- Tests de negocio y de concurrencia entre dos transacciones reales.
- Migraciones.

El schema de Prisma declara el generator y el datasource PostgreSQL. No tiene modelos.
