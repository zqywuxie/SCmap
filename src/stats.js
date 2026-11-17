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
  locusField, partnerField = null, patientKeys = null) {
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
    if (!row) {
      row = { gene, partner, carriers: 0, allCarriers: 0 };
      if (patientKeys) Object.assign(row, { patientSet: new Set(), patientCounts: new Map(),
        topPatientCells: 0, unknownPatientCells: 0, allUnknownPatientCells: 0 });
      counts.set(key, row);
    }
    row.allCarriers++;
    if (inSubtype) row.carriers++;
    if (patientKeys) {
      const patient = patientKeys[index];
      if (patient) {
        row.patientSet.add(patient);
        if (inSubtype) {
          const count = (row.patientCounts.get(patient) || 0) + 1;
          row.patientCounts.set(patient, count);
          row.topPatientCells = Math.max(row.topPatientCells, count);
        }
      } else {
        row.allUnknownPatientCells++;
        if (inSubtype) row.unknownPatientCells++;
      }
    }
  }
  const rows = [...counts.values()].filter((r) => r.carriers > 0).map((r) => {
    const { patientSet, patientCounts, ...row } = r;
    if (patientKeys) Object.assign(row, { carrierPatients: patientCounts.size,
      allCarrierPatients: patientSet.size, topPatientShare: row.topPatientCells / row.carriers });
    return { ...row, usage: r.carriers / subtypeValid, subtypeShare: r.carriers / r.allCarriers };
  });
  return { subtypeCells, subtypeValid, subtypeMissing, subtypeAmbiguous, validAll, rows };
}

/** Patient support for the current gene, preserving its cell-weighted denominators. */
export function summarizePatients(attrs, indices, stride, subtypeField, locusField,
  subtypeCount, gene, patientKeys, partnerField = null, partnerGene = null) {
  const patients = new Map();
  const subtypePatients = Array.from({ length: subtypeCount }, () => new Map());
  const carriers = new Uint32Array(subtypeCount);
  const unknown = new Uint32Array(subtypeCount);
  for (const index of indices) {
    const base = index * stride, call = attrs[base + locusField];
    if (gene === null || call < 2 || call !== gene) continue;
    if (partnerField !== null && (attrs[base + partnerField] < 2 || attrs[base + partnerField] !== partnerGene)) continue;
    const subtype = attrs[base + subtypeField], key = patientKeys[index];
    carriers[subtype]++;
    if (!key) { unknown[subtype]++; continue; }
    let patient = patients.get(key);
    if (!patient) {
      patient = { key, cells: 0, subtypes: new Uint32Array(subtypeCount) };
      patients.set(key, patient);
    }
    patient.cells++;
    patient.subtypes[subtype]++;
    const counts = subtypePatients[subtype];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rows = [...patients.values()].sort((a, b) => b.cells - a.cells || a.key - b.key);
  const unknownCells = unknown.reduce((sum, n) => sum + n, 0);
  const bySubtype = subtypePatients.map((counts, subtype) => {
    let maximum = 0;
    for (const count of counts.values()) maximum = Math.max(maximum, count);
    return { carrierPatients: counts.size, allCarrierPatients: rows.length,
      topPatientCells: maximum, topPatientShare: carriers[subtype] ? maximum / carriers[subtype] : null,
      unknownPatientCells: unknown[subtype], allUnknownPatientCells: unknownCells };
  });
  return { rows, bySubtype, unknownCells };
}

export function sortGeneRanks(rows, metric = 'usage') {
  const field = metric === 'subtypeShare' ? 'subtypeShare' : 'usage';
  return [...rows].sort((a, b) => b[field] - a[field] || b.carriers - a.carriers ||
    a.gene - b.gene || (a.partner ?? -1) - (b.partner ?? -1));
}
