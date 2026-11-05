import { useEffect, useRef, useState } from 'react';
import { grams, inr } from './api.js';

const left = (until) => Math.max(0, new Date(until) - Date.now());

/** Countdown to `until`; calls onExpire once when it reaches zero. */
export function Countdown({ until, onExpire, label = 'Price locked for' }) {
  const [ms, setMs] = useState(() => left(until));
  const cb = useRef(onExpire);
  cb.current = onExpire;

  useEffect(() => {
    let fired = false;
    const tick = () => {
      const l = left(until);
      setMs(l);
      if (l === 0 && !fired) {
        fired = true;
        cb.current?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);

  const s = Math.ceil(ms / 1000);
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <span className={`countdown ${s <= 60 ? 'urgent' : ''}`} role="timer" aria-live="off">
      {s > 0 ? <>{label} <b>{text}</b></> : 'Re-checking live price…'}
    </span>
  );
}

const PURITY_LABEL = { '24K': '24K', '22K': '22K', '18K': '18K', '14K': '14K', 925: 'Sterling 925', 999: 'Fine 999', 950: 'Pt 950' };
export const purityLabel = (code) => PURITY_LABEL[code] ?? code;

export function Breakdown({ b }) {
  const metalName = b.metal[0].toUpperCase() + b.metal.slice(1);
  const making = b.makingType === 'per_gram'
    ? `${inr(b.makingValue)}/g`
    : `${b.makingValue / 100}% of metal`;
  return (
    <table className="breakdown">
      <tbody>
        <tr>
          <th>
            {metalName} value
            <small>{inr(b.ratePaise)}/g × {(b.purityPermille / 10).toFixed(1)}% × {grams(b.weightMg)}</small>
          </th>
          <td>{inr(b.metalValue)}</td>
        </tr>
        <tr><th>Wastage <small>{b.wastageBp / 100}% of metal</small></th><td>{inr(b.wastage)}</td></tr>
        <tr><th>Making charges <small>{making}</small></th><td>{inr(b.making)}</td></tr>
        {b.stones.map((s) => (
          <tr key={s.name}>
            <th>{s.name} <small>{s.count} × {inr(s.pricePaise)}</small></th>
            <td>{inr(s.total)}</td>
          </tr>
        ))}
        <tr className="sub"><th>Subtotal</th><td>{inr(b.subtotal)}</td></tr>
        <tr><th>GST <small>{b.gstBp / 100}%</small></th><td>{inr(b.gst)}</td></tr>
        <tr className="total"><th>Total</th><td>{inr(b.total)}</td></tr>
      </tbody>
    </table>
  );
}

export function Notice({ notice }) {
  if (!notice) return null;
  return <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>;
}
