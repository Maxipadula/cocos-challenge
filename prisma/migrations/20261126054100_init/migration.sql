-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL', 'CASH_IN', 'CASH_OUT');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'FILLED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('INSUFFICIENT_CASH', 'INSUFFICIENT_SHARES');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_number" VARCHAR(64) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" UUID NOT NULL,
    "ticker" VARCHAR(32) NOT NULL,
    "name" TEXT NOT NULL,
    "type" VARCHAR(32) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_data" (
    "id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "high" DECIMAL(38,18) NOT NULL,
    "low" DECIMAL(38,18) NOT NULL,
    "open" DECIMAL(38,18) NOT NULL,
    "close" DECIMAL(38,18) NOT NULL,
    "previous_close" DECIMAL(38,18) NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "market_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "instrument_id" UUID NOT NULL,
    "side" "OrderSide" NOT NULL,
    "size" DECIMAL(38,18) NOT NULL,
    "price" DECIMAL(38,18),
    "type" "OrderType",
    "status" "OrderStatus" NOT NULL,
    "rejection_reason" "RejectionReason",
    "placed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_user_id_key" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_account_number_key" ON "accounts"("account_number");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_ticker_key" ON "instruments"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "market_data_instrument_id_observed_at_key" ON "market_data"("instrument_id", "observed_at");

-- CreateIndex
CREATE INDEX "orders_account_id_instrument_id_idx" ON "orders"("account_id", "instrument_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_idempotency_key_key" ON "idempotency_records"("user_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_data" ADD CONSTRAINT "market_data_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks that Prisma schema cannot express. They do not subquery instruments.
ALTER TABLE "orders" ADD CONSTRAINT "orders_shape_chk" CHECK (
    "size" > 0
    AND (
        (
            "side" IN ('BUY', 'SELL')
            AND "type" IS NOT NULL
            AND "price" IS NOT NULL
            AND "price" > 0
            AND "size" = trunc("size")
            AND (
                ("type" = 'MARKET' AND "status" IN ('FILLED', 'REJECTED'))
                OR ("type" = 'LIMIT' AND "status" IN ('NEW', 'REJECTED', 'CANCELLED'))
            )
            AND (
                (
                    "status" = 'REJECTED'
                    AND (
                        ("side" = 'BUY' AND "rejection_reason" = 'INSUFFICIENT_CASH')
                        OR ("side" = 'SELL' AND "rejection_reason" = 'INSUFFICIENT_SHARES')
                    )
                )
                OR ("status" <> 'REJECTED' AND "rejection_reason" IS NULL)
            )
        )
        OR (
            "side" = 'CASH_IN'
            AND "type" IS NULL
            AND "price" IS NULL
            AND "status" = 'FILLED'
            AND "rejection_reason" IS NULL
        )
        OR (
            "side" = 'CASH_OUT'
            AND "type" IS NULL
            AND "price" IS NULL
            AND (
                ("status" = 'FILLED' AND "rejection_reason" IS NULL)
                OR (
                    "status" = 'REJECTED'
                    AND "rejection_reason" = 'INSUFFICIENT_CASH'
                )
            )
        )
    )
);

ALTER TABLE "market_data" ADD CONSTRAINT "market_data_prices_chk" CHECK (
    "high" > 0
    AND "low" > 0
    AND "open" > 0
    AND "close" > 0
    AND "previous_close" >= 0
    AND "high" >= "low"
    AND "high" >= "open"
    AND "high" >= "close"
    AND "low" <= "open"
    AND "low" <= "close"
);
