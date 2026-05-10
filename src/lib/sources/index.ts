import { fetchAnthropicBlogStories } from "./anthropic-blog";
import { fetchGitHubTrendingStories } from "./github-trending";
import { fetchHnAlgoliaStories } from "./hn-algolia";
import { SOURCE_DEFINITIONS, type SourceDefinition } from "./shared";

export type SourceConnector = {
  source: SourceDefinition;
  fetchStories: () => Promise<import("./shared").StoryDraft[]>;
};

export const SOURCE_CONNECTORS: SourceConnector[] = [
  {
    source: SOURCE_DEFINITIONS.anthropicBlog,
    fetchStories: fetchAnthropicBlogStories,
  },
  {
    source: SOURCE_DEFINITIONS.githubTrending,
    fetchStories: fetchGitHubTrendingStories,
  },
  {
    source: SOURCE_DEFINITIONS.hnAlgolia,
    fetchStories: fetchHnAlgoliaStories,
  },
];

export {
  AI_KEYWORDS,
  SOURCE_DEFINITIONS,
  dedupeStoryDrafts,
  htmlToText,
  matchesAiKeyword,
  normalizeWhitespace,
  truncateStoryBody,
} from "./shared";
export type {
  SourceDefinition,
  SourceName,
  SourceType,
  StoryDraft,
} from "./shared";
