// One-off capture of the live Webflow site (there is no code export on our plan).
//
//   pages  -> _scrape/pages/<path>.html   raw HTML, untouched (gitignored)
//   assets -> public/wf/<cdn path>        everything on cdn.prod.website-files.com
//   vendor -> public/vendor/<file>        third-party scripts the pages load
//   report -> _scrape/report.json         every URL fetched, redirects, failures
//
// Exits non-zero if anything failed to download. Safe to re-run: files already on
// disk are skipped, so a re-run only fetches what's missing.

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const SITE = "https://www.hamiltonrock.com";
const CDN = "https://cdn.prod.website-files.com/";
const ROOT = new URL("..", import.meta.url).pathname;
const SCRAPE = join(ROOT, "_scrape");
const WF = join(ROOT, "public/wf");
const VENDOR = join(ROOT, "public/vendor");

const report = { startedAt: new Date().toISOString(), pages: [], assets: [], vendor: [], failures: [] };

const exists = (p) => access(p).then(() => true, () => false);

async function get(url, { redirect = "follow" } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { redirect, headers: { "user-agent": "hrock-web-migration/1.0" } });
      if (res.status >= 500 && attempt < 3) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// cdn URL -> local path under public/wf, decoded so the static server finds it
function cdnLocal(url) {
  const path = new URL(url).pathname.slice(1);
  return join(WF, decodeURIComponent(path));
}

const CDN_RE = /https:\/\/cdn\.prod\.website-files\.com\/[^"'\s)<>,]+/g;

async function download(url, dest, bucket) {
  if (await exists(dest)) { bucket.push({ url, dest, skipped: true }); return true; }
  try {
    const res = await get(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    bucket.push({ url, dest: dest.replace(ROOT, ""), bytes: buf.length });
    return true;
  } catch (err) {
    report.failures.push({ url, error: String(err.message || err) });
    return false;
  }
}

// --- 1. pages -------------------------------------------------------------
const sitemap = await (await get(`${SITE}/sitemap.xml`)).text();
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
console.log(`sitemap: ${paths.length} pages`);

const assetUrls = new Set();
const vendorUrls = new Set();

await pool(paths, 4, async (path) => {
  const url = SITE + path;
  try {
    // Don't follow redirects blindly: a redirect (e.g. to Stripe) becomes a Netlify rule.
    const res = await get(url, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      report.pages.push({ path, status: res.status, location: res.headers.get("location") });
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const file = join(SCRAPE, "pages", (path === "/" ? "index" : path.slice(1)) + ".html");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
    report.pages.push({ path, status: res.status, bytes: html.length });

    for (const m of html.matchAll(CDN_RE)) assetUrls.add(m[0].replace(/&amp;/g, "&"));
    for (const m of html.matchAll(/<script[^>]+src="(https?:\/\/[^"]+)"/g)) {
      if (!m[1].startsWith(CDN)) vendorUrls.add(m[1].replace(/&amp;/g, "&"));
    }
  } catch (err) {
    report.failures.push({ url, error: String(err.message || err) });
  }
});

// --- 2. Webflow CDN assets ------------------------------------------------
console.log(`assets: ${assetUrls.size} on the Webflow CDN`);
await pool([...assetUrls], 8, (url) => download(url, cdnLocal(url), report.assets));

// CSS pulls in more (fonts, background images): fetch those and point them at /wf/.
const cssFiles = [...assetUrls].filter((u) => /\.css(\?|$)/.test(u));
for (const cssUrl of cssFiles) {
  const file = cdnLocal(cssUrl);
  let css;
  try { css = await readFile(file, "utf8"); } catch { continue; }
  const refs = new Set();
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    if (m[1].startsWith("data:")) continue;
    // a previous run already rewrote this CSS to /wf/...; map it back to the CDN
    const abs = m[1].startsWith("/wf/") ? CDN + m[1].slice(4) : new URL(m[1], cssUrl).href;
    if (abs.startsWith(CDN)) refs.add(abs);
    else if (abs.startsWith("http")) {
      // other hosts (e.g. Webflow's CloudFront checkbox icon) go under public/vendor
      const u = new URL(abs);
      const local = join(u.hostname, decodeURIComponent(u.pathname));
      await download(abs, join(VENDOR, local), report.vendor);
      css = css.replaceAll(abs, "/vendor/" + local);
    }
  }
  console.log(`css ${basename(file)}: ${refs.size} referenced files`);
  await pool([...refs], 8, (url) => download(url, cdnLocal(url), report.assets));
  await writeFile(file, css.replaceAll(CDN, "/wf/"));
}

// --- 3. third-party scripts ----------------------------------------------
console.log(`vendor: ${vendorUrls.size} scripts`);
report.vendorMap = {};
await pool([...vendorUrls], 4, async (url) => {
  const u = new URL(url);
  // keep the host + path so two files called e.g. "attributes.js" can't collide
  const local = join(u.hostname, decodeURIComponent(u.pathname));
  report.vendorMap[url] = "/vendor/" + local;
  await download(url, join(VENDOR, local), report.vendor);
});

// Finsweet Attributes v2's attributes.js is only a loader: it imports ./dist/*.js
// relative to itself. Take dist/ from the npm tarball (Apache-2.0). `npm install`
// of this package fails on a broken sub-dependency, hence the tarball.
const FS_VERSION = "2.7.1";
const fsLoader = Object.entries(report.vendorMap).find(([u]) => u.includes("@finsweet/attributes@2/"));
if (fsLoader) {
  const destDir = dirname(join(VENDOR, fsLoader[1].replace("/vendor/", "")));
  if (!(await exists(join(destDir, "dist")))) {
    const tgz = `https://registry.npmjs.org/@finsweet/attributes/-/attributes-${FS_VERSION}.tgz`;
    try {
      const res = await get(tgz);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tmp = join(SCRAPE, "finsweet.tgz");
      await mkdir(SCRAPE, { recursive: true });
      await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      execFileSync("tar", ["xzf", tmp, "-C", destDir, "--strip-components=1", "package/dist", "package/LICENSE.md"]);
      report.vendor.push({ url: tgz, dest: destDir.replace(ROOT, "") + "/dist" });
    } catch (err) {
      report.failures.push({ url: tgz, error: String(err.message || err) });
    }
  }
}

// --- report ---------------------------------------------------------------
report.finishedAt = new Date().toISOString();
await mkdir(SCRAPE, { recursive: true });
await writeFile(join(SCRAPE, "report.json"), JSON.stringify(report, null, 2));

const redirects = report.pages.filter((p) => p.location);
console.log(`\npages saved: ${report.pages.length - redirects.length}, redirects: ${redirects.length}`);
for (const r of redirects) console.log(`  ${r.path} -> ${r.status} ${r.location}`);
console.log(`assets: ${report.assets.length}, vendor: ${report.vendor.length}, failures: ${report.failures.length}`);
for (const f of report.failures) console.log(`  FAIL ${f.url}: ${f.error}`);
process.exit(report.failures.length ? 1 : 0);
