const format = value => value.toLocaleString('en-US');
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function cloneDistributions(attributes, indices, stride, subtypeField, units, sizes, subtypes, weighting) {
  const groups = new Map(subtypes.map(subtype => [subtype.code,
    { ...subtype, cells: 0, expanded: 0, units: new Set(), histogram: new Map() }]));
  let excluded = 0;
  for (const index of indices) {
    const size = sizes[index], unit = units[index];
    if (!size || !unit) { excluded++; continue; }
    const group = groups.get(attributes[index * stride + subtypeField]);
    group.cells++;
    if (size >= 2) group.expanded++;
    const first = !group.units.has(unit);
    group.units.add(unit);
    if (weighting === 'cells' || first) group.histogram.set(size, (group.histogram.get(size) || 0) + 1);
  }
  return { groups: [...groups.values()], excluded };
}

export function ridgeDensity(histogram, maximumLog, bandwidth, points = 241) {
  const values = Array.from({ length: points }, (_, index) => ({ x: index * maximumLog / (points - 1), y: 0 }));
  for (const [size, count] of histogram) {
    const center = Math.log10(size);
    for (const point of values) {
      // Reflection at log10(size)=0 keeps the singleton peak inside the observed domain.
      point.y += count * (Math.exp(-0.5 * ((point.x - center) / bandwidth) ** 2)
        + Math.exp(-0.5 * ((point.x + center) / bandwidth) ** 2));
    }
  }
  const peak = Math.max(...values.map(point => point.y));
  return values.map(point => ({ x: point.x, y: peak ? point.y / peak : 0 }));
}

export function renderCloneRidges(container, distribution, weighting, bandwidth) {
  const groups = distribution.groups;
  let maximum = 1;
  for (const group of groups) for (const size of group.histogram.keys()) maximum = Math.max(maximum, size);
  const maximumLog = Math.max(1, Math.ceil(Math.log10(maximum) + 0.05));
  const width = 1000, left = 185, right = 80, top = 50, step = 66;
  const bottom = top + groups.length * step, height = bottom + 75;
  const x = value => left + value / maximumLog * (width - left - right);
  const parts = [`<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="clone-svg-title clone-svg-desc"><title id="clone-svg-title">各细胞亚型的克隆大小分布</title><desc id="clone-svg-desc">横轴为样本内克隆细胞数的对数刻度。每行峰值归一，颜色表示细胞亚型。精确计数见下方表格。</desc>`];
  for (let tick = 0; tick <= maximumLog; tick++) {
    parts.push(`<line x1="${x(tick)}" x2="${x(tick)}" y1="20" y2="${bottom}" stroke="#e3e9df" stroke-dasharray="3 5"/><text x="${x(tick)}" y="${bottom + 26}" text-anchor="middle" class="ridge-tick">${format(10 ** tick)}</text>`);
  }
  groups.forEach((group, index) => {
    const baseline = top + index * step;
    const density = ridgeDensity(group.histogram, maximumLog, bandwidth);
    const curve = density.map(point => `${x(point.x).toFixed(2)},${(baseline - point.y * 43).toFixed(2)}`).join(' L');
    parts.push(`<line x1="${left}" x2="${width - right}" y1="${baseline}" y2="${baseline}" stroke="#9eafa0"/><text x="${left - 15}" y="${baseline - 7}" text-anchor="end" class="ridge-label">${escape(group.label)}</text>`);
    if (group.cells) parts.push(`<path d="M${left},${baseline} L${curve} L${width-right},${baseline} Z" fill="${group.color}" fill-opacity="0.7" stroke="${group.color}" stroke-width="1.5"><title>${escape(group.label)} · ${format(group.cells)} 个细胞 · ${format(group.units.size)} 个样本内克隆单元</title></path>`);
    else parts.push(`<text x="${left + 10}" y="${baseline - 7}" class="ridge-tick">当前范围无可用细胞</text>`);
    parts.push(`<text x="${width - right + 12}" y="${baseline - 7}" class="ridge-tick">${format(weighting === 'cells' ? group.cells : group.units.size)}</text>`);
  });
  parts.push(`<text x="${width-right+12}" y="20" class="ridge-tick">${weighting === 'cells' ? '细胞数' : '单元数'}</text><text x="${(left+width-right)/2}" y="${height-10}" text-anchor="middle" class="ridge-axis">样本内克隆大小（细胞数，log₁₀ 刻度）</text></svg>`);
  container.innerHTML = parts.join('');
}
