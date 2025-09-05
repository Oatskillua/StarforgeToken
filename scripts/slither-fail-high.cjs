// scripts/slither-fail-high.cjs
const fs = require('fs');
const path = process.argv[2] || 'reports/slither.filtered.json';
const j = JSON.parse(fs.readFileSync(path,'utf8'));
const dets = (j.results && j.results.detectors) || [];
let highMine = 0, highTotal = 0;
for (const d of dets) {
  const sev = (d.impact || '').toLowerCase();
  if (sev !== 'high') continue;
  highTotal++;
  const locs = d.elements || d.expressions || d.events || d.functions || d.variables || d.operations || [];
  const inMyCode = locs.some(loc => {
    const sm = (loc.source_mapping || {});
    const f = sm.filename_relative || sm.filename_absolute || loc.filename_relative || '';
    return typeof f === 'string' && f.startsWith('contracts/');
  });
  if (inMyCode) highMine++;
}
if (highMine > 0) {
  console.error(`High findings in project code: ${highMine} (total High incl. deps: ${highTotal})`);
  process.exit(1);
}
console.log(`OK: 0 High in project code (deps High=${highTotal})`);
