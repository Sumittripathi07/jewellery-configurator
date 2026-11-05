import { readFile } from 'node:fs/promises';

const sql = (name) => readFile(new URL(`../db/${name}`, import.meta.url), 'utf8');

export async function migrate(pool) {
  await pool.query(await sql('schema.sql'));
}

export async function seedIfEmpty(pool) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM products');
  if (rows[0].n === 0) await pool.query(await sql('seed.sql'));
}

export async function tx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
