import express from 'express';
import path from 'node:path';
import { calculatePrice, PURITIES } from './price.js';
import { tx } from './db.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}

const requireUuid = (v, name) => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, 'BAD_REQUEST', `Invalid ${name}`);
};

const toProduct = (p) => ({
  id: p.id, name: p.name, description: p.description, metal: p.metal, stock: p.stock,
  ratePaise: p.rate_paise,
  purities: p.purities.map((code) => ({ code, permille: PURITIES[p.metal][code] })),
  sizes: p.sizes, stones: p.stones,
});

const toQuote = (q) => ({
  id: q.id, productId: q.product_id, purity: q.purity, size: q.size_label,
  breakdown: q.breakdown, totalPaise: q.total_paise, expiresAt: q.expires_at,
});

/**
 * @param {{ pool: import('pg').Pool, now?: () => Date, lockMs?: number, webDist?: string }} opts
 * `now` is injectable so tests can move the clock instead of sleeping.
 */
export function createApp({ pool, now = () => new Date(), lockMs = 10 * 60 * 1000, webDist }) {
  const app = express();
  app.use(express.json());
  const h = (fn) => (req, res, next) => fn(req, res).catch(next);
  const lockFrom = (t) => new Date(t.getTime() + lockMs);

  async function loadProduct(db, id) {
    const { rows } = await db.query(
      'SELECT p.*, r.rate_paise FROM products p JOIN metal_rates r USING (metal) WHERE p.id = $1',
      [id],
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
    return rows[0];
  }

  function priceOf(product, purity, sizeLabel) {
    if (!product.purities.includes(purity)) throw new HttpError(400, 'BAD_OPTION', `Purity ${purity} is not offered`);
    const size = product.sizes.find((s) => s.label === sizeLabel);
    if (!size) throw new HttpError(400, 'BAD_OPTION', `Size ${sizeLabel} is not offered`);
    return calculatePrice({
      metal: product.metal, ratePaise: product.rate_paise, purity, weightMg: size.weightMg,
      wastageBp: product.wastage_bp, makingType: product.making_type, makingValue: product.making_value,
      stones: product.stones,
    });
  }

  async function createQuote(db, productId, purity, size) {
    const product = await loadProduct(db, productId);
    const breakdown = priceOf(product, purity, size);
    const t = now();
    const { rows } = await db.query(
      `INSERT INTO quotes (product_id, purity, size_label, breakdown, total_paise, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [product.id, purity, size, breakdown, breakdown.total, t, lockFrom(t)],
    );
    return { ...toQuote(rows[0]), stock: product.stock };
  }

  // Load a cart, re-pricing every item whose lock has expired against the live rate.
  async function getCart(cartId) {
    const t = now();
    const { rows } = await pool.query(
      `SELECT c.*, p.name, p.stock FROM cart_items c JOIN products p ON p.id = c.product_id
       WHERE c.cart_id = $1 ORDER BY c.seq`,
      [cartId],
    );

    const items = [];
    for (let item of rows) {
      const pending = item.pending_total_paise !== null;
      const lockEnd = pending ? item.pending_until : item.locked_until;
      if (lockEnd <= t) {
        const fresh = priceOf(await loadProduct(pool, item.product_id), item.purity, item.size_label);
        const until = lockFrom(t);
        const { rows: [updated] } = fresh.total > item.total_paise
          ? // Price went up: keep the confirmed price, park the new one until the customer accepts.
            await pool.query(
              `UPDATE cart_items SET pending_total_paise = $2, pending_breakdown = $3, pending_until = $4,
                 change = NULL, prev_total_paise = NULL
               WHERE id = $1 RETURNING *`,
              [item.id, fresh.total, fresh, until],
            )
          : // Same or lower: apply automatically.
            await pool.query(
              `UPDATE cart_items SET total_paise = $2, breakdown = $3, locked_until = $4, change = $5,
                 prev_total_paise = $6, pending_total_paise = NULL, pending_breakdown = NULL, pending_until = NULL
               WHERE id = $1 RETURNING *`,
              fresh.total < item.total_paise
                ? [item.id, fresh.total, fresh, until, 'down', item.total_paise]
                : [item.id, fresh.total, fresh, until, 'same', null],
            );
        item = { ...item, ...updated };
      }
      items.push(item);
    }

    // Out of stock if this line (plus earlier lines of the same product) needs more than is left.
    const wanted = new Map();
    const result = items.map((i) => {
      wanted.set(i.product_id, (wanted.get(i.product_id) ?? 0) + i.qty);
      const outOfStock = wanted.get(i.product_id) > i.stock;
      const needsConfirmation = i.pending_total_paise !== null;
      return {
        id: i.id, productId: i.product_id, name: i.name, purity: i.purity, size: i.size_label, qty: i.qty,
        addedTotalPaise: i.added_total_paise, totalPaise: i.total_paise, breakdown: i.breakdown,
        lockedUntil: i.locked_until, change: i.change, previousTotalPaise: i.prev_total_paise,
        pending: needsConfirmation
          ? { totalPaise: i.pending_total_paise, breakdown: i.pending_breakdown, until: i.pending_until }
          : null,
        outOfStock,
        status: outOfStock ? 'out_of_stock' : needsConfirmation ? 'needs_confirmation' : 'ok',
      };
    });

    const count = (s) => result.filter((i) => i.status === s).length;
    return {
      cartId,
      items: result,
      summary: {
        totalPaise: result.reduce((sum, i) => sum + i.totalPaise * i.qty, 0),
        needsConfirmation: count('needs_confirmation'),
        outOfStock: count('out_of_stock'),
        canCheckout: result.length > 0 && result.every((i) => i.status === 'ok'),
      },
    };
  }

  // Atomically take stock. The conditional UPDATE row-locks the product; a concurrent buyer
  // waits, then re-checks `stock >= qty` against the committed value and gets 0 rows.
  async function takeStock(db, productId, qty) {
    const { rowCount } = await db.query(
      'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2',
      [productId, qty],
    );
    if (!rowCount) throw new HttpError(409, 'OUT_OF_STOCK', 'Sorry, this piece just sold out.', { productId });
  }

  async function insertOrder(db, lines, t) {
    const total = lines.reduce((sum, l) => sum + l.total_paise * l.qty, 0);
    const { rows: [order] } = await db.query(
      'INSERT INTO orders (total_paise, created_at) VALUES ($1, $2) RETURNING id',
      [total, t],
    );
    for (const l of lines) {
      await db.query(
        `INSERT INTO order_items (order_id, product_id, purity, size_label, qty, total_paise, breakdown)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [order.id, l.product_id, l.purity, l.size_label, l.qty, l.total_paise, l.breakdown],
      );
    }
    return { orderId: order.id, totalPaise: total };
  }

  // ---- Routes ---------------------------------------------------------------

  app.get('/api/rates', h(async (req, res) => {
    const { rows } = await pool.query('SELECT metal, rate_paise, updated_at FROM metal_rates ORDER BY metal');
    res.json(rows.map((r) => ({ metal: r.metal, ratePaise: r.rate_paise, updatedAt: r.updated_at })));
  }));

  // Demo-only: change a live rate (no auth). Lets reviewers see price changes without waiting.
  app.put('/api/rates/:metal', h(async (req, res) => {
    const ratePaise = req.body?.ratePaise;
    if (!Number.isInteger(ratePaise) || ratePaise <= 0) throw new HttpError(400, 'BAD_REQUEST', 'ratePaise must be a positive integer');
    const { rowCount } = await pool.query(
      'UPDATE metal_rates SET rate_paise = $2, updated_at = $3 WHERE metal = $1',
      [req.params.metal, ratePaise, now()],
    );
    if (!rowCount) throw new HttpError(404, 'NOT_FOUND', 'Unknown metal');
    res.json({ metal: req.params.metal, ratePaise });
  }));

  app.get('/api/products', h(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT p.*, r.rate_paise FROM products p JOIN metal_rates r USING (metal) ORDER BY p.id',
    );
    res.json(rows.map(toProduct));
  }));

  app.get('/api/products/:id', h(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(404, 'NOT_FOUND', 'Product not found');
    res.json(toProduct(await loadProduct(pool, id)));
  }));

  app.post('/api/quotes', h(async (req, res) => {
    const { productId, purity, size } = req.body ?? {};
    if (!Number.isInteger(productId)) throw new HttpError(400, 'BAD_REQUEST', 'productId is required');
    res.status(201).json(await createQuote(pool, productId, purity, size));
  }));

  app.get('/api/cart/:cartId', h(async (req, res) => {
    requireUuid(req.params.cartId, 'cartId');
    res.json(await getCart(req.params.cartId));
  }));

  app.post('/api/cart/:cartId/items', h(async (req, res) => {
    const { cartId } = req.params;
    const { quoteId } = req.body ?? {};
    requireUuid(cartId, 'cartId');
    requireUuid(quoteId, 'quoteId');
    const t = now();

    const { rows: [q] } = await pool.query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
    if (!q) throw new HttpError(404, 'NOT_FOUND', 'Quote not found');
    if (q.expires_at <= t) {
      const quote = await createQuote(pool, q.product_id, q.purity, q.size_label);
      throw new HttpError(409, 'PRICE_EXPIRED', 'Your price lock expired. Please review the latest price.', {
        quote, previousTotalPaise: q.total_paise,
      });
    }

    const { rows: [s] } = await pool.query(
      `SELECT p.stock, COALESCE((SELECT SUM(qty) FROM cart_items WHERE cart_id = $1 AND product_id = p.id), 0)::int AS in_cart
       FROM products p WHERE p.id = $2`,
      [cartId, q.product_id],
    );
    if (s.stock < s.in_cart + 1) {
      throw new HttpError(409, 'OUT_OF_STOCK', s.stock === 0 ? 'This piece is out of stock.' : `Only ${s.stock} left and already in your cart.`);
    }

    await pool.query(
      `INSERT INTO cart_items (cart_id, product_id, purity, size_label, added_total_paise, total_paise, breakdown, locked_until, created_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)`,
      [cartId, q.product_id, q.purity, q.size_label, q.total_paise, q.breakdown, lockFrom(t), t],
    );
    res.status(201).json(await getCart(cartId));
  }));

  app.post('/api/cart/:cartId/items/:itemId/accept', h(async (req, res) => {
    const { cartId, itemId } = req.params;
    requireUuid(cartId, 'cartId');
    requireUuid(itemId, 'itemId');
    const expected = req.body?.expectedTotalPaise;
    // Only accept the exact price the customer saw, and only while it is still held.
    const { rowCount } = await pool.query(
      `UPDATE cart_items SET total_paise = pending_total_paise, breakdown = pending_breakdown, locked_until = pending_until,
         pending_total_paise = NULL, pending_breakdown = NULL, pending_until = NULL, change = NULL, prev_total_paise = NULL
       WHERE id = $1 AND cart_id = $2 AND pending_total_paise = $3 AND pending_until > $4`,
      [itemId, cartId, expected, now()],
    );
    if (!rowCount) throw new HttpError(409, 'PRICE_CHANGED', 'The price changed again. Please review it.');
    res.json(await getCart(cartId));
  }));

  app.delete('/api/cart/:cartId/items/:itemId', h(async (req, res) => {
    const { cartId, itemId } = req.params;
    requireUuid(cartId, 'cartId');
    requireUuid(itemId, 'itemId');
    await pool.query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2', [itemId, cartId]);
    res.json(await getCart(cartId));
  }));

  // Body: { cartId, items: [{ id, totalPaise }] } — the prices the customer is looking at.
  app.post('/api/checkout', h(async (req, res) => {
    const { cartId, items: seen } = req.body ?? {};
    requireUuid(cartId, 'cartId');
    if (!Array.isArray(seen)) throw new HttpError(400, 'BAD_REQUEST', 'items is required');

    const order = await tx(pool, async (db) => {
      const t = now();
      const { rows } = await db.query(
        'SELECT * FROM cart_items WHERE cart_id = $1 ORDER BY seq FOR UPDATE',
        [cartId],
      );
      if (!rows.length) throw new HttpError(400, 'EMPTY_CART', 'Your cart is empty.');

      const seenPrice = new Map(seen.map((i) => [i.id, i.totalPaise]));
      if (seenPrice.size !== rows.length || rows.some((r) => !seenPrice.has(r.id))) {
        throw new HttpError(409, 'CART_CHANGED', 'Your cart changed. Please review it.');
      }
      for (const r of rows) {
        if (r.pending_total_paise !== null) throw new HttpError(409, 'PRICE_CONFIRMATION_REQUIRED', 'Please confirm the updated prices first.');
        if (r.locked_until <= t) throw new HttpError(409, 'PRICE_EXPIRED', 'A price lock expired. Please review the latest prices.');
        if (seenPrice.get(r.id) !== r.total_paise) throw new HttpError(409, 'PRICE_CHANGED', 'A price changed. Please review it.');
      }

      const qtyByProduct = new Map();
      for (const r of rows) qtyByProduct.set(r.product_id, (qtyByProduct.get(r.product_id) ?? 0) + r.qty);
      // Lock products in id order so two multi-item checkouts can't deadlock.
      for (const [productId, qty] of [...qtyByProduct].sort((a, b) => a[0] - b[0])) {
        await takeStock(db, productId, qty);
      }

      const result = await insertOrder(db, rows, t);
      await db.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
      return result;
    });
    res.status(201).json(order);
  }));

  // Body: { quoteId } — buy the single piece at the quoted (locked) price.
  app.post('/api/buy-now', h(async (req, res) => {
    const { quoteId } = req.body ?? {};
    requireUuid(quoteId, 'quoteId');
    let stale;
    try {
      const order = await tx(pool, async (db) => {
        const t = now();
        // Claim the quote only if it is unused and still locked (also stops double-clicks).
        const { rows: [q] } = await db.query(
          'UPDATE quotes SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND expires_at > $2 RETURNING *',
          [quoteId, t],
        );
        if (!q) {
          const { rows: [old] } = await db.query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
          if (!old) throw new HttpError(404, 'NOT_FOUND', 'Quote not found');
          if (old.used_at) throw new HttpError(409, 'QUOTE_USED', 'This price was already used for an order.');
          stale = old;
          throw new HttpError(409, 'PRICE_EXPIRED', 'Your price lock expired. Please review the latest price.');
        }
        await takeStock(db, q.product_id, 1);
        return insertOrder(db, [{ ...q, qty: 1 }], t);
      });
      res.status(201).json(order);
    } catch (err) {
      if (stale) {
        err.extra = {
          quote: await createQuote(pool, stale.product_id, stale.purity, stale.size_label),
          previousTotalPaise: stale.total_paise,
        };
      }
      throw err;
    }
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' }));

  if (webDist) {
    app.use(express.static(webDist));
    app.get('*', (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'Invalid JSON' });
    }
    console.error(err);
    res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong' });
  });

  return app;
}
