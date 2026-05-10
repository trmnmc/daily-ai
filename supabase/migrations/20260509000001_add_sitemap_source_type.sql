-- daily-ai-updates: add 'sitemap' to source_type enum.
--
-- Anthropic's blog migrated off RSS to a Next.js site that no longer
-- publishes a feed. The connector now reads sitemap.xml and scrapes the
-- listed pages. The seed row's `type` should reflect the actual ingestion
-- strategy, so we extend the enum and let `ensureSources()` upsert the new
-- value on the next ingestion run.

alter type source_type add value if not exists 'sitemap';
