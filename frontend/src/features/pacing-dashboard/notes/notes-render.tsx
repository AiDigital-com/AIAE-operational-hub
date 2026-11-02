import { Fragment, type ReactNode } from "react";
import { isAllowedHref, type NotesNode } from "./notes-doc";

/**
 * Read mode of the campaign notes: the TipTap document drawn as plain React elements, with no TipTap
 * loaded at all (the editor is a separate, lazily loaded chunk).
 *
 * Ported from the reference SPA (`ogan-team`, `workspace/src/lib/notes/render-notes.js`). Its
 * whitelist mirrors Pacing's validator (`AIAE-paicing/dash-gate/lib/notes.mjs`) and is the second
 * wall against unsafe markup: an unknown node degrades to its text, and a link that is not http or
 * https renders as plain text. Nothing is ever inserted as HTML.
 */

const MARK_TAGS: Record<string, "strong" | "em" | "s" | "u" | "code"> = {
  bold: "strong",
  italic: "em",
  strike: "s",
  underline: "u",
  code: "code",
};

function renderText(node: NotesNode, key: number): ReactNode {
  let element: ReactNode = node.text || "";
  for (const mark of node.marks || []) {
    const href = mark.attrs?.href;
    if (mark.type === "link" && isAllowedHref(href)) {
      element = (
        <a key={key} href={String(href)} target="_blank" rel="noopener noreferrer">
          {element}
        </a>
      );
    } else if (mark.type && MARK_TAGS[mark.type]) {
      const Tag = MARK_TAGS[mark.type];
      element = <Tag key={key}>{element}</Tag>;
    }
  }
  return typeof element === "string" ? <Fragment key={key}>{element}</Fragment> : element;
}

function renderNode(node: NotesNode | null | undefined, key: number): ReactNode {
  if (!node || typeof node !== "object") return null;
  const children = (Array.isArray(node.content) ? node.content : []).map((child, i) => renderNode(child, i));
  switch (node.type) {
    case "text":
      return renderText(node, key);
    case "hardBreak":
      return <br key={key} />;
    case "paragraph":
      // An empty paragraph keeps its line, as it did in the editor.
      return <p key={key}>{children.length ? children : " "}</p>;
    case "heading": {
      const level = node.attrs?.level;
      if (level === 2) return <h2 key={key}>{children}</h2>;
      if (level === 3) return <h3 key={key}>{children}</h3>;
      return <h1 key={key}>{children}</h1>;
    }
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList": {
      const start = Number(node.attrs?.start);
      return (
        <ol key={key} start={start > 1 ? start : undefined}>
          {children}
        </ol>
      );
    }
    case "listItem":
      return <li key={key}>{children}</li>;
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    case "horizontalRule":
      return <hr key={key} />;
    default:
      // An unknown node shows its text rather than nothing, and never its markup.
      return children.length ? <Fragment key={key}>{children}</Fragment> : null;
  }
}

/** The stored document, drawn. */
export function NotesDocument({ doc }: { doc: NotesNode }) {
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  return <div className="notes-doc">{blocks.map((node, i) => renderNode(node, i))}</div>;
}

/** An older pacing's plain-text notes: one paragraph per non-blank line. */
export function NotesPlainText({ text }: { text: string }) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return (
    <div className="notes-doc">
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}
