# Cocos API

API para buscar instrumentos, consultar un portfolio y enviar o cancelar órdenes. No hay autenticación: el usuario se indica con el header `X-User-Id`.

## Desarrollo local

PostgreSQL local usa las credenciales de `.env.example` (`cocos` / `cocos`, base `cocos`, puerto `5432`). Copiá ese archivo a `.env` si todavía no existe.

```bash
npm install
npm run db:up
npm run db:migrate
npm run db:seed
npm run start:dev
```

`db:migrate` aplica las migraciones de Prisma. `db:seed` exige un host local y carga la fixture de desarrollo. No usa la base remota ni `prisma db push`.

La API escucha en `http://localhost:3000` salvo que `PORT` diga otra cosa.

El ensayo de una base legacy es otro comando y otra base: `npm run db:legacy:rehearse` solo toca `cocos_legacy_test` en localhost.

## Documentación

Con la API levantada:

- ReDoc: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

ReDoc y su JavaScript se sirven desde la aplicación. No hace falta Internet para abrir la documentación.

Para regenerar los archivos sin levantar la API ni tocar una base:

```bash
npm run docs:openapi
npm run docs:postman
npm run docs:generate
```

`docs:generate` escribe `openapi/openapi.json`, `postman/cocos-api.postman_collection.json` y `postman/cocos-local.postman_environment.json`.

## Postman

Importá la colección y el environment:

- `postman/cocos-api.postman_collection.json`
- `postman/cocos-local.postman_environment.json`

Seleccioná el environment **Cocos local**. Las variables son `baseUrl`, `userId`, `instrumentId`, `orderId` e `idempotencyKey`.

El environment de ejemplo usa el seed local:

- `userId`: Emiliano, `a1000000-0000-4000-8000-000000000001`
- `instrumentId`: GGAL, `a3000000-0000-4000-8000-000000000022`

Esos UUID salen de la fixture de desarrollo. Si la búsqueda devuelve instrumentos, el script de esa request guarda el primer `id` en `instrumentId`. Crear una orden guarda su `id` en `orderId`. Cada escritura genera una `Idempotency-Key` nueva. Para repetir una orden y recibir el mismo resultado, reutilizá la misma clave y el mismo body.

Recorrido sugerido, con la API y el seed levantados:

1. `Search instruments` con `q=ggal`.
2. `Read a portfolio` con el usuario de Emiliano.
3. `MARKET BUY by quantity`.
4. `LIMIT BUY by amount`.
5. `Cancel a new limit order` usando el `orderId` guardado por la orden límite.
6. `Deposit` y `Withdrawal` para mover efectivo. El servidor elige el instrumento ARS.

## Alcance

Están publicados `GET /instruments`, `GET /portfolio`, `POST /orders`, `POST /orders/:orderId/cancel` y `POST /cash-movements`.

Una orden MARKET se ejecuta al último cierre y queda `FILLED`, o `REJECTED` si no alcanza el efectivo o las acciones disponibles. La orden rechazada igual se guarda y la respuesta es 201. Una orden LIMIT aceptada queda `NEW` y reserva efectivo o acciones. No hay matching ni ejecución de órdenes LIMIT.

Un depósito queda `FILLED`. Un retiro queda `FILLED` si entra en el efectivo disponible, o `REJECTED` si no. El efectivo reservado no se puede retirar. La respuesta también es 201 cuando el retiro se rechaza y se guarda.

Los importes y las cantidades viajan como strings.
