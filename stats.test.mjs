import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, percent, subtypeGeneCounts, sortGeneRanks, summarizePatients } from './src/stats.js';

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

test('patient support deduplicates cells and samples, separates studies, and accounts for unknown identities', () => {
  // subtype, V, J. Keys encode study*65536 + individual + 1; 0 means missing identity.
  const attrs = new Uint16Array([0,2,2, 0,2,2, 0,2,2, 1,2,2, 0,2,2, 0,2,3, 0,0,2]);
  const keys = new Uint32Array([1,1,65537,2,0,3,4]);
  const indices = Uint32Array.from({ length: 7 }, (_, i) => i);
  const patients = summarizePatients(attrs, indices, 3, 0, 1, 2, 2, keys, 2, 2);
  assert.equal(patients.rows.length, 3);
  assert.equal(patients.rows[0].key, 1);
  assert.equal(patients.rows[0].cells, 2);
  assert.equal(patients.unknownCells, 1);
  assert.deepEqual(patients.bySubtype[0], { carrierPatients: 2, allCarrierPatients: 3,
    topPatientCells: 2, topPatientShare: 0.5, unknownPatientCells: 1, allUnknownPatientCells: 1 });
  const rank = subtypeGeneCounts(attrs, indices, 3, 0, 0, 1, 2, keys).rows.find(r => r.gene === 2 && r.partner === 2);
  assert.equal(rank.carriers, 4);
  assert.equal(rank.allCarriers, 5);
  assert.equal(rank.subtypeShare, 0.8);
  assert.equal(rank.carrierPatients, 2);
  assert.equal(rank.allCarrierPatients, 3);
  assert.equal(rank.topPatientShare, 0.5);
  assert.equal(rank.unknownPatientCells, 1);
  assert.equal(rank.allUnknownPatientCells, 1);
  const empty = summarizePatients(attrs, indices, 3, 0, 1, 2, null, keys, 2, 2);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.bySubtype[0].topPatientShare, null);
});

test('the same cell percentage can have one or several contributing patients', () => {
  const attrs = new Uint16Array([0,2, 0,2, 0,2, 0,2, 1,2]);
  const indices = new Uint32Array([0,1,2,3,4]);
  const one = subtypeGeneCounts(attrs, indices, 2, 0, 0, 1, null, new Uint32Array([1,1,1,1,2])).rows[0];
  const many = subtypeGeneCounts(attrs, indices, 2, 0, 0, 1, null, new Uint32Array([1,2,3,4,5])).rows[0];
  assert.equal(one.subtypeShare, many.subtypeShare);
  assert.equal(one.carrierPatients, 1);
  assert.equal(one.topPatientShare, 1);
  assert.equal(many.carrierPatients, 4);
  assert.equal(many.topPatientShare, 0.25);
  const subset = summarizePatients(attrs, new Uint32Array([2,3]), 2, 0, 1, 2, 2, new Uint32Array([1,2,3,4,5]));
  assert.equal(subset.rows.length, 2);
  assert.equal(subset.bySubtype[0].topPatientShare, 0.5);
});
