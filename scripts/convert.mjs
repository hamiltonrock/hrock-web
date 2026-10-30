// One-off: turn the raw scrape (_scrape/pages, from scrape.mjs) into Astro source.
//
//   src/partials/*.html        shared head, nav, footer, scripts, and templates
//   src/partials/pages/*.html  each main page's unique body
//   src/data/pages.json        per-page <head> extras, tail scripts, data-wf-page
//   src/data/faq-tags.json     the 14 FAQ tags, in Webflow's order
//   src/data/legal.json        legal pages (each is an iframe onto app.hamiltonrock.com)
//   src/content/faq/*.md       the 48 FAQ items
//
// After the cut-over the generated files are the source of truth: edit them, not this.
// Re-running overwrites them.

import { load } from "cheerio";
import TurndownService from "turndown";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PAGES = join(ROOT, "_scrape/pages");
const report = JSON.parse(readFileSync(join(ROOT, "_scrape/report.json"), "utf8"));
const CDN = "https://cdn.prod.website-files.com/";

const write = (rel, text) => {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text.endsWith("\n") ? text : text + "\n");
};
const read = (rel) => readFileSync(join(PAGES, rel), "utf8");

// --- URL rewriting -----------------------------------------------------------
function localize(html) {
  for (const [url, local] of Object.entries(report.vendorMap)) {
    html = html.replaceAll(url, local).replaceAll(url.replaceAll("&", "&amp;"), local);
  }
  return html
    .replaceAll(CDN, "/wf/")
    .replace(/https:\/\/(www\.)?hamiltonrock\.com(?=[\/"'?#])/g, "")
    .replace(/https:\/\/hamilton-rock\.webflow\.io(?=[\/"'?#])/g, "")
    .replace(/href=""/g, 'href="/"');
}

// Webflow's SRI hashes no longer match (the CSS was rewritten), and crossorigin is
// pointless for same-origin files.
function stripSri($, scope) {
  $(scope).find("[integrity]").removeAttr("integrity").removeAttr("crossorigin");
}

// Webflow marks the current page's links; the layout re-applies this per page.
const unmarkCurrent = (html) =>
  html.replace(/ aria-current="page"/g, "").replace(/ w--current/g, "").replace(/ class=""/g, "");

// --- waitlist form -> Netlify Forms --------------------------------------------
function netlifyForms($) {
  $('form[data-name="Waitlist Form"]').each((_, el) => {
    const f = $(el);
    f.attr("name", "waitlist").attr("method", "POST").attr("action", "/");
    f.attr("data-netlify", "true").attr("netlify-honeypot", "website");
    f.removeAttr("data-wf-page-id").removeAttr("data-wf-element-id");
    if (!f.find('input[name="form-name"]').length) f.prepend('<input type="hidden" name="form-name" value="waitlist">');
    // Without the .w-form class webflow.js leaves the form alone (it would otherwise
    // post to Webflow's form API). .w-form only set a margin that .form-block overrides.
    f.closest(".w-form").removeClass("w-form").addClass("waitlist-form");
    f.find("script").each((_, s) => {
      $(s).text($(s).text().replaceAll("closest('.w-form')", "closest('.waitlist-form')"));
    });
  });
}

// SEO tags (meta, canonical, JSON-LD) need absolute production URLs, not local paths.
const SITE = "https://www.hamiltonrock.com";
const absolutize = (html) =>
  html.replaceAll(CDN, SITE + "/wf/").replace(/https:\/\/hamilton-rock\.webflow\.io(?=[\/"'?#])/g, SITE);
const isSeo = (h) => /^<meta|^<link[^>]*rel="canonical"|application\/ld\+json/.test(h);

function prep(html) {
  const $ = load(html);
  for (const scope of ["head", "body"]) {
    $(scope).children().each((_, el) => {
      const h = $.html(el);
      if (/rel="preconnect"/.test(h) && h.includes("website-files.com")) return void $(el).remove();
      $(el).replaceWith(isSeo(h) ? absolutize(h) : localize(h));
    });
  }
  stripSri($, "html");
  netlifyForms($);
  return $;
}

// --- read every scraped page ---------------------------------------------------
const files = [];
(function walk(dir) {
  for (const f of readdirSync(join(PAGES, dir), { withFileTypes: true })) {
    if (f.isDirectory()) walk(join(dir, f.name));
    else files.push(join(dir, f.name));
  }
})("");
const pathOf = (f) => "/" + f.replace(/\.html$/, "").replace(/^index$/, "");
const docs = Object.fromEntries(files.map((f) => [pathOf(f), prep(read(f))]));

// head children / tail scripts present on every page are shared; the rest are per page
const headKids = ($) => $("head").children().map((_, el) => $.html(el)).get();
const tailKids = ($) => $("body > script").map((_, el) => $.html(el)).get();
const everywhere = (lists) => lists[0].filter((x) => lists.every((l) => l.includes(x)));
const headCommon = everywhere(Object.values(docs).map(headKids))
  .filter((h) => !h.includes('name="generator"'));
const tailCommon = everywhere(Object.values(docs).map(tailKids));

// The home page's last script is `$('.counter').counterup{...}`: a syntax error that
// never ran on the live site either (the .counterup script above it does the work).
const isBroken = (s) => s.includes(".counterup{");

const pagesJson = {};
for (const [path, $] of Object.entries(docs)) {
  pagesJson[path] = {
    wfPage: $("html").attr("data-wf-page"),
    head: headKids($).filter((h) => !headCommon.includes(h) && !h.includes('name="generator"')).join("\n"),
    tail: tailKids($).filter((s) => !tailCommon.includes(s) && !isBroken(s)).join("\n"),
  };
}

const home = docs["/"];
const htmlAttrs = home("html").attr();
write("src/partials/head-common.html", headCommon.join("\n"));
write("src/partials/tail-common.html", tailCommon.join("\n"));
write("src/partials/nav.html", unmarkCurrent(home.html(home("body > nav")) + "\n" + home.html(home("body > .nav-spacer"))));
write("src/partials/footer.html", unmarkCurrent(home.html(home("body > footer"))));
write("src/data/site.json", JSON.stringify({ wfSite: htmlAttrs["data-wf-site"], wfDomain: htmlAttrs["data-wf-domain"], lang: htmlAttrs.lang }, null, 2));

// --- main pages: everything between the nav spacer and the footer -------------------
const bodyOf = ($) => $("body").children().filter((_, el) => {
  const c = $(el);
  return !(c.is("nav") && c.hasClass("navbar")) && !c.hasClass("nav-spacer") && !c.is("footer") && !c.is("script");
}).map((_, el) => $.html(el)).get().join("\n");

for (const name of ["index", "banking", "cash-flow", "capital", "pricing", "company"]) {
  const path = name === "index" ? "/" : "/" + name;
  write(`src/partials/pages/${name}.html`, unmarkCurrent(bodyOf(docs[path])));
}

// --- FAQ -----------------------------------------------------------------------
const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", emDelimiter: "*" });
const faq$ = docs["/faq"];
const list = faq$('[fs-list-element="list"]');
const items = list.children(".w-dyn-item");

// one item becomes the template; markers get filled in by the Astro pages
const tpl = faq$(items.get(0)).clone();
tpl.find(".hide .w-dyn-items").html("<!--TAGS-->");
tpl.find(".question-text").html("<!--QUESTION-->");
tpl.find(".answer").html("<!--ANSWER-->");
tpl.find(".faq-icon").attr("data-w-id", "__WID__");
write("src/partials/faq-item.html", faq$.html(tpl));
write("src/partials/faq-tag-chip.html",
  faq$.html(faq$(items.get(0)).find(".hide .w-dyn-item").first().clone().find("p").html("<!--TAG-->").end()));

rmSync(join(ROOT, "src/content/faq"), { recursive: true, force: true });
const slugify = (s) => s.toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const seen = new Set();
items.each((i, el) => {
  const it = faq$(el);
  const question = it.find(".question-text").text().trim();
  const tags = it.find('[fs-list-field="tag"]').map((_, t) => faq$(t).text().trim()).get();
  // trailing breaks/spaces inside <em>/<strong> stop Markdown closing the emphasis
  const answerHtml = it.find(".answer").html().replace(/(<br>)+$/, "")
    .replace(/((?:\s|<br>)+)<\/(em|strong)>/g, "</$2>$1");
  let slug = slugify(question);
  while (seen.has(slug)) slug += "-2";
  seen.add(slug);
  const fm = ["---", `question: ${JSON.stringify(question)}`, `order: ${(i + 1) * 10}`, "tags:", ...tags.map((t) => `  - ${JSON.stringify(t)}`), "---"];
  write(`src/content/faq/${slug}.md`, fm.join("\n") + "\n\n" + td.turndown(answerHtml).trim());
});

// FAQ tags: names + order from /faq's filter pills, slugs from the tag pages' URLs
const tagOrder = faq$('[fs-list-element="filters"] input[fs-list-value]').map((_, e) => faq$(e).attr("fs-list-value")).get();
const tagSlugs = {};
for (const [path, $] of Object.entries(docs)) {
  if (!path.startsWith("/faq-tags/")) continue;
  tagSlugs[$("[fs-list-element=list]").closest("section").find("h1, h2").first().text().trim()] = path.split("/").pop();
}
write("src/data/faq-tags.json", JSON.stringify(tagOrder.map((name) => ({ name, slug: tagSlugs[name] })), null, 2));

// /faq page: filter pills + list become markers
const filterItems = faq$('[fs-list-element="filters"] .w-dyn-items');
const chip = filterItems.children().first().clone();
chip.find("input").attr("fs-list-value", "__TAG__");
chip.find(".checkbox-label").html("<!--TAG-->");
write("src/partials/faq-filter-chip.html", faq$.html(chip));
filterItems.html("<!--FAQ_FILTERS-->");
list.html("<!--FAQ_ITEMS-->");
write("src/partials/pages/faq.html", unmarkCurrent(bodyOf(faq$)));
pagesJson["/faq"].faqWid = faq$(items.get(0)).find(".faq-icon").attr("data-w-id") ?? null;

// tag page template, from any tag page
const tag$ = docs["/faq-tags/pricing-fees"];
const tagList = tag$('[fs-list-element="list"]');
const tagWid = tagList.find(".faq-icon").first().attr("data-w-id");
tagList.html("<!--FAQ_ITEMS-->");
write("src/partials/faq-tag.html", unmarkCurrent(bodyOf(tag$)).replaceAll("Pricing &amp; Fees", "<!--TAG_NAME-->"));
write("src/data/faq-tag-page.json", JSON.stringify({ wfPage: pagesJson["/faq-tags/pricing-fees"].wfPage, wid: tagWid, tail: pagesJson["/faq-tags/pricing-fees"].tail }, null, 2));

// --- legal ---------------------------------------------------------------------
const legal = [];
for (const [path, $] of Object.entries(docs)) {
  if (!path.startsWith("/policies-legals/")) continue;
  legal.push({ slug: path.split("/").pop(), title: $("title").text().replace(/\s+-\s+Hamilton Rock$/, "").trim(), embed: $("[data-embed-src]").attr("data-embed-src") || "" });
}
const legal$ = docs["/policies-legals/privacy-policy"];
legal$("[data-embed-src]").attr("data-embed-src", "__EMBED__");
write("src/partials/legal.html", unmarkCurrent(bodyOf(legal$)));
write("src/data/legal.json", JSON.stringify(legal.sort((a, b) => a.slug.localeCompare(b.slug)), null, 2));

write("src/data/pages.json", JSON.stringify(pagesJson, null, 2));

// --- leftovers check ------------------------------------------------------------
const leftovers = [];
for (const f of readdirSync(join(ROOT, "src/partials"), { recursive: true })) {
  if (!f.endsWith(".html")) continue;
  const t = readFileSync(join(ROOT, "src/partials", f), "utf8");
  for (const m of t.matchAll(/https?:\/\/[^"'\s)<>]+/g)) if (/website-files|webflow\.io|cloudfront|jsdelivr|cdnjs|ajax\.googleapis/.test(m[0])) leftovers.push(`${f}: ${m[0]}`);
}
console.log(`faq items: ${items.length}, tags: ${tagOrder.length}, legal: ${legal.length}, pages: ${Object.keys(pagesJson).length}`);
console.log(leftovers.length ? "external leftovers:\n  " + leftovers.join("\n  ") : "no Webflow/CDN URLs left in partials");
