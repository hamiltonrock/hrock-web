import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// One Markdown file per FAQ. `tags` must match names in src/data/faq-tags.json.
// `order` sets the position on /faq and the tag pages (lowest first).
const faq = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/faq" }),
  schema: z.object({
    question: z.string(),
    order: z.number(),
    tags: z.array(z.string()).min(1),
  }),
});

export const collections = { faq };
