import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { database } from "../../../lib/reports";
import { pointActor } from "../../../lib/point-offer";
import { localPointsEnabled } from "../../../lib/local-reward";
export default async function RewardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!localPointsEnabled() || !database || !z.uuid().safeParse(id).success)
    notFound();
  const { actor } = await pointActor();
  const current = await database.reportOfferAction(id, actor, "status");
  if (current.code !== "ok" || current.reward.state === "pending") notFound();
  // The reward opens as a modal over its report.
  redirect("/report/" + current.reward.domain + "?reward=" + current.reward.id);
}
