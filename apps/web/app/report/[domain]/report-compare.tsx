"use client";

import { Button, Input, Label, Modal } from "@heroui/react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  comparisonQuery,
  isActiveScan,
  scenarioLabel,
  noChoiceVisitLabel,
} from "@datadeal/contracts";
import type { comparePublicReports } from "../../../lib/compare";
import { ReportIcon } from "./report-icon";
import { LocalDate } from "../../../lib/local-date";

type Pair = Awaited<ReturnType<typeof comparePublicReports>>;

export function ReportCompare({ host }: { host: string }) {
  const field = useId();
  const [open, setOpen] = useState(false);
  const [peer, setPeer] = useState("");
  const [selection, setSelection] = useState("");
  const [choices, setChoices] = useState<string[]>([]);
  const [reports, setReports] = useState<Pair | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const other = new URLSearchParams(window.location.search).get("compare");
    const initial = comparisonQuery.safeParse({ left: host, right: other });
    if (initial.success) {
      setPeer(initial.data.right);
      setSelection(initial.data.right);
      setOpen(true);
    }
  }, [host]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/v1/compare/options", { signal: controller.signal })
      .then(async (r) => {
        if (r.ok)
          setChoices(
            (await r.json()).domains.filter((item: string) => item !== host),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [open, host]);
  useEffect(() => {
    if (!open || !selection) return;
    const controller = new AbortController();
    setBusy(true);
    setReports(null);
    setError("");
    const params = new URLSearchParams({ left: host, right: selection });
    fetch("/api/v1/compare?" + params, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error();
        const data = await response.json();
        if (!controller.signal.aborted) setReports(data.reports);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
          setSelection("");
          setError("Comparison unavailable. Try again.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [selection, open, host]);
  function select(value: string) {
    const pair = comparisonQuery.safeParse({ left: host, right: value });
    if (!pair.success) {
      setError("Enter a different public domain.");
      return;
    }
    setPeer(pair.data.right);
    setError("");
    setSelection(pair.data.right);
    const url = new URL(window.location.href);
    url.searchParams.set("compare", pair.data.right);
    window.history.replaceState(null, "", url);
  }
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      const url = new URL(window.location.href);
      url.searchParams.delete("compare");
      window.history.replaceState(null, "", url);
      setSelection("");
      setPeer("");
      setReports(null);
      setBusy(false);
      setError("");
    }
  }
  return (
    <Modal isOpen={open} onOpenChange={changeOpen}>
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5 [&_svg]:size-4"
        aria-label={"Compare " + host + " with another website"}
      >
        <ReportIcon name="compare" /> Compare
      </Button>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog className="min-w-0">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Compare websites</Modal.Heading>
              <p>
                Compare the latest public report for {host} with another
                website.
              </p>
            </Modal.Header>
            <Modal.Body>
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  select(peer);
                }}
              >
                <Label htmlFor={field}>Website to compare</Label>
                <div className="flex items-center gap-2 [&_input]:min-w-0 [&_input]:flex-1">
                  <Input
                    id={field}
                    value={peer}
                    onChange={(e) => setPeer(e.target.value)}
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={253}
                    placeholder="Enter a domain"
                    required
                  />
                  <Button type="submit" variant="primary" isDisabled={busy}>
                    Compare
                  </Button>
                </div>
              </form>
              {!!choices.length && (
                <div className="flex flex-wrap gap-1">
                  {choices.slice(0, 6).map((site) => (
                    <Button
                      key={site}
                      size="sm"
                      variant="tertiary"
                      onPress={() => select(site)}
                    >
                      {site}
                    </Button>
                  ))}
                </div>
              )}
              {error && <p role="alert">{error}</p>}
              {busy && <p role="status">Loading reports…</p>}
              {reports && (
                <div className="grid min-w-0 grid-cols-2 gap-3 md:gap-5">
                  {reports.map((r) => {
                    const path =
                      "/report/" +
                      r.host +
                      (r.scanId ? "?scan=" + r.scanId : "");
                    return (
                      <section
                        key={r.host}
                        className="min-w-0 space-y-2 border-t border-border py-4 wrap-anywhere [&_h3]:text-base [&_small]:text-muted"
                        aria-label={r.host}
                        data-rating={r.grade?.toLowerCase()}
                      >
                        <h3>{r.host}</h3>
                        <div className="flex flex-wrap items-baseline gap-1 text-[var(--rating,var(--foreground))] [&_strong]:text-3xl [&_span]:basis-full [&_span]:font-semibold sm:[&_span]:basis-auto">
                          <strong>{r.score ?? "—"}</strong>
                          {r.score !== null && <small>/100</small>}
                          <span>{r.grade ?? "Unrated"}</span>
                        </div>
                        {r.headlineScenario && (
                          <small>
                            {r.noChoiceVisit
                              ? noChoiceVisitLabel
                              : scenarioLabel[r.headlineScenario]}
                          </small>
                        )}
                        <p>
                          {r.verdict ||
                            (isActiveScan(r.state)
                              ? "First scan in progress."
                              : "No published report yet.")}
                        </p>
                        {r.scanDate && (
                          <small>
                            Scanned <LocalDate value={r.scanDate} /> ·{" "}
                            {r.confidence} confidence
                            {r.partial && " · Partial scan"}
                          </small>
                        )}
                        {r.visitorClaim && (
                          <p>
                            {r.visitorClaim.text}{" "}
                            {r.visitorClaim.evidenceIds.map((id, i) => (
                              <Link
                                key={id}
                                className="inline-link me-1"
                                href={
                                  path + "#evidence-" + encodeURIComponent(id)
                                }
                                aria-label={
                                  r.visitorClaim?.evidenceLabels?.[i] ??
                                  `Source ${i + 1}`
                                }
                                onClick={() => changeOpen(false)}
                              >
                                [{i + 1}]
                              </Link>
                            ))}
                          </p>
                        )}
                        {!!r.warnings.length && (
                          <ul>
                            {r.warnings.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        )}
                        <Link
                          className="inline-link"
                          href={path}
                          onClick={() => changeOpen(false)}
                        >
                          {r.scanDate ? "Open report" : "Open scan request"} ↗
                        </Link>
                      </section>
                    );
                  })}
                </div>
              )}
              {reports &&
                new Set(
                  reports
                    .filter((r) => r.score !== null)
                    .map((r) => r.methodologyVersion),
                ).size > 1 && (
                  <p>These ratings use different scoring versions.</p>
                )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
