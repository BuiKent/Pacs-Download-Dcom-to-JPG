/**
 * Escaping, in one place.
 *
 * Every panel in this app builds its markup as a template string, so the one
 * thing that must never have two implementations is the function that decides
 * what a patient's name is allowed to do when it reaches the DOM.
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
