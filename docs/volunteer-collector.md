# Volunteer collector ("Share your browser")

Status: decided 25 Nov 2026 — private-window isolation, worker cross-check verification first
(two-volunteer agreement later), 25 points per accepted scan. Replaces the narrower pilot in `VOLUNTEER-MEASUREMENTS.md`
(DataDeal-owned test pages only) with real site scans run in volunteers' browsers.

## Goal

People who install the extension can switch on **Share your browser**. Their browser then picks up scan
jobs from the DataDeal queue, visits the site the way the Playwright worker does, and sends back the
**same evidence shape**. This adds capacity and residential/real-browser vantage points, and volunteers
earn points for verified work.

## What a job does (same as the worker)

1. Open the target homepage (plus up to 3 sampled pages) in an **isolated window** (see below).
2. Record before-choice state, then click **Reject** in one clean run and **Accept all** in another, using
   the same consent-button rules as the worker (shared package, so both collectors behave identically).
3. Capture cookies and web storage by **masked name + value description** (`maskStorageName`,
   `describeStorageValue` run inside the extension; raw values never leave the device), outside
   domains contacted, request field categories (identifier, email, page URL…), and timings.
4. Close the window, wipe the isolated session, upload the result, take the next job.

The server treats the upload exactly like worker evidence; the Claude classification and scoring v2 run
server-side as today.

## Isolation: clean "fresh visitor" data

A normal tab carries the volunteer's logins and cookies, which would both contaminate results and
reveal who they are. Options:

| Option                                       | Clean?                                                                                                            | Cost to volunteer                                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Private / incognito window (recommended)** | Yes. The private cookie store starts empty and the extension wipes it between jobs; normal browsing is untouched. | One-time: enable "Allow in Incognito / Run in Private Windows" for the extension (browsers do not allow requesting this in code). |
| Separate browser profile                     | Yes                                                                                                               | Create and keep a dedicated profile running.                                                                                      |
| Normal window + reset site data (ask first)  | Partly: the site's own data can be cleared, but third-party ad cookies stay                                       | Logs them out of that site.                                                                                                       |

If private-window access is not enabled, Share your browser stays off and explains the one switch.

## Permissions (only requested when the volunteer turns the feature on)

`tabs`, `tabGroups` (the job runs in a labelled group in the private window), `cookies`, `webRequest`,
`browsingData`, `scripting`, and optional host access `<all_urls>`. The normal extension (score lookup)
keeps its current minimal permissions; volunteering is a separate opt-in with its own explanation screen.

## Trust and verification

Volunteers can be wrong or malicious. Results are not published on one volunteer's word:

- Each job is signed to one volunteer and expires; uploads must match the assigned job.
- A result is **accepted** when it agrees with a second independent collector (another volunteer or the
  worker) on the stable facts: set of outside domains, cookie names per phase, consent buttons found.
  Disagreements go to the worker.
- Volunteers earn points only for accepted results; repeated disagreement lowers their trust and job rate.
- Rate limits per account; no jobs for private, local or Tailnet addresses (same SSRF rules as the worker).

## Safety for the volunteer

- Visible: a pinned, labelled tab group "DataDeal scan" in its own window; a Stop button; a cap on
  jobs per hour; pause on battery/metered connections.
- Never submits forms, never logs in, never downloads files, no clicks other than consent buttons.
- Nothing from the volunteer's own browsing is read: only the isolated window's tabs.

## Server pieces

- `GET /api/v1/volunteer/jobs/next` (authenticated volunteer, returns one signed job or 204).
- `POST /api/v1/volunteer/jobs/:id/result` (validated against the shared contracts).
- Job table extension: `assignee`, `collector` (`worker` | `volunteer`), agreement state.
- Points via the existing paper-plane wallet: 25 points per accepted scan (a report unlock costs 50).

## Phasing

1. Shared collector core (consent rules, storage description, evidence builder) used by both worker and
   extension. Unit tests against the same fixtures.
2. Extension opt-in screen, private-window session, one job end-to-end against a local server.
3. Server job API, verification by worker cross-check, points.
4. Two-volunteer agreement, trust levels, store submission.
