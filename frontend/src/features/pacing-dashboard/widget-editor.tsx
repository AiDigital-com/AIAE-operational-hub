/**
 * The widget builder, as a panel over the library list.
 *
 * Pacing's own `WidgetBuilder` is mounted unchanged (see `spa/SOURCE.md`); everything here is the
 * frame around it and the one decision it does not make: WHEN an edit becomes a save.
 *
 * It does not make that decision there either. The builder reports each change through `onPatch`
 * and owns no persistence, which is what lets it sit inside this drawer's draft rather than beside
 * it: a widget edited here changes the same draft the library list holds, and the drawer's single
 * Save commits both. The alternative - the builder writing on its own - would have put two save
 * models on one screen, which is the thing `widgets-section.tsx` exists to avoid.
 */
import { useEffect, useState } from "react";
import { CloseIcon } from "../../shared/ui/icons/icons";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import WidgetBuilder from "./spa/builder/ReportBuilder.jsx";
import type { PacingWidgetInstance } from "./types";
import "./widget-editor.css";

export function WidgetEditor({
  widget,
  onPatch,
  onClose,
}: {
  /** What the tile DRAWS, with the name it wears - a linked instance carries no spec of its own. */
  widget: PacingWidgetInstance;
  /** Each change, as an UPDATER over the widget - the builder's own contract
   *  (`onPatch((w) => ({ ...w, spec: … }))`). The caller applies it to its draft; nothing is saved
   *  here, which is what lets the builder sit inside the drawer's single Save. */
  onPatch: (updater: (w: PacingWidgetInstance) => PacingWidgetInstance) => void;
  onClose: () => void;
}) {
  // The builder holds its own undo history keyed on the widget it opened with, so a remount per
  // widget is what keeps one tile's history out of another's.
  const [mountKey] = useState(() => widget.id);

  // Escape closes, as it does everywhere else in this drawer. Capture phase, because the builder's
  // own popovers close on Escape too and the innermost one should win.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="wedit">
      <div className="wedit__bar">
        <span className="wedit__title">Editing widget</span>
        <button type="button" className="wedit__close" onClick={onClose} aria-label="Close the widget editor">
          <CloseIcon />
        </button>
      </div>
      <div className="wedit__body">
        <WidgetBuilder key={mountKey} widget={widget} onPatch={onPatch} onBack={onClose} />
      </div>
    </div>
  );
}
