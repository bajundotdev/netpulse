const PATHS = {
  dc: (
    <>
      <rect x="3" y="3" width="10" height="4" rx="1" />
      <rect x="3" y="9" width="10" height="4" rx="1" />
      <path d="M5 5h.01M5 11h.01" />
    </>
  ),
  server: (
    <>
      <rect x="2.5" y="2.5" width="11" height="4" rx="1" />
      <rect x="2.5" y="9.5" width="11" height="4" rx="1" />
      <path d="M5 4.5h.01M5 11.5h.01M8 6.5v3" />
    </>
  ),
  switch: (
    <>
      <rect x="1.5" y="5" width="13" height="6" rx="1" />
      <path d="M4 8h.01M6.5 8h.01M9 8h.01M11.5 8h.01" />
    </>
  ),
  printer: (
    <>
      <path d="M4.5 6V2.5h7V6" />
      <rect x="2" y="6" width="12" height="5" rx="1" />
      <rect x="4.5" y="9.5" width="7" height="4" />
    </>
  ),
  other: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 7.5v3M8 5.5h.01" />
    </>
  ),
};

export default function KindIcon({ kind }) {
  return (
    <span
      className="border rounded d-inline-flex align-items-center justify-content-center flex-shrink-0 text-body-secondary"
      style={{ width: 32, height: 32 }}
      aria-hidden="true"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {PATHS[kind] ?? PATHS.other}
      </svg>
    </span>
  );
}
