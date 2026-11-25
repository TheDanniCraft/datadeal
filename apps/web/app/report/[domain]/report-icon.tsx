const paths = {
  open: "M6 18 18 6M7 6h11v11",
  contact: "M3 5h18v14H3z M3 6l9 7 9-7",
  calendar: "M4 5h16v16H4z M8 3v4m8-4v4M4 10h16",
  chart: "M4 3v17h17 M8 16v-4m5 4V7m5 9v-6",
  forward: "m10 5 7 7-7 7",
  play: "m8 4 12 8-12 8Z",
  rescan: "M20 11a8 8 0 1 0-2 6 M20 4v7h-7",
  compare: "M4 7h14m-4-4 4 4-4 4 M20 17H6m4-4-4 4 4 4",
  globe:
    "M22 12a10 10 0 1 1-20 0 10 10 0 1 1 20 0 M2 12h20 M12 2c5.5 5 5.5 15 0 20-5.5-5-5.5-15 0-20",
  glance: "M3 4h18v13H3z M8 21h8 M12 17v4",
  policy: "M6 3h9l4 4v14H6z M15 3v5h4 M9 12h7 M9 16h5",
  sparkle: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z",
  lock: "M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3",
  back: "m14 5-7 7 7 7",
  cookie:
    "M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-5-5Z M8.5 10.5h.01 M15 15h.01 M10 16h.01",
  noChoice: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M5.6 5.6l12.8 12.8",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3 2",
  megaphone:
    "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z M15 9a3 3 0 0 1 0 6 M18 6a7 7 0 0 1 0 12",
  server: "M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01",
  noPolicy: "M6 3h9l4 4v14H6z M15 3v5h4 M10 12l5 5 M15 12l-5 5",
};

export function ReportIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
