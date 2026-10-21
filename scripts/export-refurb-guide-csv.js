// Writes exports/refurb-guide-rates-template.csv: every refurb line item
// (category, item, unit) with blank low / typical / high columns, to send
// to builders. The "ref" column is the item's key in refurb-guide-rates.js,
// so filled-in figures can be copied back to the right line.
//
// Run: node scripts/export-refurb-guide-csv.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'refurb-totals.js'), 'utf8') + ';this.SECTIONS = REFURB_SECTIONS;', ctx);

const cell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const rows = [['category', 'item', 'unit', 'low', 'typical', 'high', 'ref']];
ctx.SECTIONS.forEach(s => s.items.forEach(it => rows.push([s.name, it.label, it.unit, '', '', '', s.id + '.' + it.id])));

const out = path.join(root, 'exports', 'refurb-guide-rates-template.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
// BOM so Excel opens the £ and ² characters correctly.
fs.writeFileSync(out, '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n');
console.log('Wrote ' + (rows.length - 1) + ' items to ' + path.relative(root, out));
