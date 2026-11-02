import { useEffect, useState, type MutableRefObject } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { cn } from "../../../shared/style/cn";
import { isAllowedHref, type NotesNode } from "./notes-doc";

/**
 * Edit mode of the campaign notes - the ONLY module that imports TipTap, loaded lazily by the panel
 * the first time someone presses Edit, so the dashboard itself never pays for the editor.
 *
 * Ported from the reference SPA (`ogan-team`, `pages/Dashboard/components/Notes/NotesEditor.jsx`):
 * the same extensions, the same toolbar and the same link rule. Links are http/https only, which is
 * exactly what Pacing's validator accepts, so the editor can never produce a link the save refuses.
 */

interface ToolbarButton {
  key: string;
  label: string;
  title: string;
  run: (editor: Editor) => void;
  active: (editor: Editor) => boolean;
}

const TOOLBAR: ToolbarButton[] = [
  { key: "h1", label: "H1", title: "Heading 1", run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
  { key: "h2", label: "H2", title: "Heading 2", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
  { key: "h3", label: "H3", title: "Heading 3", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  { key: "bold", label: "B", title: "Bold", run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
  { key: "italic", label: "I", title: "Italic", run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
  { key: "underline", label: "U", title: "Underline", run: (e) => e.chain().focus().toggleUnderline().run(), active: (e) => e.isActive("underline") },
  { key: "strike", label: "S", title: "Strikethrough", run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
  { key: "code", label: "</>", title: "Inline code", run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  { key: "bullet", label: "•", title: "Bulleted list", run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
  { key: "ordered", label: "1.", title: "Numbered list", run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
  { key: "quote", label: "❝", title: "Quote", run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  { key: "codeblock", label: "{ }", title: "Code block", run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
  { key: "hr", label: "—", title: "Divider", run: (e) => e.chain().focus().setHorizontalRule().run(), active: () => false },
];

/** What the panel needs from the editor: the document to save. */
export interface NotesEditorHandle {
  getJSON: () => NotesNode;
}

interface NotesEditorProps {
  /** The document the session starts from; "dirty" means the editor no longer equals it. */
  initialDoc: NotesNode;
  onDirtyChange: (dirty: boolean) => void;
  /** Filled while the editor is mounted, so the panel's Save can read the document. */
  editorRef: MutableRefObject<NotesEditorHandle | null>;
}

export default function NotesEditor({ initialDoc, onDirtyChange, editorRef }: NotesEditorProps) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const [linkError, setLinkError] = useState("");
  // The toolbar's pressed states read the editor directly; this only asks React to look again.
  const [, setRevision] = useState(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          defaultProtocol: "https",
          isAllowedUri: (url, ctx) => ctx.defaultValidate(url) && /^https?:\/\//i.test(url),
        },
      }),
      Placeholder.configure({ placeholder: "Write campaign notes — headings, lists, links…" }),
    ],
    content: initialDoc as Record<string, unknown>,
    onUpdate: ({ editor: e }) => {
      onDirtyChange(JSON.stringify(e.getJSON()) !== JSON.stringify(initialDoc));
      setRevision((n) => n + 1);
    },
    onSelectionUpdate: () => setRevision((n) => n + 1),
  });

  useEffect(() => {
    editorRef.current = editor ? { getJSON: () => editor.getJSON() as NotesNode } : null;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  if (!editor) return null;

  const applyLink = () => {
    const href = linkHref.trim();
    if (!/^https?:\/\//i.test(href) || !isAllowedHref(href)) {
      setLinkError("http(s):// links only");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
    setLinkHref("");
    setLinkError("");
  };

  const linkActive = editor.isActive("link");

  return (
    <div className="notes-editor">
      <div className="notes-editor__toolbar" role="toolbar" aria-label="Formatting">
        {TOOLBAR.map((button) => {
          const on = button.active(editor);
          return (
            <button
              key={button.key}
              type="button"
              className={cn("notes-editor__tool", on && "notes-editor__tool--on")}
              aria-pressed={on}
              aria-label={button.title}
              title={button.title}
              onClick={() => button.run(editor)}
            >
              {button.label}
            </button>
          );
        })}
        <button
          type="button"
          className={cn("notes-editor__tool", linkActive && "notes-editor__tool--on")}
          aria-pressed={linkActive}
          aria-label="Link"
          title={linkActive ? "Remove link" : "Link"}
          onClick={() => {
            if (linkActive) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            setLinkHref(String(editor.getAttributes("link").href ?? ""));
            setLinkOpen((open) => !open);
            setLinkError("");
          }}
        >
          Link
        </button>
      </div>
      {linkOpen && (
        <div className="notes-editor__link-row">
          <input
            className="notes-editor__link-input"
            value={linkHref}
            placeholder="https://…"
            aria-label="Link address"
            aria-invalid={linkError ? true : undefined}
            onChange={(event) => {
              setLinkHref(event.target.value);
              setLinkError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              }
            }}
          />
          <button type="button" className="button button--sm" onClick={applyLink}>
            Apply
          </button>
          {linkError && <span className="form-error notes-editor__link-error">{linkError}</span>}
        </div>
      )}
      <EditorContent editor={editor} className="notes-editor__content" />
    </div>
  );
}
