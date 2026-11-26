const iconPaths = {
  account:
    "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  rewards: "m3 10 18-7-6 17-3-7-9-3z m9 3 9-10",
  points:
    "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z M4 7v5c0 1.7 3.6 3 8 3s8-1.3 8-3V7 M4 12v5c0 1.7 3.6 3 8 3s8-1.3 8-3v-5",
  billing: "M3 5h18v14H3z M3 10h18 M6 15h4",
  developer: "m8 7-5 5 5 5 m8-10 5 5-5 5 M14 4l-4 16",
  watchlist: "M6 3h12v18l-6-4-6 4z",
  alerts: "M4 17h16l-2-3v-4a6 6 0 0 0-12 0v4z M10 20a2 2 0 0 0 4 0",
  mail: "M3 5h18v14H3z M3 6l9 7 9-7",
  docs: "M3 4h6a4 4 0 0 1 3 1.5A4 4 0 0 1 15 4h6v15h-6a4 4 0 0 0-3 1.5A4 4 0 0 0 9 19H3z M12 6v14",
  arrow: "M5 12h14 m-6-6 6 6-6 6",
} as const;

export type AccountSymbol = keyof typeof iconPaths;
export function AccountIcon({ name }: { name: AccountSymbol }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}
