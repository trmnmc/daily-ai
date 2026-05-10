import Anthropic from "@anthropic-ai/sdk";

import { readRequiredServerEnv } from "./server-env";

/**
 * Sonnet 4.6 scoring pass.
 *
 * Per design doc: "Sonnet 4.6 for scoring (cheap, fast)" + "Prompt caching is
 * required AND loop ordering matters". The loop pattern is:
 *
 *   for user in users:                 ← system prompt (profile + repos) is constant
 *     for story in stories_today:      ← user message varies, system stays cached
 *       scoreStory(...)
 *
 * The 5-minute prompt-cache TTL covers the inner loop comfortably. Iterating
 * the other way (`for story in stories: for user in users:`) would miss the
 * cache on every story switch and ~10× the cost.
 *
 * This module is a pure unit: it builds the prompt, calls the Anthropic API,
 * parses + validates the JSON response, and returns a typed result. Persistence
 * (`story_scores` insert), cost-cap enforcement (`try_charge_budget`), and
 * retry-queue handling all live in the caller (the cron route, next tick).
 */

export const SCORING_MODEL = "claude-sonnet-4-6";

/** Story content the scorer needs. Matches the columns we read from `stories`. */
export type StoryToScore = {
  id: string;
  title: string;
  body: string | null; // already truncated to 10KB at ingestion time
  source_name: string; // e.g. "hn-algolia-ai", "github-trending-ai"
};

/** Repo snippet shape — matches what `fetchPublicRepo` returns + what we store. */
export type RepoSnippet = {
  url: string;
  readme: string | null;
  manifest: { files: Partial<Record<string, string>> };
};

/** Per-user context. Stays constant across the inner per-story loop. */
export type UserScoringContext = {
  profile_md: string;
  repos: RepoSnippet[];
};

/** What the scorer returns. Validated; safe to insert into `story_scores`. */
export type ScoreResult = {
  score: number; // integer 0-100 (validated)
  why_i_care: string;
  tags: string[]; // 3-5 lowercase strings (validated for type/non-empty; not count)
};

export class ScoringError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ScoringError";
  }
}

/** Sonnet refused (safety). Caller should NOT retry; log and skip. */
export class ScoringRefusalError extends ScoringError {
  constructor(message: string) {
    super(message);
    this.name = "ScoringRefusalError";
  }
}

/** Response shape didn't match the schema. Likely a transient model glitch — retry once. */
export class ScoringValidationError extends ScoringError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "ScoringValidationError";
  }
}

/**
 * Pure function: build the system prompt (the cached prefix). Stable across
 * the inner per-story loop for a given user — that's what makes the cache hit.
 *
 * Critically: nothing here changes per story. No timestamps, no story IDs, no
 * Date.now(). If you add anything that varies per call, the cache invalidates
 * silently.
 */
export function buildSystemPrompt(ctx: UserScoringContext): string {
  const profile = ctx.profile_md.trim() || "(profile not yet written)";

  const reposSection =
    ctx.repos.length === 0
      ? "(No repos pasted yet — score on profile only.)"
      : ctx.repos.map(formatRepo).join("\n\n");

  return `You score AI/ML/dev news for one specific user. For each story given, return JSON with exactly three fields: score (integer 0-100), why_i_care (one sentence, second person), tags (3-5 lowercase hyphenated strings).

Score scale (calibrate carefully):
- 90-100: Directly impacts work the user is doing today. They will act on this.
- 70-89:  Would meaningfully change a current project or unblock a known problem.
- 60-69:  Borderline relevant — the cutoff for showing in the feed at all.
- 40-59:  Tangentially related to user's stack or interests.
-  0-39:  Not relevant. Generic news, off-topic, or duplicate.

why_i_care guidance:
- One sentence, ≤ 25 words. Second person ("you", "your stack").
- Be specific to this user — reference their stack, repos, or goals from the profile.
- No hedging language ("might be useful", "could be interesting"). State the impact.

tags guidance:
- 3-5 lowercase, hyphenated phrases (e.g. "rag", "prompt-caching", "vector-db", "llm-eval", "agentic-loops").
- Pick tags that future stories on the same topics could share — they drive the ignore-weighting math.

USER PROFILE:
${profile}

USER REPOS:
${reposSection}`;
}

function formatRepo(r: RepoSnippet): string {
  const manifestLines = Object.entries(r.manifest.files)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([name, content]) => `  ${name}:\n${indent(content, 4)}`);

  return `Repo: ${r.url}
README:
${indent(r.readme?.trim() || "(no README)", 2)}
Manifests:
${manifestLines.length > 0 ? manifestLines.join("\n") : "  (none found)"}`;
}

