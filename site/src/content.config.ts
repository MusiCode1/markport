import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Content lives in ../docs, next to the code it documents, so there is one
// copy of every document. The list is explicit rather than a wildcard: a new
// file under docs/ should not become a public page by accident.
//
// docs/obsidian-version-support.md and docs/system-plugin-dev-guide.md are
// deliberately absent - they are repo documentation, not site pages.
const pages = defineCollection({
  loader: glob({
    base: '../docs',
    pattern: [
      'landing.md',
      'install.md',
      'architecture.md',
      'he/landing.md',
      'he/install.md',
      'he/architecture.md',
    ],
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
});

export const collections = { pages };
