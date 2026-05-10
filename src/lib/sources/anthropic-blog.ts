import { load } from "cheerio";

import {
  SOURCE_DEFINITIONS,
  dedupeStoryDrafts,
  normalizeWhitespace,
  type StoryDraft,
} from "./shared";

const SITE_ORIGIN = "https://www.anthropic.com";
const POST_PATH_PREFIXES = ["/news/", "/engineering/", "/research/"] as const;
const MAX_STORIES = 25;
const REQUEST_HEADERS = {
  "User-Agent": "daily-ai-updates/0.1 (+https://github.com)",
} as const;

export type SitemapEntry = {
  url: string;
  lastmod: string | null;
};

export function parseAnthropicSitemap(xml: string): SitemapEntry[] {
  const $ = load(xml, { xmlMode: true });
  const entries: SitemapEntry[] = [];

  $("url").each((_, el) => {
    const loc = normalizeWhitespace($(el).find("loc").first().text());
    if (!loc.startsWith(`${SITE_ORIGIN}/`)) return;

    const pathname = new URL(loc).pathname;
    const isPost = POST_PATH_PREFIXES.some(
      (prefix) =>
        pathname.startsWith(prefix) && pathname.length > prefix.length,
    );
    if (!isPost) return;

    const lastmod =
      normalizeWhitespace($(el).find("lastmod").first().text()) || null;
    entries.push({ url: loc, lastmod });
  });

  return entries;
}

export function selectRecentEntries(
  entries: SitemapEntry[],
  limit: number = MAX_STORIES,
): SitemapEntry[] {
  return [...entries]
    .sort((a, b) => parseLastmod(b.lastmod) - parseLastmod(a.lastmod))
    .slice(0, limit);
}

function parseLastmod(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseAnthropicArticle(
  html: string,
  url: string,
  publishedAt: string | null,
): StoryDraft | null {
  const $ = load(html);

  const ogTitle = normalizeWhitespace(
    $('meta[property="og:title"]').attr("content"),
  );
  const h1Title = normalizeWhitespace($("h1").first().text());
  const docTitle = stripAnthropicSuffix(
    normalizeWhitespace($("title").first().text()),
  );
  const title = ogTitle || h1Title || docTitle;
  if (!title) return null;

  const firstParagraph = normalizeWhitespace(
    $("p.post-text").first().text() || $("article p").first().text(),
  );
  const description = normalizeWhitespace(
    $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content"),
  );
  const body = firstParagraph || description || null;

  return {
    sourceName: SOURCE_DEFINITIONS.anthropicBlog.name,
    title,
    url,
    body,
    publishedAt,
  };
}

function stripAnthropicSuffix(value: string): string {
  return value.replace(/\s*\\\s*Anthropic\s*$/i, "").trim();
}

export async function fetchAnthropicBlogStories(
  fetchImpl: typeof fetch = fetch,
): Promise<StoryDraft[]> {
  const sitemapResponse = await fetchImpl(
    SOURCE_DEFINITIONS.anthropicBlog.url,
    {
      headers: {
        ...REQUEST_HEADERS,
        Accept: "application/xml, text/xml;q=0.9",
      },
    },
  );

  if (!sitemapResponse.ok) {
    throw new Error(
      `Anthropic sitemap returned ${sitemapResponse.status} ${sitemapResponse.statusText}`,
    );
  }

  const entries = selectRecentEntries(
    parseAnthropicSitemap(await sitemapResponse.text()),
  );

  const articleResults = await Promise.allSettled(
    entries.map(async (entry) => {
      const articleResponse = await fetchImpl(entry.url, {
        headers: {
          ...REQUEST_HEADERS,
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!articleResponse.ok) {
        throw new Error(
          `Anthropic article ${entry.url} returned ${articleResponse.status} ${articleResponse.statusText}`,
        );
      }
      return parseAnthropicArticle(
        await articleResponse.text(),
        entry.url,
        entry.lastmod,
      );
    }),
  );

  const stories = articleResults
    .filter(
      (result): result is PromiseFulfilledResult<StoryDraft | null> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value)
    .filter((story): story is StoryDraft => story !== null);

  return dedupeStoryDrafts(stories);
}
