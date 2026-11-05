-- Money: integer paise. Weight: integer milligrams. Percentages: basis points.

CREATE TABLE IF NOT EXISTS metal_rates (
  metal      text PRIMARY KEY,
  rate_paise integer NOT NULL CHECK (rate_paise > 0), -- per gram of fine metal
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  metal        text NOT NULL REFERENCES metal_rates(metal),
  purities     text[] NOT NULL,
  sizes        jsonb NOT NULL,              -- [{label, weightMg}]
  wastage_bp   integer NOT NULL CHECK (wastage_bp >= 0),
  making_type  text NOT NULL CHECK (making_type IN ('per_gram', 'percent')),
  making_value integer NOT NULL CHECK (making_value >= 0), -- paise per gram, or bp of metal value
  stones       jsonb NOT NULL DEFAULT '[]', -- [{name, count, pricePaise}]
  stock        integer NOT NULL CHECK (stock >= 0)
);

-- A price shown on the product page, locked until expires_at. Single-use for Buy now.
CREATE TABLE IF NOT EXISTS quotes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  integer NOT NULL REFERENCES products(id),
  purity      text NOT NULL,
  size_label  text NOT NULL,
  breakdown   jsonb NOT NULL,
  total_paise integer NOT NULL,
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE TABLE IF NOT EXISTS cart_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigserial,            -- stable display / allocation order
  cart_id             uuid NOT NULL,
  product_id          integer NOT NULL REFERENCES products(id),
  purity              text NOT NULL,
  size_label          text NOT NULL,
  qty                 integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  added_total_paise   integer NOT NULL,     -- price when added (display only)
  total_paise         integer NOT NULL,     -- confirmed unit price the customer will pay
  breakdown           jsonb NOT NULL,
  locked_until        timestamptz NOT NULL,
  change              text CHECK (change IN ('down', 'same')), -- result of last re-price
  prev_total_paise    integer,              -- price before an automatic drop
  pending_total_paise integer,              -- higher price awaiting customer acceptance
  pending_breakdown   jsonb,
  pending_until       timestamptz,
  created_at          timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS cart_items_cart_idx ON cart_items (cart_id);

CREATE TABLE IF NOT EXISTS orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total_paise integer NOT NULL,
  created_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id          serial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  integer NOT NULL REFERENCES products(id),
  purity      text NOT NULL,
  size_label  text NOT NULL,
  qty         integer NOT NULL,
  total_paise integer NOT NULL,             -- unit price charged
  breakdown   jsonb NOT NULL
);
