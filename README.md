# Live-Rate Jewellery Configurator

A small React + Node + PostgreSQL shop. Prices are calculated live from the metal rate, locked for
10 minutes, re-checked when the lock expires, and checkout is safe when two people try to buy
the last unit at the same time.

## Run it

```bash
docker compose up --build
```

Open http://localhost:3000. That's it — Postgres starts, the API creates its tables and seeds sample
data on boot, and the same container serves the built React app.

To watch locks expire without waiting 10 minutes:

```bash
LOCK_SECONDS=45 docker compose up --build
```

Then use **"Demo: move the live rate"** at the bottom of any page (±2%) and watch the cart.

## Tests

```bash
docker compose run --rm app npm test
```

(or, with the `db` container running, `cd server && npm install && npm test` from the host — it uses port 5433.)

22 tests against a real Postgres (`jewellery_test` database, reset before each test):

| File | What it proves |
| --- | --- |
| `price.test.js` | Price calculation equals hand-calculated values (with and without stones, per-gram and % making, half-up rounding), breakdown always sums to total |
| `lock.test.js` | Lock holds at 9:59 and expires at 10:00; adding to cart restarts the lock; expired lock blocks checkout; Buy now → success / `PRICE_EXPIRED` (+ fresh quote) / `OUT_OF_STOCK`; a quote can't be used twice |
| `cart.test.js` | After expiry: price down → auto-applied with note; same → re-locked; up → needs confirmation, checkout blocked until the exact shown price is accepted; sold elsewhere → out of stock; tampered totals refused |
| `concurrency.test.js` | **Two checkouts for the last unit, both provably in flight at once → exactly one 201, one 409**, stock 0, one order. Also 20 simultaneous checkouts and 20 simultaneous Buy-now clicks → exactly one order |

The first concurrency test holds a row lock from a third connection and waits until Postgres
reports both checkout transactions blocked on it, so the race is real, not a lucky interleaving.
Swapping the stock update for a naive read-then-write makes all three concurrency tests fail.

The clock is injected into the app (`createApp({ now })`), so lock tests move time instead of sleeping.

## Sample data

| Product | Metal / purities | Notes |
| --- | --- | --- |
| Classic Gold Band | Gold 22K, 18K · 3 sizes | Making ₹450/g, wastage 8%, stock 5 |
| Diamond Halo Pendant | Gold 18K, 14K · 2 weights | **12 diamonds + ruby**, making 12% of metal, wastage 10%, stock 3 |
| Platinum Eternity Ring | Pt 950 · 2 sizes | **Stock 1** |
| Sterling Silver Anklet | Silver 925, 999 · 2 lengths | Making 8%, wastage 6%, stock 10 |

Rates (per gram of fine metal): gold ₹7,500, silver ₹95, platinum ₹3,200.

## How the price is calculated

```
metal value = rate per gram (fine) × purity × weight
wastage     = metal value × wastage %
making      = ₹/gram × weight          (or % of metal value, per product)
stones      = Σ count × stone price
subtotal    = metal value + wastage + making + stones
GST         = 3% × subtotal
total       = subtotal + GST
```

Purity factors: 24K 99.9%, 22K 91.6%, 18K 75.0%, 14K 58.5%, silver 925/999, platinum 950.

### Rounding

- All money is stored and calculated as **integer paise**, weight as **integer milligrams**, percentages
  as **basis points** — no floating-point money anywhere.
- Each line of the breakdown is rounded **half-up to the nearest paisa** on its own, GST is calculated
  on the already-rounded subtotal, and the total is the sum of the rounded lines. So the breakdown the
  customer sees always adds up exactly to the total they pay.

Worked example (Gold Band, 22K, Size 12 = 4.000 g):
`7,500 × 0.916 × 4 = 27,480.00` · wastage `2,198.40` · making `1,800.00` · subtotal `31,478.40` ·
GST `944.352 → 944.35` · **total ₹32,422.75**.

## How the flow works

- **Product page** — choosing purity/size requests a *quote* from the server (the server is the only
  place prices are calculated). A quote holds the full breakdown and is locked for 10 minutes; the
  countdown is shown, and when it hits zero the page re-quotes and says whether the price went up,
  down or stayed the same.
