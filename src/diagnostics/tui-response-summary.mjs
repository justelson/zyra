export function formatTuiResponseTimings(rows) {
  const recent = rows.filter(row => row.outcome === 'completed').slice(0, 20);
  const median = key => {
    const values = recent.map(row => row[key]).filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) return 'not observed';
    const middle = Math.floor(values.length / 2);
    return `${((values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2) / 1000).toFixed(2)} s`;
  };
  return ['Response timings', `  ${rows.length} recorded, latest ${recent.length} completed`,
    `  First text received: ${median('firstTextReceivedMs')}`, `  First terminal write: ${median('firstDisplayMs')}`,
    '  Always local. Up to 200 turns, 2 MiB. Sharing follows /analytics.', '  /diagnostics json shows recorded stages.'];
}
