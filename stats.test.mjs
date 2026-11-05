import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, percent, subtypeGeneCounts, sortGeneRanks } from './src/stats.js';

test('carrier rates exclude missing and ambiguous calls; composition has its own denominator', () => {
  // subtype, locus: subtype 0 has 2 carriers, 1 other, 1 missing, 1 ambiguous.
  // subtype 1 has 1 carrier, 3 other; subtype 2 has missing calls only.
  const attrs = new Uint16Array([0,2, 0,2, 0,3, 0,0, 0,1, 1,2, 1,3, 1,3, 1,3, 2,0]);
  const all = Uint32Array.from({ length: 10 }, (_, i) => i);
  const s = summarize(attrs, all, 2, 0, 1, 3, 2);
  assert.deepEqual(Array.from(s.totals), [5, 4, 1]);
  assert.deepEqual(Array.from(s.valid), [3, 4, 0]);
  assert.deepEqual(Array.from(s.carriers), [2, 1, 0]);
  assert.equal(s.validTotal, 7); assert.equal(s.carrierTotal, 3);
  assert.equal(s.missingTotal, 2); assert.equal(s.ambiguousTotal, 1);
  assert.equal(percent(s.carriers[0] / s.valid[0]), '66.7%');
  assert.equal(percent(s.carriers[1] / s.carrierTotal), '33.3%');
  assert.equal(percent(s.carriers[2] / s.valid[2]), '—');
});

test('filters count only selected cells; no selection is distinct from zero carriers', () => {
  const attrs = new Uint16Array([0,2, 0,3, 1,2]);
  const subset = new Uint32Array([1, 2]);
  const s = summarize(attrs, subset, 2, 0, 1, 2, 3);
  assert.deepEqual(Array.from(s.carriers), [1, 0]); assert.equal(s.carrierTotal, 1);
  assert.equal(summarize(attrs, subset, 2, 0, 1, 2, null).carrierTotal, 0);
  const empty = summarize(attrs, new Uint32Array(), 2, 0, 1, 2, 2);
  assert.equal(empty.validTotal, 0); assert.equal(percent(null), '—');
});

test('V+J requires the same cell to carry both genes; denominator requires both calls', () => {
  // subtype,V,J. V-only and J-only carriers must not count as the combination.
  const attrs = new Uint16Array([0,2,2, 0,2,3, 0,3,2, 0,2,0, 0,1,2, 1,2,2, 1,0,1]);
  const indices = Uint32Array.from({length:7}, (_, i) => i);
  const s = summarize(attrs, indices, 3, 0, 1, 2, 2, 2, 2);
  assert.deepEqual(Array.from(s.valid), [3,1]);
  assert.deepEqual(Array.from(s.carriers), [1,1]);
  assert.equal(s.carrierTotal,2); assert.equal(s.validTotal,4);
  assert.equal(s.missingTotal,2); assert.equal(s.ambiguousTotal,1);
  assert.equal(percent(s.carriers[0]/s.valid[0]),'33.3%');
  assert.equal(summarize(attrs, indices, 3, 0, 1, 2, 2, 2, null).carrierTotal,0);
});

test('subtype-to-gene ranking separates within-subtype usage from carrier concentration', () => {
  const attrs = new Uint16Array([0,2, 0,3, 0,3, 0,0, 0,1, 1,3, 1,3, 1,3]);
  const all = Uint32Array.from({length:8}, (_, i) => i);
  const counts = subtypeGeneCounts(attrs, all, 2, 0, 0, 1);
  assert.equal(counts.subtypeCells,5); assert.equal(counts.subtypeValid,3);
  assert.equal(counts.subtypeMissing,1); assert.equal(counts.subtypeAmbiguous,1);
  assert.equal(counts.validAll,6);
  assert.deepEqual(sortGeneRanks(counts.rows,'usage').map(r=>r.gene),[3,2]);
  assert.deepEqual(sortGeneRanks(counts.rows,'subtypeShare').map(r=>r.gene),[2,3]);
  const rare = counts.rows.find(r=>r.gene===2);
  assert.equal(rare.carriers,1); assert.equal(rare.allCarriers,1);
  assert.equal(rare.subtypeShare,1); assert.equal(rare.usage,1/3);
  const filtered = subtypeGeneCounts(attrs,new Uint32Array([0,1,2]),2,0,0,1);
  assert.equal(filtered.rows.find(r=>r.gene===3).allCarriers,2);
  assert.equal(filtered.rows.find(r=>r.gene===3).subtypeShare,1);
  assert.equal(subtypeGeneCounts(attrs,all,2,0,9,1).rows.length,0);
});

test('subtype pair ranking counts observed same-cell pairs and both-valid denominators', () => {
  const attrs = new Uint16Array([0,2,2, 0,2,3, 0,3,2, 0,2,2, 0,2,0, 0,1,2, 0,0,1, 1,2,2, 1,3,2]);
  const all = Uint32Array.from({length:9},(_,i)=>i);
  const counts = subtypeGeneCounts(attrs,all,3,0,0,1,2);
  assert.equal(counts.subtypeCells,7); assert.equal(counts.subtypeValid,4);
  assert.equal(counts.subtypeMissing,2); assert.equal(counts.subtypeAmbiguous,1);
  const ranked = sortGeneRanks(counts.rows);
  assert.deepEqual(ranked.map(r=>[r.gene,r.partner,r.carriers,r.allCarriers]),[[2,2,2,3],[2,3,1,1],[3,2,1,2]]);
  assert.equal(ranked[0].usage,0.5); assert.equal(ranked[0].subtypeShare,2/3);
  assert.equal(counts.rows.some(r=>r.gene===3&&r.partner===3),false);
});
