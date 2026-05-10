import { load } from "cheerio";

export const AI_KEYWORDS = [
  "llm",
  "ai",
  "agent",
  "rag",
  "embedding",
  "transformer",
  "diffusion",
  "openai",
  "anthropic",
  "claude",
  "gpt",
] as const;

export type SourceName =
  | "anthropic-blog"
  | "github-trending-ai"
  | "hn-algolia-ai";

export type SourceType = "rss" | "github_trending" | "hn_algolia" | "sitemap";

export type SourceDefinition = {
  name: SourceName;
  type: SourceType;
  url: string;
};

export type StoryDraft = {
  sourceName: SourceName;
  title: string;
  url: string;
  body: string | null;
  publishedAt: string | null;
};

export const SOURCE_DEFINITIONS = {
  anthropicBlog: {
    name: "anthropic-blog",
    type: "sitemap",
    url: "https://www.anthropic.com/sitemap.xml",
  },
  githubTrending: {
    name: "github-trending-ai",
    type: "github_trending",
    url: "https://github.com/trending?since=daily",
  },
  hnAlgolia: {
    name: "hn-algolia-ai",
    type: "hn_algolia",
    url: "https://hn.algolia.com/api/v1/search_by_date",
  },
} as const satisfies Record<string, SourceDefinition>;

export function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function htmlToText(value: string | null | undefined): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return "";

  return normalizeWhitespace(load(normalized).root().text());
}

export function matchesAiKeyword(
  value: string,
  keywords: readonly string[] = AI_KEYWORDS,
): boolean {
  const haystack = value.toLowerCase();

  return keywords.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(
      haystack,
    );
  });
}

export function dedupeStoryDrafts(stories: StoryDraft[]): StoryDraft[] {
  const seenUrls = new Set<string>();

  return stories.filter((story) => {
    if (seenUrls.has(story.url)) return false;
    seenUrls.add(story.url);
    return true;
  });
}

export function truncateStoryBody(
  value: string | null | undefined,
  maxLength = 10_000,
): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;

  return normalized.length > maxLength
    ? normalized.slice(0, maxLength).trimEnd()
    : normalized;
}
