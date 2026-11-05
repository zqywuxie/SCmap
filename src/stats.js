/** Cell-weighted single-gene and V+J counts; codes 0/1 are missing/ambiguous. */
export function summarize(attrs, indices, stride, subtypeField, locusField, subtypeCount, gene,
  partnerField = null, partnerGene = null) {
  const totals = new Uint32Array(subtypeCount), valid = new Uint32Array(subtypeCount);
  const carriers = new Uint32Array(subtypeCount), missing = new Uint32Array(subtypeCount);
  const ambiguous = new Uint32Array(subtypeCount);
  let validTotal = 0, carrierTotal = 0, missingTotal = 0, ambiguousTotal = 0;
  for (const index of indices) {
    const subtype = attrs[index * stride + subtypeField], call = attrs[index * stride + locusField];
    const other = partnerField === null ? 2 : attrs[index * stride + partnerField];
    totals[subtype]++;
    if (call === 0 || other === 0) { missing[subtype]++; missingTotal++; }
    else if (call === 1 || other === 1) { ambiguous[subtype]++; ambiguousTotal++; }
    else {
      valid[subtype]++; validTotal++;
      if (gene !== null && call === gene && (partnerField === null || other === partnerGene)) {
        carriers[subtype]++; carrierTotal++;
      }
    }
  }
  return { totals, valid, carriers, missing, ambiguous, validTotal, carrierTotal, missingTotal, ambiguousTotal };
}

export function percent(value) {
  return value === null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

/** Count every gene (or same-cell V+J pair) before applying the selected gene. */
export function subtypeGeneCounts(attrs, indices, stride, subtypeField, subtype,
  locusField, partnerField = null) {
  const counts = new Map();
  let subtypeCells = 0, subtypeValid = 0, subtypeMissing = 0, subtypeAmbiguous = 0, validAll = 0;
  for (const index of indices) {
    const base = index * stride, inSubtype = attrs[base + subtypeField] === subtype;
    const gene = attrs[base + locusField];
    const partner = partnerField === null ? null : attrs[base + partnerField];
    if (inSubtype) subtypeCells++;
    if (gene === 0 || partner === 0) { if (inSubtype) subtypeMissing++; continue; }
    if (gene === 1 || partner === 1) { if (inSubtype) subtypeAmbiguous++; continue; }
    validAll++;
    if (inSubtype) subtypeValid++;
    const key = partnerField === null ? gene : gene * 65536 + partner;
    let row = counts.get(key);
    if (!row) { row = { gene, partner, carriers: 0, allCarriers: 0 }; counts.set(key, row); }
    row.allCarriers++;
    if (inSubtype) row.carriers++;
  }
  const rows = [...counts.values()].filter((r) => r.carriers > 0).map((r) => ({ ...r,
    usage: r.carriers / subtypeValid, subtypeShare: r.carriers / r.allCarriers }));
  return { subtypeCells, subtypeValid, subtypeMissing, subtypeAmbiguous, validAll, rows };
}

export function sortGeneRanks(rows, metric = 'usage') {
  const field = metric === 'subtypeShare' ? 'subtypeShare' : 'usage';
  return [...rows].sort((a, b) => b[field] - a[field] || b.carriers - a.carriers ||
    a.gene - b.gene || (a.partner ?? -1) - (b.partner ?? -1));
}
