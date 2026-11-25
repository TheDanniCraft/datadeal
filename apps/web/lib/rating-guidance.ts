export const ratingGuidance = {
  Excellent: [
    "Low concern in this scan",
    "Review what the site requests before sharing personal information.",
  ],
  Good: [
    "Generally low concern",
    "Review what the site requests before sharing personal information.",
  ],
  Mixed: [
    "Use with caution",
    "Share only what you need and reject optional consent when you can.",
  ],
  Concerning: [
    "Limit what you share",
    "Reject optional consent where available and avoid sharing information the service does not need.",
  ],
  Poor: [
    "Avoid sharing optional data",
    "Consider alternatives before creating an account or sharing sensitive information.",
  ],
  Critical: [
    "Avoid sharing sensitive data",
    "Review the critical findings before giving this site personal information.",
  ],
  Unrated: [
    "Insufficient evidence",
    "Review the site’s current privacy policy and what it asks for before signing up.",
  ],
} as const;
