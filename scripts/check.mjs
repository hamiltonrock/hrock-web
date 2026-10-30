// Compares each built page (dist/) with its scraped original (_scrape/pages): visible
// text, image/link/script URLs, element counts, titles and Webflow hooks. Run after
// `just build`. Expected changes (local URLs, Netlify form fields) are allowed for.

import { load } from "cheerio";
import { readFileSync, existsSync } from "node:fs";
const sm = readFileSync("_scrape/report.json", "utf8");
const paths = JSON.parse(sm).pages.map((p) => p.path);
const text = ($) => $("body").clone().find("script,style").remove().end().text().replace(/\s+/g, "");
const vm = JSON.parse(sm).vendorMap;
const norm = (u) => (vm[(u||"").replace(/&amp;/g,"&")] ?? u ?? "").replace("https://cdn.prod.website-files.com/", "/wf/").replace(/^https:\/\/(www\.)?hamiltonrock\.com/, "").replace(/^https:\/\/hamilton-rock\.webflow\.io/, "") || "/";
let bad = 0;
for (const p of paths) {
  const f = p === "/" ? "dist/index.html" : `dist${p}.html`;
  if (!existsSync(f)) { console.log(`${p}: not built`); continue; }
  const a = load(readFileSync(`_scrape/pages/${p === "/" ? "index" : p.slice(1)}.html`, "utf8"));
  const b = load(readFileSync(f, "utf8"));
  const issues = [];
  const ta = text(a), tb = text(b);
  if (ta !== tb) { let i = 0; while (ta[i] === tb[i]) i++; issues.push(`text differs at ${i}: «${ta.slice(i - 30, i + 50)}» vs «${tb.slice(i - 30, i + 50)}»`); }
  for (const [sel, attr] of [["img", "src"], ["a", "href"], ["script[src]", "src"], ["[data-src]", "data-src"]]) {
    // the Finsweet v2 loader tag is created at runtime (see convert.mjs), so it is not in dist
    const xa = a(sel).map((_, e) => norm(a(e).attr(attr))).get().filter((x) => !x.endsWith("@finsweet/attributes@2/attributes.js")), xb = b(sel).map((_, e) => b(e).attr(attr)).get().filter((x) => x !== "/js/waitlist.js");
    if (JSON.stringify(xa) !== JSON.stringify(xb)) issues.push(`${sel}: ${xa.length} vs ${xb.length}; first diff ${xa.find((x, i) => x !== xb[i])} -> ${xb.find((x, i) => x !== xa[i])}`);
  }
  const ca = a("body *").not("br").filter((_, e) => !(e.name === "script" && a(e).html().includes(".counterup{"))).length, cb = b("body *").not("br, input[name=form-name], script[src=\"/js/waitlist.js\"]").length;
  if (Math.abs(ca - cb) > 0) issues.push(`elements ${ca} vs ${cb}`);
  if (a("title").text() !== b("title").text()) issues.push(`title «${a("title").text()}» vs «${b("title").text()}»`);
  for (const sel of ["[data-w-id]", ".w-dyn-item", "form", "iframe"]) if (a(sel).length !== b(sel).length) issues.push(`${sel} ${a(sel).length} vs ${b(sel).length}`);
  if (issues.length) bad++;
  console.log(`${issues.length ? "✗" : "✓"} ${p}${issues.length ? "\n    " + issues.join("\n    ") : ""}`);
}
console.log(bad ? `${bad} pages differ` : "all pages match");
