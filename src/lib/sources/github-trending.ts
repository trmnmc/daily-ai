import { load } from "cheerio";

import {
  AI_KEYWORDS,
  SOURCE_DEFINITIONS,
  dedupeStoryDrafts,
  matchesAiKeyword,
  normalizeWhitespace,
  type StoryDraft,
} from "./shared";

const GITHUB_ORIGIN = "https://github.com";

export function parseGitHubTrendingHtml(
  html: string,
  keywords: readonly string[] = AI_KEYWORDS,
): StoryDraft[] {
  const $ = load(html);
  const stories: StoryDraft[] = [];

  $("article.Box-row").each((_, article) => {
    const repoAnchor = $(article).find("h2 a").first();
    const href = normalizeWhitespace(repoAnchor.attr("href"));
    const repoName = normalizeWhitespace(repoAnchor.text()).replace(
      /\s*\/\s*/g,
      "/",
    );

    if (!href || !repoName) return;

    const description = normalizeWhitespace($(article).find("p").first().text());
    const topics = $(article)
      .find('a[href*="/topics/"]')
      .map((__, topic) => normalizeWhitespace($(topic).text()))
      .get()
      .filter(Boolean);

    const keywordText = [description, ...topics].join(" ");
    if (!matchesAiKeyword(keywordText, keywords)) return;

    const bodyParts = [
      description,
      topics.length > 0 ? `Topics: ${topics.join(", ")}` : "",
    ].filter(Boolean);

    stories.push({
      sourceName: SOURCE_DEFINITIONS.githubTrending.name,
      title: repoName,
      url: new URL(href, GITHUB_ORIGIN).toString(),
      body: bodyParts.length > 0 ? bodyParts.join("\n") : null,
      publishedAt: null,
    });
  });

  return dedupeStoryDrafts(stories);
}

export async function fetchGitHubTrendingStories(
  fetchImpl: typeof fetch = fetch,
): Promise<StoryDraft[]> {
  const response = await fetchImpl(SOURCE_DEFINITIONS.githubTrending.url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "daily-ai-updates/0.1 (+https://github.com)",
    },
  });

  if (!response.ok) {
    throw new Error(
      `GitHub Trending returned ${response.status} ${response.statusText}`,
    );
  }

  return parseGitHubTrendingHtml(await response.text());
}
