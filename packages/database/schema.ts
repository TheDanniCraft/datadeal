import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import type { ScanReport } from "@datadeal/contracts";

export const domains = pgTable("domains", { name: text().primaryKey() });
export const scans = pgTable(
  "scans",
  {
    id: uuid().primaryKey(),
    domain: text()
      .notNull()
      .references(() => domains.name),
    state: text().notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    report: jsonb().$type<ScanReport>(),
  },
  (table) => [index("scans_domain_date").on(table.domain, table.requestedAt)],
);
export const jobs = pgTable("scan_jobs", {
  scanId: uuid("scan_id")
    .primaryKey()
    .references(() => scans.id, { onDelete: "cascade" }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  owner: uuid(),
  attempts: integer().notNull().default(0),
  stages: text().array().notNull().default([]),
});

export const scanAnalyses = pgTable(
  "scan_analyses",
  {
    scanId: uuid("scan_id")
      .primaryKey()
      .references(() => scans.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    result: jsonb().notNull(),
  },
  (table) => [index("scan_analyses_input_hash").on(table.inputHash)],
);

export const scanRequestLimits = pgTable(
  "scan_request_limits",
  {
    bucket: text().primaryKey(),
    hour: timestamp({ withTimezone: true }).notNull(),
    hits: integer().notNull(),
  },
  (table) => [index("scan_request_limits_hour").on(table.hour)],
);
