import { useCallback, useEffect, useState } from 'react';
import { api, cartId, inr } from './api.js';
import CartPage from './CartPage.jsx';
import ProductPage from './ProductPage.jsx';
import { purityLabel } from './ui.jsx';

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => { setHash(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function useRates() {
  const [rates, setRates] = useState([]);
  const load = useCallback(() => api('/rates').then(setRates).catch(() => {}), []);
  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);
  return [rates, load];
}

function ProductList() {
  const [products, setProducts] = useState(null);
  useEffect(() => { api('/products').then(setProducts).catch(() => setProducts([])); }, []);
  if (!products) return <p className="muted">Loading…</p>;
  return (
    <>
      <h1 className="page-title">Live-rate jewellery</h1>
      <p className="muted lede">Prices follow today’s metal rate. Every price is locked for 10 minutes once you see it.</p>
      <ul className="grid">
        {products.map((p) => (
          <li key={p.id}>
            <a className="card" href={`#/product/${p.id}`}>
              <div className={`swatch ${p.metal}`} aria-hidden="true" />
              <h2>{p.name}</h2>
              <p className="muted">{p.purities.map((x) => purityLabel(x.code)).join(' · ')}{p.stones.length > 0 && ' · with stones'}</p>
              <p className={`stock ${p.stock <= 1 ? 'low' : ''}`}>
                {p.stock === 0 ? 'Sold out' : p.stock === 1 ? 'Only 1 left' : `${p.stock} in stock`}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function RateDemo({ rates, onChange }) {
  const [busy, setBusy] = useState(false);
  async function nudge(metal, ratePaise, pct) {
    setBusy(true);
    try {
      await api(`/rates/${metal}`, { method: 'PUT', body: { ratePaise: Math.round(ratePaise * (1 + pct / 100)) } });
      await onChange();
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="demo">
      <summary>Demo: move the live rate</summary>
      <p className="muted">Changes apply to new quotes now, and to cart items when their lock expires.</p>
      {rates.map((r) => (
        <div key={r.metal} className="demo-row">
          <span>{r.metal} {inr(r.ratePaise)}/g</span>
          <button disabled={busy} onClick={() => nudge(r.metal, r.ratePaise, -2)}>−2%</button>
          <button disabled={busy} onClick={() => nudge(r.metal, r.ratePaise, 2)}>+2%</button>
        </div>
      ))}
    </details>
  );
}

export default function App() {
  const hash = useHash();
  const [rates, reloadRates] = useRates();
  const [count, setCount] = useState(0);
  const refreshCount = useCallback(
    () => api(`/cart/${cartId()}`).then((c) => setCount(c.items.length)).catch(() => {}),
    [],
  );
  useEffect(() => { refreshCount(); }, [refreshCount]);

  const product = hash.match(/^#\/product\/(\d+)/);
  let page;
  if (product) page = <ProductPage key={product[1]} id={Number(product[1])} onCartChange={refreshCount} />;
  else if (hash === '#/cart') page = <CartPage onCount={setCount} />;
  else page = <ProductList />;

  return (
    <>
      <header className="top">
        <a href="#/" className="brand">Aurum<span>Live</span></a>
        <ul className="rates" aria-label="Live metal rates per gram (fine)">
          {rates.map((r) => (
            <li key={r.metal}><span>{r.metal}</span> {inr(r.ratePaise)}/g</li>
          ))}
        </ul>
        <a href="#/cart" className="cart-link">Cart{count > 0 && <span className="badge">{count}</span>}</a>
      </header>
      <main>{page}</main>
      <footer>
        <RateDemo rates={rates} onChange={reloadRates} />
      </footer>
    </>
  );
}
