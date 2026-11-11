const W = 600;
const H = 120;

export default function ProblemsChart({ values, label }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v) => H - (v / max) * (H - 4) - 2;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = pts.length ? `M${pts.join(" L")}` : "";
  const area = pts.length ? `${line} L${W},${H} L0,${H} Z` : "";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={H}
      role="img"
      aria-label={label}
    >
      <path d={area} fill="var(--bs-success)" fillOpacity={0.25} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="var(--bs-success)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
