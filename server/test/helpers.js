import pg from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate, seedIfEmpty } from '../src/db.js';

export const MIN = 60_000;
export const SEC = 1000;
export const P = { band: 1, pendant: 2, platinum: 3, anklet: 4 }; // seed product ids

const url = process.env.TEST_DATABASE_URL || 'postgres://jewel:jewel@localhost:5433/jewellery_test';

/** Fresh schema + seed, a controllable clock, and a supertest agent per test file. */
export function useTestApp() {
  const pool = new pg.Pool({ connectionString: url, max: 30 });
  const clock = { t: null, advance(ms) { this.t = new Date(this.t.getTime() + ms); } };
  const app = createApp({ pool, now: () => clock.t });
  const api = () => request(app);

  async function reset() {
    clock.t = new Date('2026-01-01T10:00:00Z');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
    await seedIfEmpty(pool);
  }

  const setRate = (metal, ratePaise) =>
    pool.query('UPDATE metal_rates SET rate_paise = $2 WHERE metal = $1', [metal, ratePaise]);

  async function quote(productId, purity, size) {
    const res = await api().post('/api/quotes').send({ productId, purity, size }).expect(201);
    return res.body;
  }

  async function addToCart(cartId, productId, purity, size) {
    const q = await quote(productId, purity, size);
    const res = await api().post(`/api/cart/${cartId}/items`).send({ quoteId: q.id }).expect(201);
    return res.body;
  }

  const getCart = async (cartId) => (await api().get(`/api/cart/${cartId}`).expect(200)).body;

  const checkout = (cart) =>
    api().post('/api/checkout').send({
      cartId: cart.cartId,
      items: cart.items.map((i) => ({ id: i.id, totalPaise: i.totalPaise })),
    });

  return { pool, clock, api, reset, setRate, quote, addToCart, getCart, checkout };
}
