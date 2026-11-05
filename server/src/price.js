// Pure price calculation. All money is integer paise; weight is integer milligrams.
// Rates are per gram of fine (pure) metal; purity is a per-mille fineness factor.

export const PURITIES = {
  gold: { '24K': 999, '22K': 916, '18K': 750, '14K': 585 },
  silver: { 999: 999, 925: 925 },
  platinum: { 950: 950 },
};

export const GST_BP = 300; // 3% in basis points

// Integer division rounded half-up (inputs are non-negative integers, d is even).
export const divRound = (n, d) => Math.floor((n + d / 2) / d);

export function calculatePrice({ metal, ratePaise, purity, weightMg, wastageBp, makingType, makingValue, stones = [] }) {
  const purityPermille = PURITIES[metal]?.[purity];
  if (!purityPermille) throw new Error(`Unknown purity ${purity} for ${metal}`);

  const raw = ratePaise * purityPermille * weightMg;
  if (!Number.isSafeInteger(raw)) throw new Error('Price overflow');

  const metalValue = divRound(raw, 1_000_000); // permille * mg->g
  const wastage = divRound(metalValue * wastageBp, 10_000);
  const making =
    makingType === 'per_gram'
      ? divRound(makingValue * weightMg, 1000)
      : divRound(metalValue * makingValue, 10_000); // 'percent' in basis points of metal value
  const stoneLines = stones.map((s) => ({ ...s, total: s.count * s.pricePaise }));
  const stonesTotal = stoneLines.reduce((sum, s) => sum + s.total, 0);
  const subtotal = metalValue + wastage + making + stonesTotal;
  const gst = divRound(subtotal * GST_BP, 10_000);

  return {
    metal, purity, purityPermille, weightMg, ratePaise,
    metalValue, wastageBp, wastage, makingType, makingValue, making,
    stones: stoneLines, stonesTotal, subtotal, gstBp: GST_BP, gst,
    total: subtotal + gst,
  };
}
