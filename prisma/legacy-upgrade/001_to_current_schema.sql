-- Transforms the original challenge schema into the schema created by
-- prisma/migrations/20261126054100_init.
-- This file is not a Prisma migration. Do not move it into prisma/migrations.
-- Do not run it against the normal local database "cocos".
-- The whole script is one transaction: any failed precondition rolls back.

BEGIN;

DO $$
DECLARE
  users_columns text;
  instrument_columns text;
  order_columns text;
  market_columns text;
  omitted_market integer;
  omitted_orders integer;
BEGIN
  IF to_regclass('public.users') IS NULL
     OR to_regclass('public.instruments') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.marketdata') IS NULL THEN
    RAISE EXCEPTION 'Legacy tables users, instruments, orders and marketdata must already exist.';
  END IF;

  IF to_regclass('public.accounts') IS NOT NULL
     OR to_regclass('public.market_data') IS NOT NULL
     OR to_regclass('public.idempotency_records') IS NOT NULL THEN
    RAISE EXCEPTION 'The current schema is already present. Refusing to upgrade again.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname IN ('OrderSide', 'OrderType', 'OrderStatus', 'RejectionReason')
  ) THEN
    RAISE EXCEPTION 'Target enums already exist.';
  END IF;

  SELECT string_agg(column_name, ',' ORDER BY column_name)
    INTO users_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users';

  SELECT string_agg(column_name, ',' ORDER BY column_name)
    INTO instrument_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'instruments';

  SELECT string_agg(column_name, ',' ORDER BY column_name)
    INTO order_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders';

  SELECT string_agg(column_name, ',' ORDER BY column_name)
    INTO market_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'marketdata';

  IF users_columns IS DISTINCT FROM 'accountnumber,email,id' THEN
    RAISE EXCEPTION 'users columns are [%], expected accountnumber,email,id.', users_columns;
  END IF;

  IF instrument_columns IS DISTINCT FROM 'id,name,ticker,type' THEN
    RAISE EXCEPTION 'instruments columns are [%], expected id,name,ticker,type.', instrument_columns;
  END IF;

  IF order_columns IS DISTINCT FROM 'datetime,id,instrumentid,price,side,size,status,type,userid' THEN
    RAISE EXCEPTION 'orders columns are [%].', order_columns;
  END IF;

  IF market_columns IS DISTINCT FROM 'close,date,high,id,instrumentid,low,open,previousclose' THEN
    RAISE EXCEPTION 'marketdata columns are [%].', market_columns;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'users' AND column_name = 'id' AND data_type <> 'integer')
        OR (table_name = 'users' AND column_name = 'email' AND (data_type <> 'character varying' OR character_maximum_length <> 255))
        OR (table_name = 'users' AND column_name = 'accountnumber' AND (data_type <> 'character varying' OR character_maximum_length <> 20))
        OR (table_name = 'instruments' AND column_name = 'id' AND data_type <> 'integer')
        OR (table_name = 'orders' AND column_name = 'id' AND data_type <> 'integer')
        OR (table_name = 'marketdata' AND column_name = 'id' AND data_type <> 'integer')
        OR (table_name = 'marketdata' AND column_name = 'date' AND data_type <> 'date')
        OR (table_name = 'orders' AND column_name = 'datetime' AND data_type <> 'timestamp without time zone')
      )
  ) THEN
    RAISE EXCEPTION 'A legacy column type does not match the original challenge schema.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM users
    WHERE email IS NULL OR btrim(email) = '' OR accountnumber IS NULL OR btrim(accountnumber) = ''
       OR length(accountnumber) > 64
  ) OR EXISTS (
    SELECT email FROM users GROUP BY email HAVING count(*) > 1
  ) OR EXISTS (
    SELECT accountnumber FROM users GROUP BY accountnumber HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Users need a unique email and a unique account number.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM instruments
    WHERE ticker IS NULL OR btrim(ticker) = '' OR name IS NULL OR type IS NULL
       OR length(ticker) > 32 OR length(type) > 32
  ) OR EXISTS (
    SELECT ticker FROM instruments GROUP BY ticker HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Instruments need a unique ticker and a type that fits the current schema.';
  END IF;

  IF EXISTS (SELECT 1 FROM orders WHERE upper(side) IN ('CASH_IN', 'CASH_OUT'))
     AND (
       SELECT count(*) FROM instruments
       WHERE ticker = 'ARS' AND upper(type) = 'MONEDA'
     ) <> 1 THEN
    RAISE EXCEPTION 'Cash movements require exactly one ARS instrument of type MONEDA.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM orders AS legacy_order
    JOIN instruments ON instruments.id = legacy_order.instrumentid
    WHERE upper(legacy_order.side) IN ('CASH_IN', 'CASH_OUT')
      AND NOT (instruments.ticker = 'ARS' AND upper(instruments.type) = 'MONEDA')
  ) THEN
    RAISE EXCEPTION 'A cash movement points at an instrument other than ARS MONEDA.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM orders AS legacy_order
    JOIN instruments ON instruments.id = legacy_order.instrumentid
    WHERE upper(legacy_order.side) IN ('BUY', 'SELL')
      AND upper(instruments.type) = 'MONEDA'
  ) THEN
    RAISE EXCEPTION 'A trade points at a currency instrument.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM orders
    WHERE upper(side) NOT IN ('BUY', 'SELL', 'CASH_IN', 'CASH_OUT')
       OR upper(status) NOT IN ('NEW', 'FILLED', 'REJECTED', 'CANCELLED')
       OR (type IS NOT NULL AND upper(type) NOT IN ('MARKET', 'LIMIT'))
       OR datetime IS NULL
       OR size IS NULL
       OR size <= 0
       OR size <> trunc(size)
  ) THEN
    RAISE EXCEPTION 'An order has a side, status, type, timestamp or size that cannot be migrated.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM orders
    WHERE upper(side) IN ('BUY', 'SELL')
      AND NOT (upper(type) = 'LIMIT' AND upper(status) = 'FILLED')
      AND (type IS NULL OR price IS NULL OR price <= 0)
  ) THEN
    RAISE EXCEPTION 'A trade is missing its type or a positive price.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM orders
    WHERE upper(side) = 'CASH_IN' AND upper(status) <> 'FILLED'
  ) OR EXISTS (
    SELECT 1 FROM orders
    WHERE upper(side) = 'CASH_OUT' AND upper(status) <> 'FILLED'
  ) THEN
    RAISE EXCEPTION 'A cash movement has a status that has no approved migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM orders AS legacy_order
    JOIN instruments ON instruments.id = legacy_order.instrumentid
    WHERE upper(legacy_order.status) = 'REJECTED'
      AND NOT (
        upper(legacy_order.side) = 'SELL'
        AND upper(legacy_order.type) = 'MARKET'
        AND instruments.ticker = 'PAMP'
        AND legacy_order.size = 100
      )
  ) THEN
    RAISE EXCEPTION 'A rejected order has no approved inferred reason.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM marketdata
    WHERE close IS NULL OR previousclose IS NULL OR date IS NULL OR instrumentid IS NULL
  ) THEN
    RAISE EXCEPTION 'A market row is missing close, previous close, date or instrument.';
  END IF;

  SELECT count(*) INTO omitted_market
  FROM marketdata
  WHERE open IS NULL OR high IS NULL OR low IS NULL;

  SELECT count(*) INTO omitted_orders
  FROM orders
  WHERE upper(type) = 'LIMIT' AND upper(status) = 'FILLED';

  RAISE NOTICE 'Omitting % market rows with null OHLC.', omitted_market;
  RAISE NOTICE 'Omitting % LIMIT FILLED orders because that state is not allowed.', omitted_orders;
