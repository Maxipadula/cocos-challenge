-- Persist account reservations. Settled balances stay derived from orders.

ALTER TABLE "accounts"
    ADD COLUMN "reserved_cash" DECIMAL(38, 18) NOT NULL DEFAULT 0;

ALTER TABLE "accounts"
    ADD CONSTRAINT "accounts_reserved_cash_chk" CHECK ("reserved_cash" >= 0);

CREATE TABLE "account_reserved_positions" (
    "account_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "quantity" DECIMAL(38, 0) NOT NULL,

    CONSTRAINT "account_reserved_positions_pkey" PRIMARY KEY ("account_id", "instrument_id")
);

ALTER TABLE "account_reserved_positions"
    ADD CONSTRAINT "account_reserved_positions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "account_reserved_positions"
    ADD CONSTRAINT "account_reserved_positions_instrument_id_fkey"
    FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "account_reserved_positions"
    ADD CONSTRAINT "account_reserved_positions_quantity_chk" CHECK ("quantity" > 0);

UPDATE "accounts" AS account
SET "reserved_cash" = COALESCE((
    SELECT SUM("size" * "price")
    FROM "orders"
    WHERE "orders"."account_id" = account."id"
      AND "orders"."side" = 'BUY'
      AND "orders"."type" = 'LIMIT'
      AND "orders"."status" = 'NEW'
), 0);

INSERT INTO "account_reserved_positions" ("account_id", "instrument_id", "quantity")
SELECT "account_id", "instrument_id", SUM("size")
FROM "orders"
WHERE "side" = 'SELL'
  AND "type" = 'LIMIT'
  AND "status" = 'NEW'
GROUP BY "account_id", "instrument_id"
HAVING SUM("size") > 0;
