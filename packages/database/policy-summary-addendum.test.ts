import { randomUUID } from "node:crypto";
import type { ScanReport } from "@datadeal/contracts";
import { evaluateHeadline } from "@datadeal/scoring";
import postgres from "postgres";
import { expect, it } from "vitest";
import { connect } from "./index";

const url = process.env.DATADEAL_TEST_DATABASE_URL;
it.skipIf(!url)(
  "appends a cited policy review exactly once without changing the prior snapshot or its rating",
  async () => {
    const db = connect(url!);
    const sql = postgres(url!);
    const id = randomUUID();
    const domain = id + ".example.org";
    const date = new Date().toISOString();
    const text = "We keep booking details for 30 days after your appointment.";
    const report: ScanReport = {
      id,
      domain,
      demo: false,
      partial: true,
      completedAt: date,
      findings: [],
      evidence: [
        {
          id: "section-3",
          scanId: id,
          kind: "declared_first_party",
          retrievedAt: date,
          url: "https://" + domain + "/privacy.pdf",
          excerpt: text,
          observation: {
            type: "policy_section",
            topic: "retention",
            heading: "Retention",
          },
        },
      ],
    };
    const item = {
      topic: "retention",
      text: "The policy gives a 30-day retention period after an appointment.",
      source: "section-3",
      quote: text,
    };
    const addendum = {
      model: "test-analyst",
      promptVersion: "19",
      reviewedAt: date,
      items: [item],
    };
    try {
      await sql`insert into domains(name) values (${domain})`;
      await sql`insert into scans(id,domain,state,report) values (${id},${domain},'partially_completed',${JSON.stringify(report)}::text::jsonb)`;
      for (const bad of [
        { source: "foreign-section" },
        { topic: "sharing" },
        { quote: "We retain the whole dataset indefinitely." },
      ]) {
        await expect(
          db.savePolicySummaryAddendum(id, domain, {
            ...addendum,
            items: [{ ...item, ...bad }],
          }),
        ).rejects.toThrow("citation");
      }
      const statuses = await Promise.all(
        [1, 2].map(() => db.savePolicySummaryAddendum(id, domain, addendum)),
      );
      expect(statuses.sort()).toEqual(["already reviewed", "saved"]);
      const [saved] = await sql`select report from scans where id=${id}`;
      expect(saved.report).toEqual({
        ...report,
        policySummaryAddendum: addendum,
      });
      expect(evaluateHeadline(saved.report)).toEqual(evaluateHeadline(report));
    } finally {
      await sql`delete from scans where id=${id}`;
      await sql`delete from domains where name=${domain}`;
      await db.close();
      await sql.end();
    }
  },
);
