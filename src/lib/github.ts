/**
 * GitHub repo metadata fetcher (public repos only, v1).
 *
 * Fetches a small, stable subset of a repo: the README (markdown) and a
 * normalized "manifest" — whichever of `package.json`, `requirements.txt`,
 * `pyproject.toml` exist. The output feeds into the Sonnet scoring prompt
 * as "user's stack" context, so we keep total bytes modest.
 *
 * v1 deliberately skips PAT support — that requires the ENCRYPTION_KEY env var
 * + the schema's encrypt_pat() SQL function, both gated on a setup decision the
 * user hasn't made yet (tracked as next-tick work in HANDOFF.md).
 *
 * Rate limit: unauthenticated GitHub REST API allows 60 req/hour per IP.
 * Adding one repo costs at most 4 requests; refreshing 5 repos costs at most
 * 20 — comfortably within budget.
 */

const README_MAX = 30_000; // ~7.5K tokens — generous; the LLM will summarize
const MANIFEST_MAX = 10_000; // per file; pyproject.toml can run long with deps

const ACCEPT = "application/vnd.github+json";
const USER_AGENT = "daily-ai-updates/0.1 (https://github.com/truman/daily-ai-updates)";

const MANIFEST_FILES = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
] as const;

export type ParsedRepoUrl = {
  /** Canonical https://github.com/owner/repo (no .git, no trailing slash). */
  url: string;
  owner: string;
  repo: string;
};

export type RepoManifest = {
  /** Map of filename → raw text content. Only present if the file exists. */
  files: Partial<Record<(typeof MANIFEST_FILES)[number], string>>;
};

export type RepoFetchResult = {
  url: string;
  readme: string | null;
  manifest: RepoManifest;
};

export class RepoFetchError extends Error {
  constructor(
    message: string,
    readonly cause?: { status?: number; url?: string },
  ) {
    super(message);
    this.name = "RepoFetchError";
  }
}

/**
 * Parse and normalize a github.com repo URL. Returns null on anything that
 * isn't a recognizable owner/repo path on github.com — callers turn that into
 * a user-facing error message.
 */
export function parseGithubUrl(input: string): ParsedRepoUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Accept bare "owner/repo" too — common paste source.
  const bareMatch = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed);
  if (bareMatch) {
    const [, owner, repo] = bareMatch;
    const cleanRepo = repo.replace(/\.git$/, "");
    return {
      url: `https://github.com/${owner}/${cleanRepo}`,
      owner,
      repo: cleanRepo,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const [owner, rawRepo] = segments;
  const repo = rawRepo.replace(/\.git$/, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return {
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
  };
}

type FetchImpl = typeof fetch;

/**
 * Fetch the canonical metadata for a public repo. Throws RepoFetchError if the
 * repo itself is missing or unreadable; returns null README / empty manifest
 * when the repo exists but happens not to have those files.
 */
export async function fetchPublicRepo(
  parsed: ParsedRepoUrl,
  fetchImpl: FetchImpl = fetch,
): Promise<RepoFetchResult> {
  const { owner, repo } = parsed;

  // First, confirm the repo actually exists. This isolates the "bad URL"
  // failure mode from the "exists but no README" mode below.
  const probeRes = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers: { Accept: ACCEPT, "User-Agent": USER_AGENT } },
  );
  if (probeRes.status === 404) {
    throw new RepoFetchError(
      `Repo not found or private: ${parsed.url}. v1 supports public repos only.`,
      { status: 404, url: parsed.url },
    );
  }
  if (probeRes.status === 403) {
    throw new RepoFetchError(
      "GitHub rate limit hit. Try again in an hour, or add PAT support (tracked in HANDOFF.md).",
      { status: 403 },
    );
  }
  if (!probeRes.ok) {
    throw new RepoFetchError(
      `GitHub API error ${probeRes.status} for ${parsed.url}`,
      { status: probeRes.status, url: parsed.url },
    );
  }

  // Fetch README + manifests in parallel.
  const [readme, ...manifestEntries] = await Promise.all([
    fetchReadme(owner, repo, fetchImpl),
    ...MANIFEST_FILES.map((file) => fetchFile(owner, repo, file, fetchImpl)),
  ]);

  const files: RepoManifest["files"] = {};
  MANIFEST_FILES.forEach((file, i) => {
    const text = manifestEntries[i];
    if (text != null) files[file] = text;
  });

  return {
    url: parsed.url,
    readme,
    manifest: { files },
  };
}

async function fetchReadme(
  owner: string,
  repo: string,
  fetchImpl: FetchImpl,
): Promise<string | null> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/readme`,
    { headers: { Accept: ACCEPT, "User-Agent": USER_AGENT } },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new RepoFetchError(`Failed to fetch README: ${res.status}`, {
      status: res.status,
    });
  }
  const json = (await res.json()) as { content?: string; encoding?: string };
  if (!json.content || json.encoding !== "base64") return null;
  const decoded = Buffer.from(json.content, "base64").toString("utf-8");
  return decoded.length > README_MAX ? decoded.slice(0, README_MAX) : decoded;
}

async function fetchFile(
  owner: string,
  repo: string,
  path: string,
  fetchImpl: FetchImpl,
): Promise<string | null> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
    { headers: { Accept: ACCEPT, "User-Agent": USER_AGENT } },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null; // Tolerate transient single-file failures
  const json = (await res.json()) as { content?: string; encoding?: string };
  if (!json.content || json.encoding !== "base64") return null;
  const decoded = Buffer.from(json.content, "base64").toString("utf-8");
  return decoded.length > MANIFEST_MAX ? decoded.slice(0, MANIFEST_MAX) : decoded;
}
