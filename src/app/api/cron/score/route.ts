import { runScoringPass } from "@/lib/scoring-runner";
import { readOptionalServerEnv } from "@/lib/server-env";
import { V1_USER_ID } from "@/lib/v1-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scoring cron: scores up to N unscored stories for the v1 user with Sonnet 4.6.
 *
 * Runs hourly in v1 (see vercel.json) so newly-ingested stories show up in
 * the feed within ~1h. Cost is bounded per-pass by the daily budget cap
 * enforced via try_charge_budget(); if the cap is hit, the pass returns
 * early with budgetExhausted: true.
 */
export async function GET(request: Request) {
  const cronSecret = readOptionalServerEnv(["CRON_SECRET"]);
  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runScoringPass({ userId: V1_USER_ID });
    return Response.json(summary);
  } catch (error) {
    return Response.json(
      {
        status: "failure",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
