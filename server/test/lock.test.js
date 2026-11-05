import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MIN, P, SEC, useTestApp } from './helpers.js';

const t = useTestApp();
beforeEach(t.reset);
afterAll(() => t.pool.end());

describe('price lock (10 minutes)', () => {
  it('quote API returns the hand-calculated price and a 10-minute lock', async () => {
    const q = await t.quote(P.band, '22K', 'Size 12');
    expect(q.totalPaise).toBe(3242275);
    expect(new Date(q.expiresAt) - t.clock.t).toBe(10 * MIN);
  });

  it('a quote can be added to the cart at 9:59 but not at 10:00', async () => {
    const q1 = await t.quote(P.band, '22K', 'Size 12');
    t.clock.advance(10 * MIN - SEC);
    await t.api().post(`/api/cart/${randomUUID()}/items`).send({ quoteId: q1.id }).expect(201);

    const q2 = await t.quote(P.band, '22K', 'Size 12');
    await t.setRate('gold', 760000);
    t.clock.advance(10 * MIN);
    const res = await t.api().post(`/api/cart/${randomUUID()}/items`).send({ quoteId: q2.id }).expect(409);
    expect(res.body.error).toBe('PRICE_EXPIRED');
    expect(res.body.previousTotalPaise).toBe(3242275);
    expect(res.body.quote.totalPaise).toBeGreaterThan(3242275); // fresh quote at the new rate
  });

  it('adding to cart restarts the lock; the cart price holds until it expires', async () => {
    const cartId = randomUUID();
    await t.quote(P.band, '22K', 'Size 12');
    t.clock.advance(5 * MIN); // viewed 5 min ago, quote still valid
    const cart = await t.addToCart(cartId, P.band, '22K', 'Size 12');
    expect(new Date(cart.items[0].lockedUntil) - t.clock.t).toBe(10 * MIN);

    await t.setRate('gold', 800000);
    t.clock.advance(10 * MIN - SEC);
    expect((await t.getCart(cartId)).items[0]).toMatchObject({ status: 'ok', totalPaise: 3242275, pending: null });

    t.clock.advance(SEC);
    expect((await t.getCart(cartId)).items[0].status).toBe('needs_confirmation');
  });

  it('checkout is refused once a lock has expired, even before the cart is refreshed', async () => {
    const cartId = randomUUID();
    const cart = await t.addToCart(cartId, P.band, '22K', 'Size 12');
    t.clock.advance(10 * MIN);
    const res = await t.checkout(cart).expect(409);
    expect(res.body.error).toBe('PRICE_EXPIRED');
  });

  it('Buy now: success inside the lock, PRICE_EXPIRED with a fresh quote after it', async () => {
    const q = await t.quote(P.band, '18K', 'Size 10');
    t.clock.advance(10 * MIN);
    const expired = await t.api().post('/api/buy-now').send({ quoteId: q.id }).expect(409);
    expect(expired.body).toMatchObject({ error: 'PRICE_EXPIRED', previousTotalPaise: q.totalPaise });

    const ok = await t.api().post('/api/buy-now').send({ quoteId: expired.body.quote.id }).expect(201);
    expect(ok.body.totalPaise).toBe(expired.body.quote.totalPaise);

    const again = await t.api().post('/api/buy-now').send({ quoteId: expired.body.quote.id }).expect(409);
    expect(again.body.error).toBe('QUOTE_USED');
  });

  it('Buy now on a sold-out piece returns OUT_OF_STOCK', async () => {
    await t.pool.query('UPDATE products SET stock = 0 WHERE id = $1', [P.platinum]);
    const q = await t.quote(P.platinum, '950', 'Size 12');
    const res = await t.api().post('/api/buy-now').send({ quoteId: q.id }).expect(409);
    expect(res.body.error).toBe('OUT_OF_STOCK');
  });
});
