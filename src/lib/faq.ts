import { getCollection } from "astro:content";
import itemTpl from "../partials/faq-item.html?raw";
import chipTpl from "../partials/faq-tag-chip.html?raw";
import { escapeHtml, fill } from "./html";

export async function faqItems(tag?: string) {
  const all = await getCollection("faq");
  return all
    .filter((e) => !tag || e.data.tags.includes(tag))
    .sort((a, b) => a.data.order - b.data.order);
}

// One FAQ in Webflow's dropdown markup. `wid` is the page's Webflow interaction id,
// which drives the +/- icon animation.
export function renderFaqItem(entry: Awaited<ReturnType<typeof faqItems>>[number], wid: string) {
  return fill(itemTpl, {
    QUESTION: escapeHtml(entry.data.question),
    TAGS: entry.data.tags.map((t) => fill(chipTpl, { TAG: escapeHtml(t) })).join(""),
    // Webflow's rich text ended most answers with a <br>; keep that spacing.
    ANSWER: (entry.rendered?.html ?? "") + "<br>",
    WID: wid,
  });
}