- **Add to cart** — copies the quote's price into the cart and restarts the 10-minute lock. An
  expired quote is refused with a fresh one, so the customer always sees the price before it's used.
- **Cart** — every time the cart is read, items whose lock has expired are re-priced at the live rate:
  - lower → applied automatically, old price struck through with a note;
  - same → re-locked, "unchanged" note;
  - higher → the old price stays the confirmed one, the new price is held as *pending* (with its own
    countdown) and must be explicitly accepted. Accept only succeeds for the exact price shown and
    while it is still held;
  - out of stock → flagged.
  The summary says how many items need confirmation (and what the total becomes), and Checkout is
  disabled until everything is confirmed and in stock.
- **Checkout** — one transaction. The client sends the price it is showing for each item; the server
  locks the cart rows and refuses (409) if anything needs confirmation, a lock has expired, a price
  differs from what was shown, or the cart changed. Stock is taken with
  `UPDATE products SET stock = stock - $qty WHERE id = $id AND stock >= $qty`; zero rows updated
  means sold out and the whole order rolls back. Products are locked in id order to avoid deadlocks.
  A `CHECK (stock >= 0)` constraint is a second line of defence.
- **Buy now** — claims the quote with a single conditional update (`used_at IS NULL AND
  expires_at > now`), takes stock the same way, and creates the order. Expired → 409 with a fresh
  quote and the old price for comparison; sold out → 409.

## Assumptions

- No login: a cart is a random UUID stored in `localStorage`.
- Stock is per product (a physical piece), not per purity/size combination.
- One unit per cart line; adding again adds another line (each with its own lock) and is refused if
  it exceeds stock.
- Out-of-stock is checked whenever the cart is read, not only at lock expiry.
- When a higher price is accepted it keeps the hold window it was quoted with (it doesn't restart),
  so a customer can never pay a price that was calculated more than 10 minutes ago.
- No payment step — "checkout" means the order is created and stock taken.
- `PUT /api/rates/:metal` is an unauthenticated demo endpoint for reviewers.
- Countdowns use the browser clock; the server is always the authority on whether a lock is valid.

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/rates` | live metal rates |
| PUT | `/api/rates/:metal` | demo: set a rate `{ ratePaise }` |
| GET | `/api/products`, `/api/products/:id` | catalogue |
| POST | `/api/quotes` | `{ productId, purity, size }` → breakdown, total, `expiresAt` |
| GET | `/api/cart/:cartId` | cart (re-prices expired items) + summary |
| POST | `/api/cart/:cartId/items` | `{ quoteId }` |
| POST | `/api/cart/:cartId/items/:id/accept` | `{ expectedTotalPaise }` |
| DELETE | `/api/cart/:cartId/items/:id` | |
| POST | `/api/checkout` | `{ cartId, items: [{ id, totalPaise }] }` |
| POST | `/api/buy-now` | `{ quoteId }` |

Errors are `{ error: CODE, message }` with 409 for `PRICE_EXPIRED`, `PRICE_CHANGED`,
`PRICE_CONFIRMATION_REQUIRED`, `OUT_OF_STOCK`, `CART_CHANGED`, `QUOTE_USED`.

## Layout

```
server/src/price.js   pure price calculation
server/src/app.js     routes, cart re-pricing, checkout / buy-now transactions
server/src/db.js      migrate, seed, transaction helper
server/db/            schema.sql, seed.sql
server/test/          price, lock, cart, concurrency tests
web/src/              App (routing, header), ProductPage, CartPage, ui (Breakdown, Countdown)
```

## With more time

- **Live rate push** (optional extra): a job that moves the gold rate every minute and pushes it to
  open product/cart pages over Server-Sent Events, instead of the current 30-second header poll and
  re-check on lock expiry.
- **Admin** for making-charge and wastage rules (optional extra), with an audit trail.
- Server time offset sent to the client so countdowns are exact even with a skewed device clock.
- Clean up expired, unused quotes with a periodic job; an `orders` page; idempotency keys on checkout.
- Per-variant stock if pieces are made to order; reservations (hold stock while in cart) if the
  business wants that trade-off.
- Frontend component tests (Vitest + Testing Library) and a Playwright run of the full flow.
