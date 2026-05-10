import { errorToMessage, runIngestion } from "@/lib/ingestion";
import { readOptionalServerEnv } from "@/lib/server-env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    return Response.json(await runIngestion());
  } catch (error) {
    return Response.json({
      status: "failure",
      error: errorToMessage(error),
    });
  }
}
