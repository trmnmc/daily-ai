import Anthropic from "@anthropic-ai/sdk";

import { readRequiredServerEnv } from "./server-env";

/**
 * Sonnet 4.6 "Try" artifact generation.
 *
 * Per design doc Day 4-5 #15: "server action calls Sonnet 4.6 with the story
 * body + user context → returns single-file Python or HTML → store in
 * `artifacts` → render download link + copy-run-command button."
 *
 * The headline product promise (design doc "Day 7 target"): "every Try button
 * click returns a runnable single-file artifact in under 5 minutes from
 * click-to-running". This module is the "click-to-runnable" half. The action
 * wrapper, artifacts persistence, and UI wiring land in subsequent ticks.
 *
 * Structure mirrors `src/lib/scoring.ts` deliberately — same dependency-injection
 * shape, same prompt-caching discipline, same error class taxonomy. If you're
 * adding a third LLM caller (e.g. Day 6 Patch), keep the same shape.
 */

export const TRY_MODEL = "claude-sonnet-4-6";

/**
 * Story content the Try generator needs. Same shape as `StoryToScore` minus
 * `source_name` — the artifact prompt doesn't need to know where the story
 * came from, only what it says.
 */
export type StoryForTry = {
  id: string;
  title: string;
  body: string | null;
  url: string;
};

export type RepoSnippet = {
  url: string;
  readme: string | null;
  manifest: { files: Partial<Record<string, string>> };
};

export type UserTryContext = {
  profile_md: string;
  repos: RepoSnippet[];
};

export type TryLanguage = "python" | "html";

export type TryArtifact = {
  language: TryLanguage;
  filename: string;
  content: string;
  run_command: string;
};

export class TryGenerationError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TryGenerationError";
  }
}

/** Sonnet refused (safety). Caller should NOT retry; surface error to user. */
export class TryRefusalError extends TryGenerationError {
  constructor(message: string) {
    super(message);
    this.name = "TryRefusalError";
  }
}

/** Response shape didn't match expected schema. Likely transient — caller may retry once. */
export class TryValidationError extends TryGenerationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "TryValidationError";
  }
}

/** Defensive cap. Sonnet outputs are typically ~2K-5K chars; 50KB is a wide ceiling. */
const CONTENT_MAX = 50_000;

/**
 * Pure function: stable cached prefix per user. Same cache-discipline rules as
 * scoring's system prompt — anything per-call here invalidates the cache.
 *
 * Cache value is lower than for scoring (Try is invoked manually, not in a
 * tight inner loop), but it's still ~10K tokens cached at ~$0.03/call savings
 * for users who click Try multiple times within the 5-minute TTL.
 */
