import { MAX_LINK_NAME_LENGTH, MAX_LINK_URL_LENGTH } from "./constants/link-limits";

/**
 * Client-side validation of one campaign link (§16, US-140/141) - the same rules the Hub backend's
 * `CampaignLinksValidator` enforces with 400, run before the request so the drawer can name the
 * offending field instead of round-tripping to learn it. The backend stays the authority; a
 * mismatch here only costs one extra error message, never a stored bad link.
 *
 * The reference implementation had no validation at all - this is the one deliberate departure
 * from it, because US-141 explicitly requires the Asana check and the Hub renders every stored URL
 * clickable (so `javascript:`/`data:` must never get as far as an href).
 */

/** Parses a trimmed URL and answers whether it is an absolute http/https one with a host. */
function parseHttpUrl(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const httpScheme = parsed.protocol === "http:" || parsed.protocol === "https:";
  return httpScheme && parsed.hostname ? parsed : null;
}

/**
 * Whether a URL looks like an Asana project link (US-141): Asana's own host, pointing at something
 * inside Asana rather than the bare front page. Deliberately loose beyond that - Asana has shipped
 * several project-URL shapes (`/0/<id>/...`, `/1/<ws>/project/<id>/...`) and pinning one would
 * refuse links Asana itself hands out. Mirrors the backend's `looksLikeAsanaProject`.
 */
export function isAsanaProjectUrl(url: string): boolean {
  const parsed = parseHttpUrl(url.trim());
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  const asanaHost = host === "app.asana.com" || host.endsWith(".asana.com");
  return asanaHost && parsed.pathname.length > 1;
}

/**
 * Validates one link the panel is about to save. Returns the sentence to show, or null when the
 * link is fine. `name`/`url` arrive as typed; trimming happens here so the caller's draft state
 * can keep the user's spacing while it is being edited.
 */
export function validateCampaignLink(name: string, url: string): string | null {
  const trimmedName = name.trim();
  const trimmedUrl = url.trim();
  if (!trimmedName) return "Every link needs a name.";
  if (trimmedName.length > MAX_LINK_NAME_LENGTH) {
    return `'${trimmedName.slice(0, 24)}…': the name is too long (at most ${MAX_LINK_NAME_LENGTH} characters).`;
  }
  if (trimmedUrl.length > MAX_LINK_URL_LENGTH) {
    return `'${trimmedName}': the URL is too long (at most ${MAX_LINK_URL_LENGTH} characters).`;
  }
  if (!parseHttpUrl(trimmedUrl)) {
    return `'${trimmedName}': the URL must be a full http:// or https:// address.`;
  }
  if (trimmedName === "Asana" && !isAsanaProjectUrl(trimmedUrl)) {
    return "The Asana link must point at an Asana project (an app.asana.com URL).";
  }
  return null;
}
