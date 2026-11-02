/**
 * The campaign notes document: a TipTap JSON tree (`{type: "doc", content: [...]}`) stored by Pacing
 * as `config_json.campaign_notes_rich`. The pure half of the notes panel - no React, no TipTap.
 *
 * Ported from the reference SPA (`ogan-team`, `workspace/src/lib/notes/render-notes.js`, and the
 * `docFromLegacy` helper of `NotesPanel.jsx`). `plainTextFromDoc` and `hasMeaningfulNotes` are the
 * browser twins of Pacing's own `extractPlainText` / `hasMeaningfulNotes` in
 * `AIAE-paicing/dash-gate/lib/notes.mjs`: the server derives the stored plain text and decides "no
 * notes" by exactly these rules, so the button's dot and Copy agree with what Pacing stores.
 */

/** One node of a TipTap document. Only the fields the notes code reads are declared. */
export interface NotesNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string; attrs?: Record<string, unknown> }[];
  content?: NotesNode[];
}

/** An empty document: one empty paragraph, which is what the editor starts from. */
export const EMPTY_NOTES_DOC: NotesNode = { type: "doc", content: [{ type: "paragraph" }] };

const BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock"]);

/**
 * The document's text, one line per block (paragraph, heading, code block) or hard break, blank
 * lines dropped - the rule Pacing uses to derive `campaign_notes`.
 */
export function plainTextFromDoc(doc: unknown): string {
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    lines.push(current);
    current = "";
  };
  const walk = (node: NotesNode | null | undefined) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "text") {
      current += node.text || "";
      return;
    }
    if (node.type === "hardBreak") {
      flush();
      return;
    }
    for (const child of Array.isArray(node.content) ? node.content : []) walk(child);
    if (node.type && BLOCK_TYPES.has(node.type)) flush();
  };
  walk(doc as NotesNode);
  if (current !== "") flush();
  return lines.filter((line) => line !== "").join("\n");
}

/** Whether a document holds any non-blank text - Pacing clears the notes when it does not. */
export function hasMeaningfulNotes(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  return plainTextFromDoc(doc).trim().length > 0;
}

/** Whether the pacing has notes at all: a document with text, or the plain text an older pacing carries. */
export function hasAnyNotes(notesRich: unknown, notes: string | null | undefined): boolean {
  return hasMeaningfulNotes(notesRich) || (notes ?? "").trim() !== "";
}

/**
 * A document for the editor to start from when the pacing has only plain text (typed at create, or
 * saved before rich notes existed): one paragraph per non-blank line.
 */
export function docFromPlainText(plain: string | null | undefined): NotesNode {
  const lines = String(plain || "").split("\n").filter((line) => line.trim() !== "");
  if (!lines.length) return EMPTY_NOTES_DOC;
  return {
    type: "doc",
    content: lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}

/** Only http and https links are ever followed - the same allow-list as Pacing's validator. */
export function isAllowedHref(href: unknown): boolean {
  try {
    const url = new URL(String(href));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
