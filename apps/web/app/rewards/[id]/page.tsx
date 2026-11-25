import { notFound } from "next/navigation";
import { z } from "zod";
import { database } from "../../../lib/reports";
import { pointActor } from "../../../lib/point-offer";
import { localPointsEnabled } from "../../../lib/local-reward";
import { Flight } from "./flight";
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
  return <Flight initial={current.reward} signedIn={Boolean(actor.userId)} />;
}
