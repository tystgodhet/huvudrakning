/* SVG chart rendering (string output, caller inserts into the DOM). */

/**
 * Dual-line session chart: accuracy % (blue, fixed 0–100 scale) and
 * seconds per problem (amber, auto-scaled).
 * @param {object[]} data sessions [{acc, avg}], oldest first
 * @returns {string} svg markup, or "" when there is no data
 */
export function sessionChartSVG(data) {
  if (!data.length) return "";
  const W = 480;
  const H = 170;
  const P = 26;
  const n = data.length;
  const x = (i) => (n === 1 ? W / 2 : P + (i * (W - 2 * P)) / (n - 1));
  const maxAvg = Math.max(4, ...data.map((d) => d.avg || 0));
  const yAcc = (v) => H - P - (v / 100) * (H - 2 * P);
  const ySpd = (v) => H - P - (v / maxAvg) * (H - 2 * P);
  const accPts = data.map((d, i) => `${x(i)},${yAcc(d.acc)}`).join(" ");
  const spdPts = data.map((d, i) => `${x(i)},${ySpd(d.avg || 0)}`).join(" ");
  const dotsAcc = data.map((d, i) => `<circle cx="${x(i)}" cy="${yAcc(d.acc)}" r="4" fill="#2B50E0"/>`).join("");
  const dotsSpd = data.map((d, i) => `<circle cx="${x(i)}" cy="${ySpd(d.avg || 0)}" r="4" fill="#FFC53D"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#D8DEE9" stroke-width="1.5"/>
    <line x1="${P}" y1="${yAcc(100)}" x2="${W - P}" y2="${yAcc(100)}" stroke="#D8DEE9" stroke-dasharray="4 4"/>
    <text x="${P}" y="${yAcc(100) - 6}" font-size="11" fill="#6B7390">100%</text>
    ${n > 1 ? `<polyline points="${accPts}" fill="none" stroke="#2B50E0" stroke-width="3" stroke-linejoin="round"/>` : ""}
    ${n > 1 ? `<polyline points="${spdPts}" fill="none" stroke="#FFC53D" stroke-width="3" stroke-linejoin="round"/>` : ""}
    ${dotsAcc}${dotsSpd}
  </svg>`;
}
