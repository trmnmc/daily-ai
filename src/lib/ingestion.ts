import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SOURCE_CONNECTORS,
  truncateStoryBody,
  type SourceName,
  type StoryDraft,
} from "@/lib/sources";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import type { Database, IngestionStatus } from "@/lib/supabase/database.types";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

type SourceRow = {
  id: string;
  name: string;
};

export type IngestionSourceResult = {
  sourceName: SourceName;
  status: IngestionStatus;
  fetched: number;
  inserted: number;
  error: string | null;
};

export type IngestionRunResult = {
  status: IngestionStatus;
  startedAt: string;
  finishedAt: string;
  fetched: number;
  inserted: number;
  results: IngestionSourceResult[];
};

export async function runIngestion(
  supabase: SupabaseClient<Database> = getSupabaseAdminClient(),
): Promise<IngestionRunResult> {
  const startedAt = new Date().toISOString();
  const sourcesByName = await ensureSources(supabase);
  const results: IngestionSourceResult[] = [];

  for (const connector of SOURCE_CONNECTORS) {
    const source = sourcesByName.get(connector.source.name);
    if (!source) {
      results.push({
        sourceName: connector.source.name,
        status: "failure",
        fetched: 0,
        inserted: 0,
        error: "Source seed row is missing",
      });
      continue;
    }

    try {
      const stories = await withRetry(connector.fetchStories);
      const inserted = await insertStoryDrafts(supabase, source.id, stories);

      await recordSourceRun(supabase, source.id, "success", null);
      results.push({
        sourceName: connector.source.name,
        status: "success",
        fetched: stories.length,
        inserted,
        error: null,
      });
    } catch (error) {
      const message = errorToMessage(error);
      await recordSourceRun(supabase, source.id, "failure", message);
      results.push({
        sourceName: connector.source.name,
        status: "failure",
        fetched: 0,
        inserted: 0,
        error: message,
      });
    }
  }

  const failed = results.filter((result) => result.status === "failure").length;
  const status: IngestionStatus =
    failed === 0 ? "success" : failed === results.length ? "failure" : "partial";

  return {
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    fetched: results.reduce((total, result) => total + result.fetched, 0),
    inserted: results.reduce((total, result) => total + result.inserted, 0),
    results,
  };
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const delay = retryDelaysMs[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown ingestion error";
}

async function ensureSources(
  supabase: SupabaseClient<Database>,
): Promise<Map<SourceName, SourceRow>> {
  const sourceRows = SOURCE_CONNECTORS.map(({ source }) => ({
    name: source.name,
    type: source.type,
    url: source.url,
  }));

  const { error: upsertError } = await supabase
    .from("sources")
    .upsert(sourceRows, { onConflict: "name" });

  if (upsertError) throw upsertError;

  const names = SOURCE_CONNECTORS.map(({ source }) => source.name);
  const { data, error } = await supabase
    .from("sources")
    .select("id,name")
    .in("name", names);

  if (error) throw error;

  return new Map(
    (data ?? []).map((source) => [
      source.name as SourceName,
      { id: source.id, name: source.name },
    ]),
  );
}

async function insertStoryDrafts(
  supabase: SupabaseClient<Database>,
  sourceId: string,
  stories: StoryDraft[],
): Promise<number> {
  if (stories.length === 0) return 0;

  const rows = stories.map((story) => ({
    source_id: sourceId,
    title: story.title,
    url: story.url,
    body: truncateStoryBody(story.body),
  }));

  const { data, error } = await supabase
    .from("stories")
    .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}

async function recordSourceRun(
  supabase: SupabaseClient<Database>,
  sourceId: string,
  status: IngestionStatus,
  errorText: string | null,
): Promise<void> {
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("sources")
    .update({ last_run_at: now, last_status: status })
    .eq("id", sourceId);

  if (updateError) throw updateError;

  const { error: logError } = await supabase.from("ingestion_log").insert({
    source_id: sourceId,
    run_at: now,
    status,
    error_text: errorText,
  });

  if (logError) throw logError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
