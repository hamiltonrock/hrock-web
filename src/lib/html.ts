// Helpers for the Webflow HTML partials in src/partials.

// Mark links to the current page the way Webflow did (styling keys off w--current).
export function markCurrent(html: string, path: string): string {
  const href = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(
    new RegExp(`<a href="${href}"( class="([^"]*)")?`, "g"),
    (_m, _c, cls) => `<a href="${path}" aria-current="page" class="${cls ? cls + " " : ""}w--current"`,
  );
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Fill <!--MARKER--> and __MARKER__ placeholders in a partial.
export function fill(html: string, values: Record<string, string>): string {
  let out = html;
  for (const [k, v] of Object.entries(values)) out = out.replaceAll(`<!--${k}-->`, v).replaceAll(`__${k}__`, v);
  return out;
}
