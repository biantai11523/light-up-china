// Rendering categories are independent of the unit the user can select.
// Foreign subdivisions and Chinese prefectures share the close-up tier.
export const PREFECTURE = 0;
export const PROVINCE = 1;
export const COUNTRY = 2;
export const NO_BORDER = 255;

export function meshLayout(atlas) {
  const regions = atlas.regions.length;
  const provinces = atlas.provinces.length;
  const edges = new Uint8Array(regions + provinces + atlas.countries.length);
  const counts = new Map();
  for (const row of atlas.regions) counts.set(row[3], (counts.get(row[3]) || 0) + 1);
  atlas.regions.forEach(([id, , , country, province], i) => {
    if (country === 'CHN') edges[i] = province === id ? NO_BORDER : PREFECTURE;
    else edges[i] = counts.get(country) === 1 ? NO_BORDER : PREFECTURE;
  });
  edges.fill(PROVINCE, regions, regions + provinces);
  edges.fill(COUNTRY, regions + provinces);
  return { regions, provinces, edges };
}

// Radius is measured in CSS pixels, so phones with different pixel ratios
// reveal the same information at the same map scale. Fades work in both directions.
function fade(radius, start, end) {
  if (radius <= start) return 0;
  if (radius >= end) return 1;
  const t = Math.log(radius / start) / Math.log(end / start);
  return t * t * (3 - 2 * t);
}

export const lineStyles = [
  { name: 'prefecture', color: '#7f8977', width: .62 },
  { name: 'province', color: '#586851', width: .92 },
  { name: 'country', color: '#3e493e', width: 1.12 }
];

export function boundaryOpacity(frame) {
  return [
    .68 * fade(frame.radius, 1590, 3500),
    .78 * fade(frame.radius, 365, 930),
    .88
  ];
}