function indent(s: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return s
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

/**
 * Pure function: build the per-story user message. This is the volatile part
 * of the request — it varies per call and must NOT be cached.
 */
export function buildStoryMessage(s: StoryToScore): string {
  const body = s.body?.trim() || "(no body content available)";
  return `Source: ${s.source_name}
Title: ${s.title}
Body:
${body}`;
}

/**
 * JSON Schema for the structured output. Score range / tag count are NOT
 * representable in JSON Schema for this API (numerical + complex array
 * constraints are silently stripped). We post-validate in TypeScript.
 */
const SCORE_JSON_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    why_i_care: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["score", "why_i_care", "tags"],
  additionalProperties: false,
} as const;

/**
 * Just the surface of the SDK we actually use. Lets tests inject a stub
 * without constructing a fake Anthropic instance.
 */
export type CreateMessage = (
  params: Anthropic.MessageCreateParams,
) => Promise<Anthropic.Message>;

export type ScoringDeps = {
  createMessage: CreateMessage;
};

/**
 * Build the production deps. Lazy-instantiates the SDK so the module can be
 * imported in environments without the API key (tests, build-time analysis).
 */
let cachedClient: Anthropic | null = null;
export function getScoringDeps(): ScoringDeps {
  if (!cachedClient) {
    const apiKey = readRequiredServerEnv(["ANTHROPIC_API_KEY"]);
    cachedClient = new Anthropic({ apiKey });
  }
  const client = cachedClient;
  return {
    createMessage: (params) => client.messages.create(params) as Promise<Anthropic.Message>,
  };
}

/**
 * Score a single story for a single user. Returns a validated ScoreResult.
 *
 * Throws:
 * - ScoringRefusalError: Sonnet refused for safety. Do NOT retry.
 * - ScoringValidationError: response didn't match expected shape. Retry once.
 * - Anthropic.RateLimitError / Anthropic.APIError: transport-level failures.
 *   Caller decides whether to push to scoring_retry_queue.
 */
export async function scoreStory(
  deps: ScoringDeps,
  ctx: UserScoringContext,
  story: StoryToScore,
): Promise<ScoreResult> {
  const response = await deps.createMessage({
    model: SCORING_MODEL,
    max_tokens: 1024, // JSON output is small (~100 tokens); 1024 is generous headroom
    system: [
      {
        type: "text",
        text: buildSystemPrompt(ctx),
        cache_control: { type: "ephemeral" }, // 5-min TTL covers the inner per-story loop
      },
    ],
    messages: [{ role: "user", content: buildStoryMessage(story) }],
    output_config: {
      format: { type: "json_schema", schema: SCORE_JSON_SCHEMA },
    },
  });

  if (response.stop_reason === "refusal") {
    throw new ScoringRefusalError(`Sonnet refused to score story ${story.id}`);
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock || !textBlock.text) {
    throw new ScoringValidationError(
      `Story ${story.id}: response had no text block`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw new ScoringValidationError(
      `Story ${story.id}: response was not valid JSON: ${textBlock.text.slice(0, 200)}`,
      err,
    );
  }

  return validateScoreResult(parsed, story.id);
}

/**
 * Post-hoc validation. The schema constrains shape but not value ranges.
 * Anything we can't represent as JSON Schema gets enforced here.
 */
function validateScoreResult(raw: unknown, storyId: string): ScoreResult {
  if (typeof raw !== "object" || raw === null) {
    throw new ScoringValidationError(`Story ${storyId}: response root not an object`);
  }
  const obj = raw as Record<string, unknown>;

  const score = obj.score;
  if (
    typeof score !== "number" ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 100
  ) {
    throw new ScoringValidationError(
      `Story ${storyId}: score must be integer 0-100, got ${String(score)}`,
    );
  }

  const why = obj.why_i_care;
  if (typeof why !== "string" || why.trim().length === 0) {
    throw new ScoringValidationError(
      `Story ${storyId}: why_i_care must be a non-empty string`,
    );
  }

  const tagsRaw = obj.tags;
  if (
    !Array.isArray(tagsRaw) ||
    !tagsRaw.every((t): t is string => typeof t === "string")
  ) {
    throw new ScoringValidationError(
      `Story ${storyId}: tags must be a string array`,
    );
  }
  const tags = tagsRaw
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 0);
  if (tags.length === 0) {
    throw new ScoringValidationError(`Story ${storyId}: tags array was empty after normalization`);
  }

  return {
    score,
    why_i_care: why.trim(),
    tags,
  };
}
