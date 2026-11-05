export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    Object.assign(err, data, { status: res.status, message: err.message });
    throw err;
  }
  return data;
}

const fmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const inr = (paise) => fmt.format(paise / 100);
export const grams = (mg) => `${(mg / 1000).toFixed(3)} g`;

export function cartId() {
  let id = null;
  try { id = localStorage.getItem('cartId'); } catch { /* storage blocked */ }
  if (!id) {
    id = crypto.randomUUID();
    try { localStorage.setItem('cartId', id); } catch { /* cart lasts this tab only */ }
  }
  return id;
}

/** Message for a re-priced item: up / down / same. */
export function changeText(before, after) {
  if (after > before) return { kind: 'warn', text: `Price went up from ${inr(before)} to ${inr(after)}.` };
  if (after < before) return { kind: 'ok', text: `Good news — price dropped from ${inr(before)} to ${inr(after)}.` };
  return { kind: 'info', text: `Price re-checked at the live rate: unchanged at ${inr(after)}.` };
}
