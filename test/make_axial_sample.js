// Writes a radially symmetric sample: many vertical angles, one horizontal plane.
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/core.js');

const doc = {
  name: 'Axial sample',
  maker: 'Penumbra',
  symmetry: 'axial',
  output: { mode: 'peak', peak: 6000, watts: 10 },
  layers: [{ id: 1, type: 'sliders', enabled: true, blend: 'normal', gain: 0, mix: 1, step: 10, spikes: 0, c90: null, c0: [1, 0.98, 0.9, 0.62, 0.2, 0.03, 0, 0, 0, 0] }],
};
const text = P.writeIES(doc, P.composite(doc));
const out = path.join(__dirname, 'axial_sample.ies');
fs.writeFileSync(out, text);
const parsed = P.parseIES(text);
console.log(out, `${Math.round(text.length / 1024)} KB`, `${parsed.v.length} vertical x ${parsed.h.length} horizontal`, `horizontal angles: ${parsed.h}`);
