import { redirect } from "next/navigation";
import { comparisonQuery, domain } from "@datadeal/contracts";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{
    left?: string | string[];
    right?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const left = domain.safeParse(params.left);
  if (!left.success) redirect("/");
  const pair = comparisonQuery.safeParse(params);
  redirect(
    "/report/" +
      left.data +
      (pair.success ? "?compare=" + encodeURIComponent(pair.data.right) : ""),
  );
}
