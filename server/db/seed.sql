-- Rates per gram of fine metal, in paise: gold ₹7,500, silver ₹95, platinum ₹3,200.
INSERT INTO metal_rates (metal, rate_paise) VALUES
  ('gold', 750000), ('silver', 9500), ('platinum', 320000);

INSERT INTO products (name, description, metal, purities, sizes, wastage_bp, making_type, making_value, stones, stock) VALUES
(
  'Classic Gold Band',
  'A plain polished band. Making charge ₹450/g, wastage 8%.',
  'gold', '{22K,18K}',
  '[{"label":"Size 10","weightMg":3500},{"label":"Size 12","weightMg":4000},{"label":"Size 14","weightMg":4500}]',
  800, 'per_gram', 45000, '[]', 5
),
(
  'Diamond Halo Pendant',
  'Ruby centre stone in a halo of 12 diamonds. Making charge 12% of metal, wastage 10%.',
  'gold', '{18K,14K}',
  '[{"label":"Petite","weightMg":3250},{"label":"Classic","weightMg":5000}]',
  1000, 'percent', 1200,
  '[{"name":"Diamond 0.05 ct","count":12,"pricePaise":125050},{"name":"Ruby centre stone","count":1,"pricePaise":349999}]',
  3
),
(
  'Platinum Eternity Ring',
  'One-of-a-kind Pt 950 ring. Making charge ₹900/g, wastage 5%.',
  'platinum', '{950}',
  '[{"label":"Size 10","weightMg":5500},{"label":"Size 12","weightMg":6000}]',
  500, 'per_gram', 90000, '[]', 1
),
(
  'Sterling Silver Anklet',
  'Ghungroo anklet. Making charge 8% of metal, wastage 6%.',
  'silver', '{925,999}',
  '[{"label":"9 inch","weightMg":20000},{"label":"10 inch","weightMg":30000}]',
  600, 'percent', 800, '[]', 10
);
