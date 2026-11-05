import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { P, useTestApp } from './helpers.js';

const t = useTestApp();
beforeEach(t.reset);
afterAll(() => t.pool.end());

const stockOf = async (id) => (await t.pool.query('SELECT stock FROM products WHERE id = $1', [id])).rows[0].stock;
const orderCount = async () => (await t.pool.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;

async function waitForLockWaiters(n) {
  for (let i = 0; i < 200; i++) {
    const { rows } = await t.pool.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0].n >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`expected ${n} transactions waiting on a lock`);
}

describe('last unit, two buyers at the same time', () => {
  it('both checkouts are in flight together; exactly one succeeds', async () => {
    // Two customers each have the only Platinum Eternity Ring (stock 1) in their cart.
    const a = await t.addToCart(randomUUID(), P.platinum, '950', 'Size 12');
    const b = await t.addToCart(randomUUID(), P.platinum, '950', 'Size 12');

    // Hold the product row so both checkouts are provably inside their transactions,
    // blocked on the same row, before either can commit.
    const blocker = await t.pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [P.platinum]);

    const both = Promise.all([t.checkout(a).then((r) => r), t.checkout(b).then((r) => r)]);
    await waitForLockWaiters(2);
    await blocker.query('ROLLBACK');
    blocker.release();

    const statuses = (await both).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = (await both).find((r) => r.status === 409);
    expect(loser.body.error).toBe('OUT_OF_STOCK');
    expect(await stockOf(P.platinum)).toBe(0);
    expect(await orderCount()).toBe(1);
  });

  it('20 simultaneous checkouts for one unit → exactly one order', async () => {
    const carts = [];
    for (let i = 0; i < 20; i++) carts.push(await t.addToCart(randomUUID(), P.platinum, '950', 'Size 12'));

    const results = await Promise.all(carts.map((c) => t.checkout(c).then((r) => r)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.error === 'OUT_OF_STOCK')).toHaveLength(19);
    expect(await stockOf(P.platinum)).toBe(0);
    expect(await orderCount()).toBe(1);
  });

  it('20 simultaneous Buy now clicks for one unit → exactly one order', async () => {
    const quotes = [];
    for (let i = 0; i < 20; i++) quotes.push(await t.quote(P.platinum, '950', 'Size 10'));

    const results = await Promise.all(
      quotes.map((q) => t.api().post('/api/buy-now').send({ quoteId: q.id }).then((r) => r)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(19);
    expect(await stockOf(P.platinum)).toBe(0);
    expect(await orderCount()).toBe(1);
  });
});
