import pg from 'pg';
import { createApp } from './app.js';
import { migrate, seedIfEmpty } from './db.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await migrate(pool);
await seedIfEmpty(pool);

const app = createApp({
  pool,
  lockMs: (Number(process.env.LOCK_SECONDS) || 600) * 1000,
  webDist: process.env.WEB_DIST,
});
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Jewellery configurator on http://localhost:${port}`));
