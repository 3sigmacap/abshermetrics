/** AbsherMetrics palette + static club specs, mirrored from the web app. */
export const C = {
  bg: '#070d0a',
  bg2: '#0b1410',
  panel: '#0e1a14',
  line: '#1d3327',
  line2: '#26432f',
  ink: '#e8f3ec',
  dim: '#8aa596',
  dim2: '#5e7568',
  accent: '#d4ff4f', // lime
  accent2: '#7fd4ff', // cyan
  bad: '#ff9d9d',
};

// Loft is a club spec, not derivable from shot data.
export const LOFT: Record<string, string> = {
  '3 Wood': '15°',
  '3 Iron': '20°',
  '4 Iron': '23°',
  '5 Iron': '26°',
  '6 Iron': '30°',
  '7 Iron': '34°',
  '8 Iron': '39°',
  '9 Iron': '42.5°',
  'Pitching Wedge': '47°',
  'Gap Wedge': '52°',
  'Sand Wedge': '56°',
};

// Editorial two-way-miss flag (matches index.html).
export const RED = new Set(['3 Wood', 'Gap Wedge']);

export const ABBR: Record<string, string> = {
  '3 Wood': '3W',
  'Pitching Wedge': 'PW',
  'Gap Wedge': 'GW',
  'Sand Wedge': 'SW',
};
