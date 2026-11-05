import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MIN, P, useTestApp } from './helpers.js';

const t = useTestApp();
beforeEach(t.reset);
afterAll(() => t.pool.end());

const BAND_22K_S12 = 3242275; // at ₹7,500/g

describe('cart price changes after the lock expires', () => {
  it('price went down → applied automatically with a note', async () => {
    const cartId = randomUUID();
    await t.addToCart(cartId, P.band, '22K', 'Size 12');
    await t.setRate('gold', 740000);
    t.clock.advance(10 * MIN);

    const cart = await t.getCart(cartId);
    const item = cart.items[0];
    expect(item).toMatchObject({ status: 'ok', change: 'down', previousTotalPaise: BAND_22K_S12, addedTotalPaise: BAND_22K_S12 });
    expect(item.totalPaise).toBeLessThan(BAND_22K_S12);
    expect(cart.summary.canCheckout).toBe(true);

    const order = await t.checkout(cart).expect(201);
    expect(order.body.totalPaise).toBe(item.totalPaise);
  });

  it('price stayed the same → re-locked, marked unchanged', async () => {
    const cartId = randomUUID();
    await t.addToCart(cartId, P.band, '22K', 'Size 12');
    t.clock.advance(11 * MIN);
    const item = (await t.getCart(cartId)).items[0];
    expect(item).toMatchObject({ status: 'ok', change: 'same', totalPaise: BAND_22K_S12 });
    expect(new Date(item.lockedUntil) - t.clock.t).toBe(10 * MIN);
  });

  it('price went up → needs confirmation, checkout blocked until accepted', async () => {
    const cartId = randomUUID();
    await t.addToCart(cartId, P.band, '22K', 'Size 12');
    await t.addToCart(cartId, P.anklet, '925', '9 inch');
    await t.setRate('gold', 760000);
    t.clock.advance(10 * MIN);

    let cart = await t.getCart(cartId);
    const [band, anklet] = cart.items;
    expect(band.status).toBe('needs_confirmation');
    expect(band.totalPaise).toBe(BAND_22K_S12); // old price still shown (struck through in UI)
    expect(band.pending.totalPaise).toBeGreaterThan(BAND_22K_S12);
    expect(anklet).toMatchObject({ status: 'ok', change: 'same' }); // silver unchanged
    expect(cart.summary).toMatchObject({ needsConfirmation: 1, canCheckout: false });

    const blocked = await t.checkout(cart).expect(409);
    expect(blocked.body.error).toBe('PRICE_CONFIRMATION_REQUIRED');

    // Accepting a price other than the one shown is refused.
    await t.api().post(`/api/cart/${cartId}/items/${band.id}/accept`).send({ expectedTotalPaise: band.pending.totalPaise - 1 }).expect(409);

    cart = (await t.api().post(`/api/cart/${cartId}/items/${band.id}/accept`).send({ expectedTotalPaise: band.pending.totalPaise }).expect(200)).body;
    expect(cart.items[0]).toMatchObject({ status: 'ok', totalPaise: band.pending.totalPaise, pending: null });
    expect(cart.summary.canCheckout).toBe(true);

    const order = await t.checkout(cart).expect(201);
    expect(order.body.totalPaise).toBe(band.pending.totalPaise + anklet.totalPaise);
  });

  it('cannot accept a higher price after its own hold has expired', async () => {
    const cartId = randomUUID();
    await t.addToCart(cartId, P.band, '22K', 'Size 12');
    await t.setRate('gold', 760000);
    t.clock.advance(10 * MIN);
    const band = (await t.getCart(cartId)).items[0];
    t.clock.advance(10 * MIN);
    await t.api().post(`/api/cart/${cartId}/items/${band.id}/accept`).send({ expectedTotalPaise: band.pending.totalPaise }).expect(409);
  });

  it('item sold elsewhere → out of stock, checkout disabled', async () => {
    const mine = randomUUID();
    const theirs = randomUUID();
    await t.addToCart(mine, P.platinum, '950', 'Size 12');
    const theirCart = await t.addToCart(theirs, P.platinum, '950', 'Size 12');
    await t.checkout(theirCart).expect(201);

    const cart = await t.getCart(mine);
    expect(cart.items[0].status).toBe('out_of_stock');
    expect(cart.summary).toMatchObject({ outOfStock: 1, canCheckout: false });
    expect((await t.checkout(cart).expect(409)).body.error).toBe('OUT_OF_STOCK');
  });

  it('cannot add more units than are in stock', async () => {
    const cartId = randomUUID();
    await t.addToCart(cartId, P.platinum, '950', 'Size 12');
    const q = await t.quote(P.platinum, '950', 'Size 10');
    const res = await t.api().post(`/api/cart/${cartId}/items`).send({ quoteId: q.id }).expect(409);
    expect(res.body.error).toBe('OUT_OF_STOCK');
  });

  it('checkout refuses a total different from the one the customer saw', async () => {
    const cart = await t.addToCart(randomUUID(), P.band, '22K', 'Size 12');
    cart.items[0].totalPaise -= 100;
    expect((await t.checkout(cart).expect(409)).body.error).toBe('PRICE_CHANGED');
  });
});
