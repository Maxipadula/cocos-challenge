# Migración de la base legacy

Hay dos caminos. No comparten historia de migraciones.

## A. Desarrollo local

La base `cocos` nace con `prisma/migrations/20261126054100_init`. Ese archivo no se modifica. El SQL original no entra en este camino.

```bash
npm run db:up
npm run db:migrate
npm run db:seed
npm run test:integration
```

`db:seed` exige `SEED_DEV=1` y un host local. El script de npm ya define esa variable. No usa `prisma db push`.

## B. Base remota que ya tiene el esquema original

No ejecutar este procedimiento contra la base local `cocos` ni contra `cocos_legacy_test`. No correr `db:seed` ni `prisma/fixtures/real-database.sql` en la remota.

1. Hacer un dump y conservarlo:

   ```bash
   pg_dump "$REMOTE_DATABASE_URL" --format=custom --file=backup-legacy.dump
   ```

2. Confirmar que el dump existe y no está vacío.
3. Ejecutar el preflight y la transformación. El comando aborta si el host es local, si el nombre de la base es `cocos`, `cocos_legacy_test` o `postgres`, si no hay backup, o si `_prisma_migrations` tiene una historia distinta de la migración inicial ya aplicada.

   ```bash
   LEGACY_UPGRADE_REMOTE=1 \
   LEGACY_UPGRADE_BACKUP=backup-legacy.dump \
   DATABASE_URL="$REMOTE_DATABASE_URL" \
   npm run db:legacy:upgrade
   ```

El SQL aplicado es `prisma/legacy-upgrade/001_to_current_schema.sql`. Corre en una sola transacción. Si las columnas, los tipos o una orden rechazada no coinciden con las precondiciones, no cambia nada.

Las transformaciones de datos son las ya aprobadas:

- Cada usuario gana una cuenta con su `accountNumber`.
- Los seriales pasan a los UUID fijos `a1`–`a5` más el serial en hexadecimal.
- `ARS` se reconoce por ticker y tipo `MONEDA`.
- Se omiten cotizaciones con OHLC nulo.
- El efectivo queda con `type` y `price` nulos.
- Se omite toda orden `LIMIT FILLED`.
- La venta rechazada de 100 `PAMP` recibe `INSUFFICIENT_SHARES`.
- Los precios se redondean a dos decimales. `1047.166` queda `1047.17`.
- Fechas y timestamps sin zona se guardan como UTC.

Después de transformar, el comando compara el esquema con el resultado de aplicar `20261126054100_init` en una base local vacía llamada `cocos_legacy_reference`. Esa base se crea y se borra en el host local. Si la comparación falla, no se registra el baseline: hay que restaurar el dump y no seguir con Prisma Migrate.

Solo cuando el esquema coincide, ejecuta:

```bash
prisma migrate resolve --applied 20261126054100_init
```

Si `_prisma_migrations` ya existe y no contiene exactamente esa migración aplicada, el comando se detiene antes de registrarla. A partir de un baseline correcto, las migraciones siguientes se aplican con `npm run db:migrate`.

## C. Ensayo local

`npm run db:legacy:rehearse` solo acepta `localhost`. Crea o reutiliza la base `cocos_legacy_test`. No ejecuta DDL sobre `cocos`.

1. Si `cocos_legacy_test` está vacía, carga `prisma/fixtures/real-database.sql`.
2. Si todavía tiene el esquema original, ejecuta el mismo SQL de `prisma/legacy-upgrade/`.
3. Verifica efectivo, tenencias y el `previousClose` de `BBAR`.
4. Si todavía no tiene las migraciones posteriores, compara el esquema contra la migración inicial.
5. Registra el baseline de la migración inicial cuando `_prisma_migrations` no existe. Si ya hay migraciones posteriores registradas, exige que sean exactamente el prefijo aplicado de `prisma/migrations`.
6. Aplica las migraciones de Prisma que falten, incluido el backfill de reservas. No ejecuta el seed de desarrollo: los datos ya vienen de la fixture transformada.
7. Verifica `reserved_cash`, las reservas de acciones y que coincidan con las órdenes `LIMIT NEW`.
8. Compara el esquema final contra todas las migraciones de Prisma, en una base temporal.
9. Corre `npm run test:integration` con `DATABASE_URL` apuntando a `cocos_legacy_test`.

Antes hace falta el servidor local:

```bash
npm run db:up
npm run db:legacy:rehearse
```
