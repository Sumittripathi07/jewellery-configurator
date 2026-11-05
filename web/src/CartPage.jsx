import { useCallback, useEffect, useState } from 'react';
import { api, cartId, inr } from './api.js';
import { Breakdown, Countdown, Notice, purityLabel } from './ui.jsx';

function CartItem({ item, busy, onAccept, onRemove, onExpire }) {
  const { pending, outOfStock, change } = item;
  return (
    <li className={`item ${item.status}`}>
      <div className="item-head">
        <div>
          <h3>{item.name}</h3>
          <p className="muted">{purityLabel(item.purity)} · {item.size}{item.qty > 1 && ` · qty ${item.qty}`}</p>
          <p className="muted small">Added at {inr(item.addedTotalPaise)}</p>
        </div>
        <div className="item-price">
          {pending ? (
            <><s>{inr(item.totalPaise)}</s> <strong>{inr(pending.totalPaise)}</strong></>
          ) : change === 'down' ? (
            <><s>{inr(item.previousTotalPaise)}</s> <strong>{inr(item.totalPaise)}</strong></>
          ) : (
            <strong>{inr(item.totalPaise)}</strong>
          )}
          {!outOfStock && (
            <Countdown
              until={pending ? pending.until : item.lockedUntil}
              label={pending ? 'New price held for' : 'Price locked for'}
              onExpire={onExpire}
            />
          )}
        </div>
      </div>

      {outOfStock && <p className="notice error">This piece is now out of stock. Remove it to check out.</p>}
      {!outOfStock && pending && (
        <div className="notice warn">
          <span>The live rate went up after your price lock ended: {inr(item.totalPaise)} → {inr(pending.totalPaise)}.</span>
          <button className="btn small" disabled={busy} onClick={onAccept}>Accept new price</button>
        </div>
      )}
      {!outOfStock && !pending && change === 'down' && (
        <p className="notice ok">Price dropped from {inr(item.previousTotalPaise)} to {inr(item.totalPaise)} — the lower price was applied automatically.</p>
      )}
      {!outOfStock && !pending && change === 'same' && (
        <p className="notice info">Price re-checked at the live rate — unchanged.</p>
      )}

      <div className="item-foot">
        <details>
          <summary>Price breakdown</summary>
          <Breakdown b={pending?.breakdown ?? item.breakdown} />
        </details>
        <button className="link" disabled={busy} onClick={onRemove}>Remove</button>
      </div>
    </li>
  );
}

export default function CartPage({ onCount }) {
  const [cart, setCart] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState(null);

  const show = useCallback((c) => { setCart(c); onCount(c.items.length); }, [onCount]);
  const load = useCallback(
    () => api(`/cart/${cartId()}`).then(show).catch((e) => setNotice({ kind: 'error', text: e.message })),
    [show],
  );

  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  // Small delay so the server clock is safely past the lock end before re-pricing.
  const onExpire = useCallback(() => setTimeout(load, 800), [load]);

  async function run(fn) {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ kind: 'error', text: e.message });
      load();
    } finally {
      setBusy(false);
    }
  }

  const base = `/cart/${cartId()}/items`;
  const accept = (item) => run(async () =>
    show(await api(`${base}/${item.id}/accept`, { method: 'POST', body: { expectedTotalPaise: item.pending.totalPaise } })));
  const remove = (item) => run(async () => show(await api(`${base}/${item.id}`, { method: 'DELETE' })));
  const checkout = () => run(async () => {
    const o = await api('/checkout', {
      method: 'POST',
      body: { cartId: cartId(), items: cart.items.map((i) => ({ id: i.id, totalPaise: i.totalPaise })) },
    });
    setOrder(o);
    onCount(0);
  });

  if (order) {
    return (
      <section className="done">
        <h1>Order placed</h1>
        <p className="big">{inr(order.totalPaise)}</p>
        <p className="muted">Order {order.orderId.slice(0, 8)} — charged exactly the prices you confirmed.</p>
        <a className="btn" href="#/">Continue shopping</a>
      </section>
    );
  }
  if (!cart) return <><Notice notice={notice} /><p className="muted">Loading…</p></>;
  if (!cart.items.length) {
    return (
      <section className="done">
        <h1>Your cart is empty</h1>
        <a className="btn" href="#/">Browse pieces</a>
      </section>
    );
  }

  const { summary } = cart;
  const ifAccepted = summary.totalPaise + cart.items.reduce(
    (sum, i) => sum + (i.pending && !i.outOfStock ? (i.pending.totalPaise - i.totalPaise) * i.qty : 0), 0);
  const blockedReason = summary.outOfStock
    ? 'Remove out-of-stock items to check out.'
    : summary.needsConfirmation
      ? 'Confirm the updated prices to check out.'
      : null;

  return (
    <div className="cart">
      <section>
        <h1 className="page-title">Your cart</h1>
        <ul className="items">
          {cart.items.map((item) => (
            <CartItem
              key={item.id}
              item={item}
              busy={busy}
              onAccept={() => accept(item)}
              onRemove={() => remove(item)}
              onExpire={onExpire}
            />
          ))}
        </ul>
      </section>

      <aside className="summary">
        <h2>Summary</h2>
        <div className="row"><span>Items</span><span>{cart.items.length}</span></div>
        <div className="row total"><span>Total <small>incl. 3% GST</small></span><span>{inr(summary.totalPaise)}</span></div>
        {summary.needsConfirmation > 0 && (
          <p className="notice warn">
            {summary.needsConfirmation} {summary.needsConfirmation === 1 ? 'item needs' : 'items need'} price confirmation.
            {' '}Total becomes {inr(ifAccepted)} once accepted.
          </p>
        )}
        {summary.outOfStock > 0 && (
          <p className="notice error">{summary.outOfStock} {summary.outOfStock === 1 ? 'item is' : 'items are'} out of stock.</p>
        )}
        <button className="btn block" disabled={!summary.canCheckout || busy} onClick={checkout}>
          Checkout · {inr(summary.totalPaise)}
        </button>
        {blockedReason && <p className="muted small">{blockedReason}</p>}
        <Notice notice={notice} />
      </aside>
    </div>
  );
}
