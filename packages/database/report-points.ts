import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";

export async function applyReportPoints(
  tx: TransactionSql,
  entry: {
    userId: string;
    delta: number;
    operation: string;
    referenceId: string;
  },
): Promise<"applied" | "duplicate" | "insufficient"> {
  const { userId, delta, operation, referenceId } = entry;
  if (!Number.isSafeInteger(delta) || !delta)
    throw new Error("A ledger change requires a nonzero integer");
  await tx`insert into report_point_accounts(user_id) values(${userId}) on conflict do nothing`;
  const [account] =
    await tx`select balance from report_point_accounts where user_id=${userId} for update`;
  const [prior] =
    await tx`select user_id,delta from report_point_ledger where operation=${operation} and reference_id=${referenceId}`;
  if (prior) {
    if (prior.user_id !== userId || prior.delta !== delta)
      throw new Error("Ledger reference conflicts with an existing entry");
    return "duplicate";
  }
  if (account.balance + delta < 0) return "insufficient";
  await tx`insert into report_point_ledger(id,user_id,delta,operation,reference_id) values(${randomUUID()},${userId},${delta},${operation},${referenceId})`;
  await tx`update report_point_accounts set balance=balance+${delta} where user_id=${userId}`;
  return "applied";
}
