import { useCallback, useEffect, useRef, useState } from 'react';
import { api, cartId, changeText, grams, inr } from './api.js';
import { Breakdown, Countdown, Notice, purityLabel } from './ui.jsx';

export default function ProductPage({ id, onCartChange }) {
  const [product, setProduct] = useState(null);
  const [purity, setPurity] = useState(null);
  const [size, setSize] = useState(null);
  const [quote, setQuote] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(null);
  const quoteRef = useRef(null);
  const latest = useRef(0); // ignore out-of-order quote responses

  const showQuote = (q) => { quoteRef.current = q; setQuote(q); };

  useEffect(() => {
    api(`/products/${id}`)
      .then((p) => { setProduct(p); setPurity(p.purities[0].code); setSize(p.sizes[0].label); })
      .catch((e) => setNotice({ kind: 'error', text: e.message }));
  }, [id]);

  const requote = useCallback(async (afterExpiry = false) => {
    const n = ++latest.current;
    try {
      const q = await api('/quotes', { method: 'POST', body: { productId: id, purity, size } });
      if (n !== latest.current) return;
      const prev = quoteRef.current;
      if (afterExpiry && prev) {
        const c = changeText(prev.totalPaise, q.totalPaise);
        setNotice({ kind: c.kind, text: `Your price lock ended. ${c.text} The new price is locked.` });
      }
      showQuote(q);
    } catch (e) {
      if (n === latest.current) setNotice({ kind: 'error', text: e.message });
    }
  }, [id, purity, size]);

  useEffect(() => {
    if (purity && size) requote();
  }, [purity, size, requote]);

  async function act(kind) {
    setBusy(true);
    setNotice(null);
    try {
      if (kind === 'cart') {
        await api(`/cart/${cartId()}/items`, { method: 'POST', body: { quoteId: quote.id } });
        setNotice({ kind: 'ok', text: `Added to cart at ${inr(quote.totalPaise)} — price locked in your cart.` });
        onCartChange();
      } else {
        setOrder(await api('/buy-now', { method: 'POST', body: { quoteId: quote.id } }));
        requote(); // refresh stock
      }
    } catch (e) {
      if (e.error === 'PRICE_EXPIRED') {
        const c = changeText(e.previousTotalPaise, e.quote.totalPaise);
        setNotice({ kind: 'warn', text: `Your price lock expired. ${c.text} Please review and try again.` });
        showQuote(e.quote);
      } else {
        setNotice({ kind: 'error', text: e.message });
        requote(); // pick up current stock / a fresh single-use quote
      }
    } finally {
      setBusy(false);
    }
  }

  if (!product) return notice ? <Notice notice={notice} /> : <p className="muted">Loading…</p>;

  const stock = quote?.stock ?? product.stock;
  const soldOut = stock === 0;

  if (order) {
    return (
      <section className="done">
        <h1>Order placed</h1>
        <p>{product.name} — {purityLabel(purity)}, {size}</p>
        <p className="big">{inr(order.totalPaise)}</p>
        <p className="muted">Order {order.orderId.slice(0, 8)}</p>
        <a className="btn" href="#/">Continue shopping</a>
      </section>
    );
  }

  return (
    <article className="product">
      <div className={`visual swatch ${product.metal}`} aria-hidden="true" />
      <div className="config">
        <a href="#/" className="back">← All pieces</a>
        <h1>{product.name}</h1>
        <p className="muted">{product.description}</p>
        <p className={`stock ${stock <= 1 ? 'low' : ''}`}>
          {soldOut ? 'Sold out' : stock === 1 ? 'Only 1 left' : `${stock} in stock`}
        </p>

        <fieldset>
          <legend>Purity</legend>
          <div className="chips">
            {product.purities.map((p) => (
              <button key={p.code} type="button" aria-pressed={purity === p.code} onClick={() => setPurity(p.code)}>
                {purityLabel(p.code)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Size / weight</legend>
          <div className="chips">
            {product.sizes.map((s) => (
              <button key={s.label} type="button" aria-pressed={size === s.label} onClick={() => setSize(s.label)}>
                {s.label} <small>{grams(s.weightMg)}</small>
              </button>
            ))}
          </div>
        </fieldset>

        {quote && (
          <section className="price" aria-live="polite">
            <div className="price-head">
              <span className="big">{inr(quote.totalPaise)}</span>
              <Countdown key={quote.id} until={quote.expiresAt} onExpire={() => requote(true)} />
            </div>
            <Breakdown b={quote.breakdown} />
          </section>
        )}

        <div className="actions">
          <button className="btn secondary" disabled={!quote || busy || soldOut} onClick={() => act('cart')}>Add to cart</button>
          <button className="btn" disabled={!quote || busy || soldOut} onClick={() => act('buy')}>Buy now</button>
        </div>
        <Notice notice={notice} />
      </div>
    </article>
  );
}