export function buildSystemPrompt(ctx: UserTryContext): string {
  const profile = ctx.profile_md.trim() || "(profile not yet written)";

  const reposSection =
    ctx.repos.length === 0
      ? "(No repos pasted yet — generate against the profile only.)"
      : ctx.repos.map(formatRepo).join("\n\n");

  return `You generate "Try" artifacts for one specific user. A Try artifact is ONE self-contained file the user can download and run locally in under 5 minutes. The user just read a piece of AI/dev news and clicked a button to "try" the idea hands-on.

Return JSON with exactly four fields: language ("python" or "html"), filename, content, run_command.

Pick the format that best fits the story:
- "python" (.py) — default. Demos a code idea, library, model API, prompt pattern, eval. Use Python 3.11+ stdlib OR uv inline-script-metadata (PEP 723) for deps.
- "html" (.html) — for visual / CSS / interactive UI demos. Single file, no build step, opens directly in a browser.

Hard rules:
- ONE file. No companion scripts, no requirements.txt, no Dockerfile.
- ≤ 200 lines. The user reads this as part of trying it; long files defeat the point.
- Runs end-to-end in under 5 minutes including any \`uv\` install time.
- For Python with deps: use the PEP 723 \`# /// script\` block at the top of the file with a tight \`requires-python\` and minimal \`dependencies\`.
- For Python with no deps: stdlib only.
- For HTML: no external build, no React/Vue, vanilla JS or one CDN script tag if absolutely needed.

run_command guidance:
- Python with deps via PEP 723: \`uv run <filename>\`
- Python stdlib only: \`python3 <filename>\`
- HTML: \`open <filename>\` (macOS) — keep simple, the user can adapt for their OS.

Tailor to the user's stack from the profile and repos below. If the profile mentions TypeScript, idiomatic Python with type hints is fine but skip Pydantic-style heavy validation. If they mention RAG, vector DBs, agents — bias the demo toward something they'd recognize from their own code.

If the story isn't actually demo-able as a single file (e.g. it's a model release with no API yet), return a Python file that does the closest thing possible (call the new API with a hello-world prompt; show the output diff vs. the previous model). Always return SOMETHING runnable; never refuse on grounds of "this isn't directly demo-able."

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
 * Pure function: per-story user message. Volatile — must NOT be cached.
 */
export function buildStoryMessage(s: StoryForTry): string {
  const body = s.body?.trim() || "(no body content available)";
  return `Source URL: ${s.url}
Title: ${s.title}
Body:
${body}`;
}

/**
 * JSON Schema for the structured output. `enum` on language is enforced; the
 * filename/extension consistency check happens in post-validation since it
 * needs cross-field logic.
 */
const TRY_JSON_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", enum: ["python", "html"] },
    filename: { type: "string" },
    content: { type: "string" },
    run_command: { type: "string" },
  },
  required: ["language", "filename", "content", "run_command"],
  additionalProperties: false,
} as const;

export type CreateMessage = (
  params: Anthropic.MessageCreateParams,
) => Promise<Anthropic.Message>;

export type TryDeps = {
  createMessage: CreateMessage;
};

let cachedClient: Anthropic | null = null;
export function getTryDeps(): TryDeps {
  if (!cachedClient) {
    const apiKey = readRequiredServerEnv(["ANTHROPIC_API_KEY"]);
    cachedClient = new Anthropic({ apiKey });
  }
  const client = cachedClient;
  return {
    createMessage: (params) =>
      client.messages.create(params) as Promise<Anthropic.Message>,
  };
}

/**
 * Generate a Try artifact for one story. Returns a validated TryArtifact.
 *
 * Throws:
 * - TryRefusalError: Sonnet refused. Surface to user; do NOT retry.
 * - TryValidationError: response shape didn't match. Caller may retry once.
 * - Anthropic.RateLimitError / Anthropic.APIError: transport failures.
 */
export async function generateTry(
  deps: TryDeps,
  ctx: UserTryContext,
  story: StoryForTry,
): Promise<TryArtifact> {
  const response = await deps.createMessage({
    model: TRY_MODEL,
    // Generous ceiling: Try artifacts are usually ~2K tokens; 8K leaves room
    // without inviting runaway. Per the claude-api skill default, we'd use
    // 16K for non-streaming, but Try output is genuinely bounded by the
    // ≤200-line rule in the prompt — 8K is plenty.
    max_tokens: 8192,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(ctx),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildStoryMessage(story) }],
    output_config: {
      format: { type: "json_schema", schema: TRY_JSON_SCHEMA },
    },
  });

  if (response.stop_reason === "refusal") {
    throw new TryRefusalError(`Sonnet refused to generate Try for story ${story.id}`);
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock || !textBlock.text) {
    throw new TryValidationError(
      `Story ${story.id}: response had no text block`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    throw new TryValidationError(
      `Story ${story.id}: response was not valid JSON: ${textBlock.text.slice(0, 200)}`,
      err,
    );
  }

  return validateTryArtifact(parsed, story.id);
}

function validateTryArtifact(raw: unknown, storyId: string): TryArtifact {
  if (typeof raw !== "object" || raw === null) {
    throw new TryValidationError(`Story ${storyId}: response root not an object`);
  }
  const obj = raw as Record<string, unknown>;

  const language = obj.language;
  if (language !== "python" && language !== "html") {
    throw new TryValidationError(
      `Story ${storyId}: language must be "python" or "html", got ${String(language)}`,
    );
  }

  const filename = obj.filename;
  if (typeof filename !== "string" || !/^[\w.-]+$/.test(filename)) {
    throw new TryValidationError(
      `Story ${storyId}: filename invalid (must be word chars + dots/hyphens), got ${String(filename)}`,
    );
  }
  // Filename extension must match language. Catches "language: python, filename: demo.html" mismatches.
  const expectedExt = language === "python" ? ".py" : ".html";
  if (!filename.endsWith(expectedExt)) {
    throw new TryValidationError(
      `Story ${storyId}: filename ${filename} doesn't match language ${language} (expected ${expectedExt})`,
    );
  }

  const content = obj.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new TryValidationError(
      `Story ${storyId}: content must be a non-empty string`,
    );
  }
  if (content.length > CONTENT_MAX) {
    throw new TryValidationError(
      `Story ${storyId}: content exceeds ${CONTENT_MAX} chars (got ${content.length})`,
    );
  }

  const runCommand = obj.run_command;
  if (typeof runCommand !== "string" || runCommand.trim().length === 0) {
    throw new TryValidationError(
      `Story ${storyId}: run_command must be a non-empty string`,
    );
  }

  return {
    language,
    filename,
    content,
    run_command: runCommand.trim(),
  };
}