END $$;

CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL', 'CASH_IN', 'CASH_OUT');
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT');
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'FILLED', 'REJECTED', 'CANCELLED');
CREATE TYPE "RejectionReason" AS ENUM ('INSUFFICIENT_CASH', 'INSUFFICIENT_SHARES');

CREATE TABLE users_next (
    id UUID NOT NULL,
    email TEXT NOT NULL
);

CREATE TABLE accounts (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    account_number VARCHAR(64) NOT NULL
);

CREATE TABLE instruments_next (
    id UUID NOT NULL,
    ticker VARCHAR(32) NOT NULL,
    name TEXT NOT NULL,
    type VARCHAR(32) NOT NULL
);

CREATE TABLE market_data (
    id UUID NOT NULL,
    instrument_id UUID NOT NULL,
    high DECIMAL(38,18) NOT NULL,
    low DECIMAL(38,18) NOT NULL,
    open DECIMAL(38,18) NOT NULL,
    close DECIMAL(38,18) NOT NULL,
    previous_close DECIMAL(38,18) NOT NULL,
    observed_at TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE orders_next (
    id UUID NOT NULL,
    account_id UUID NOT NULL,
    instrument_id UUID NOT NULL,
    side "OrderSide" NOT NULL,
    size DECIMAL(38,18) NOT NULL,
    price DECIMAL(38,18),
    type "OrderType",
    status "OrderStatus" NOT NULL,
    rejection_reason "RejectionReason",
    placed_at TIMESTAMPTZ(3) NOT NULL
);

CREATE TABLE idempotency_records (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    operation TEXT NOT NULL,
    request_hash CHAR(64) NOT NULL,
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ(3) NOT NULL,
    completed_at TIMESTAMPTZ(3) NOT NULL
);

INSERT INTO users_next (id, email)
SELECT
    ('a1000000-0000-4000-8000-' || lpad(to_hex(id), 12, '0'))::uuid,
    email
FROM users;

INSERT INTO accounts (id, user_id, account_number)
SELECT
    ('a2000000-0000-4000-8000-' || lpad(to_hex(id), 12, '0'))::uuid,
    ('a1000000-0000-4000-8000-' || lpad(to_hex(id), 12, '0'))::uuid,
    accountnumber
FROM users;

INSERT INTO instruments_next (id, ticker, name, type)
SELECT
    ('a3000000-0000-4000-8000-' || lpad(to_hex(id), 12, '0'))::uuid,
    ticker,
    name,
    type
FROM instruments;

INSERT INTO market_data (
    id, instrument_id, high, low, open, close, previous_close, observed_at
)
SELECT
    ('a5000000-0000-4000-8000-' || lpad(to_hex(id), 12, '0'))::uuid,
    ('a3000000-0000-4000-8000-' || lpad(to_hex(instrumentid), 12, '0'))::uuid,
    round(high, 2),
    round(low, 2),
    round(open, 2),
    round(close, 2),
    round(previousclose, 2),
    (date::timestamp) AT TIME ZONE 'UTC'
FROM marketdata
WHERE open IS NOT NULL
  AND high IS NOT NULL
  AND low IS NOT NULL;

INSERT INTO orders_next (
    id, account_id, instrument_id, side, size, price, type, status,
    rejection_reason, placed_at
)
SELECT
    ('a4000000-0000-4000-8000-' || lpad(to_hex(legacy_order.id), 12, '0'))::uuid,
    ('a2000000-0000-4000-8000-' || lpad(to_hex(legacy_order.userid), 12, '0'))::uuid,
    ('a3000000-0000-4000-8000-' || lpad(to_hex(legacy_order.instrumentid), 12, '0'))::uuid,
    upper(legacy_order.side)::"OrderSide",
    legacy_order.size::numeric(38, 18),
    CASE
        WHEN upper(legacy_order.side) IN ('CASH_IN', 'CASH_OUT') THEN NULL
        ELSE round(legacy_order.price, 2)
    END,
    CASE
        WHEN upper(legacy_order.side) IN ('CASH_IN', 'CASH_OUT') THEN NULL
        ELSE upper(legacy_order.type)::"OrderType"
    END,
    upper(legacy_order.status)::"OrderStatus",
    CASE
        WHEN upper(legacy_order.status) <> 'REJECTED' THEN NULL
        WHEN upper(legacy_order.side) = 'SELL'
         AND upper(legacy_order.type) = 'MARKET'
         AND instruments.ticker = 'PAMP'
         AND legacy_order.size = 100
            THEN 'INSUFFICIENT_SHARES'::"RejectionReason"
        ELSE NULL
    END,
    legacy_order.datetime AT TIME ZONE 'UTC'
FROM orders AS legacy_order
JOIN instruments ON instruments.id = legacy_order.instrumentid
WHERE NOT (upper(legacy_order.type) = 'LIMIT' AND upper(legacy_order.status) = 'FILLED');

DROP TABLE orders CASCADE;
DROP TABLE marketdata CASCADE;
DROP TABLE instruments CASCADE;
DROP TABLE users CASCADE;

ALTER TABLE users_next RENAME TO users;
ALTER TABLE instruments_next RENAME TO instruments;
ALTER TABLE orders_next RENAME TO orders;

ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
ALTER TABLE instruments ADD CONSTRAINT instruments_pkey PRIMARY KEY (id);
ALTER TABLE market_data ADD CONSTRAINT market_data_pkey PRIMARY KEY (id);
ALTER TABLE orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE idempotency_records ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE UNIQUE INDEX accounts_user_id_key ON accounts (user_id);
CREATE UNIQUE INDEX accounts_account_number_key ON accounts (account_number);
CREATE UNIQUE INDEX instruments_ticker_key ON instruments (ticker);
CREATE UNIQUE INDEX market_data_instrument_id_observed_at_key ON market_data (instrument_id, observed_at);
CREATE INDEX orders_account_id_instrument_id_idx ON orders (account_id, instrument_id);
CREATE UNIQUE INDEX idempotency_records_user_id_idempotency_key_key ON idempotency_records (user_id, idempotency_key);

ALTER TABLE accounts
    ADD CONSTRAINT accounts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE market_data
    ADD CONSTRAINT market_data_instrument_id_fkey
    FOREIGN KEY (instrument_id) REFERENCES instruments (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE orders
    ADD CONSTRAINT orders_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE orders
    ADD CONSTRAINT orders_instrument_id_fkey
    FOREIGN KEY (instrument_id) REFERENCES instruments (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE idempotency_records
    ADD CONSTRAINT idempotency_records_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE orders ADD CONSTRAINT orders_shape_chk CHECK (
    size > 0
    AND (
        (
            side IN ('BUY', 'SELL')
            AND type IS NOT NULL
            AND price IS NOT NULL
            AND price > 0
            AND size = trunc(size)
            AND (
                (type = 'MARKET' AND status IN ('FILLED', 'REJECTED'))
                OR (type = 'LIMIT' AND status IN ('NEW', 'REJECTED', 'CANCELLED'))
            )
            AND (
                (
                    status = 'REJECTED'
                    AND (
                        (side = 'BUY' AND rejection_reason = 'INSUFFICIENT_CASH')
                        OR (side = 'SELL' AND rejection_reason = 'INSUFFICIENT_SHARES')
                    )
                )
                OR (status <> 'REJECTED' AND rejection_reason IS NULL)
            )
        )
        OR (
            side = 'CASH_IN'
            AND type IS NULL
            AND price IS NULL
            AND status = 'FILLED'
            AND rejection_reason IS NULL
        )
        OR (
            side = 'CASH_OUT'
            AND type IS NULL
            AND price IS NULL
            AND (
                (status = 'FILLED' AND rejection_reason IS NULL)
                OR (
                    status = 'REJECTED'
                    AND rejection_reason = 'INSUFFICIENT_CASH'
                )
            )
        )
    )
);

ALTER TABLE market_data ADD CONSTRAINT market_data_prices_chk CHECK (
    high > 0
    AND low > 0
    AND open > 0
    AND close > 0
    AND previous_close >= 0
    AND high >= low
    AND high >= open
    AND high >= close
    AND low <= open
    AND low <= close
);

COMMIT;
