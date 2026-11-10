const W = 120;
const H = 24;
const PAD = 2;

// Inline SVG polyline; null samples break the line into separate segments.
export default function Sparkline({ values = [], variant = "secondary" }) {
  const nums = values.filter((v) => v !== null && v !== undefined);
  if (nums.length === 0) {
    return <svg width={W} height={H} role="img" aria-label="No latency data" />;
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = values.length > 1 ? (W - 2 * PAD) / (values.length - 1) : 0;
  const y = (v) => (max === min ? H / 2 : H - PAD - ((v - min) / span) * (H - 2 * PAD));

  const segments = [];
  let current = [];
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(`${(PAD + i * step).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (current.length) segments.push(current);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Latency history, ${nums.length} samples`}
      className={`text-${variant}`}
    >
      {segments.map((pts, i) =>
        pts.length === 1 ? (
          <circle key={i} cx={pts[0].split(",")[0]} cy={pts[0].split(",")[1]} r="1.5" fill="currentColor" />
        ) : (
          <polyline key={i} points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" />
        ),
      )}
    </svg>
  );
}
