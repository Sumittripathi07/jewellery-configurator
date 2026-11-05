import { describe, expect, it } from 'vitest';
import { calculatePrice, divRound } from '../src/price.js';

// Expected values below are worked out by hand (see README "Rounding").
describe('calculatePrice', () => {
  it('gold band 22K, 4.000 g, making ₹450/g, wastage 8%', () => {
    const p = calculatePrice({
      metal: 'gold', ratePaise: 750000, purity: '22K', weightMg: 4000,
      wastageBp: 800, makingType: 'per_gram', makingValue: 45000,
    });
    // metal   7500 × 0.916 × 4      = 27,480.00
    // wastage 27,480 × 8%           =  2,198.40
    // making  450 × 4               =  1,800.00
    // subtotal                      = 31,478.40
    // GST 3% = 944.352 → 944.35
    // total                         = 32,422.75
    expect(p).toMatchObject({
      metalValue: 2748000, wastage: 219840, making: 180000, stonesTotal: 0,
      subtotal: 3147840, gst: 94435, total: 3242275,
    });
  });

  it('diamond pendant 18K, 3.250 g, making 12%, wastage 10%, with stones', () => {
    const p = calculatePrice({
      metal: 'gold', ratePaise: 750000, purity: '18K', weightMg: 3250,
      wastageBp: 1000, makingType: 'percent', makingValue: 1200,
      stones: [
        { name: 'Diamond', count: 12, pricePaise: 125050 },
        { name: 'Ruby', count: 1, pricePaise: 349999 },
      ],
    });
    // metal   7500 × 0.750 × 3.25   = 18,281.25
    // wastage 10% = 1,828.125       →  1,828.13 (half-up)
    // making  12%                   =  2,193.75
    // stones  12 × 1,250.50 + 3,499.99 = 18,505.99
    // subtotal                      = 40,809.12
    // GST 3% = 1,224.2736           →  1,224.27
    // total                         = 42,033.39
    expect(p).toMatchObject({
      metalValue: 1828125, wastage: 182813, making: 219375, stonesTotal: 1850599,
      subtotal: 4080912, gst: 122427, total: 4203339,
    });
    expect(p.stones.map((s) => s.total)).toEqual([1500600, 349999]);
  });

  it('platinum 950, 6.000 g, making ₹900/g, wastage 5%', () => {
    const p = calculatePrice({
      metal: 'platinum', ratePaise: 320000, purity: '950', weightMg: 6000,
      wastageBp: 500, makingType: 'per_gram', makingValue: 90000,
    });
    // 18,240.00 + 912.00 + 5,400.00 = 24,552.00; GST 736.56; total 25,288.56
    expect(p).toMatchObject({ metalValue: 1824000, wastage: 91200, making: 540000, gst: 73656, total: 2528856 });
  });

  it('breakdown lines always add up to the total', () => {
    const p = calculatePrice({
      metal: 'silver', ratePaise: 9537, purity: '925', weightMg: 20123,
      wastageBp: 650, makingType: 'percent', makingValue: 833,
    });
    expect(p.metalValue + p.wastage + p.making + p.stonesTotal + p.gst).toBe(p.total);
  });

  it('rounds half-up', () => {
    expect(divRound(5, 10)).toBe(1);
    expect(divRound(4, 10)).toBe(0);
    expect(divRound(15, 10)).toBe(2);
  });

  it('rejects a purity the metal does not have', () => {
    expect(() => calculatePrice({ metal: 'silver', ratePaise: 1, purity: '22K', weightMg: 1 })).toThrow(/purity/);
  });
});
