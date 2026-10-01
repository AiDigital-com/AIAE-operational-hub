/**
 * A tile's ⋯ menu, in this app's own chrome.
 *
 * Pacing ships its own `TileMenu` and the board used it at first - which is wrong here for the same
 * reason the widget BODIES are right: a widget's insides are Pacing's (its grammar, its figures, its
 * typography) and must look the way Pacing draws them, but the furniture AROUND it belongs to the
 * app it is embedded in. Pacing's trigger is a bordered box; every other kebab in this Hub - the
 * Overview row, the Pacing tab row, the sidebar account - is a borderless 30×32 glyph that tints on
 * hover. Two kebab styles on one page reads as two products.
 *
 * So the chrome below is the Hub's and only the item set is Pacing's. The rules live in this
 * folder's own `tile-menu.css` rather than reaching into `features/overview/overview.css`: that
 * stylesheet is not loaded on this route, and a button that borrows another screen's classes loses
 * its styling the day that screen is split.
 */
import { useEffect, useRef, useState } from "react";
import { MoreVerticalIcon } from "../../../shared/ui/icons/icons";
import { cn } from "../../../shared/style/cn";
import "./tile-menu.css";

/** Laid out at this width so the panel can be positioned before it mounts. */
const MENU_WIDTH = 190;
/** Roughly how tall four items get. Only decides whether the panel still fits below the trigger -
 *  the placement never relies on the number, so being a little off cannot misplace it. */
const MENU_MAX_HEIGHT = 170;

export interface TileMenuItem {
  key: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
  onSelect: () => void;
}

type Anchor =
  | { left: number; top: number; bottom?: undefined }
  | { left: number; bottom: number; top?: undefined };

export function WidgetTileMenu({ label, items }: { label: string; items: TileMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Outside click, Escape and scroll all close it - the panel is position:fixed, so a scroll would
  // otherwise leave it hanging where the tile no longer is.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <span className="wtm" ref={wrapRef} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="wtm__kebab"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          // Anchored by `bottom` when it would overflow, so the flipped case is exact rather than a
          // guess at the panel's own height.
          const below = window.innerHeight - rect.bottom;
          setAnchor(
            below < MENU_MAX_HEIGHT
              ? { left: Math.max(8, rect.right - MENU_WIDTH), bottom: window.innerHeight - rect.top + 4 }
              : { left: Math.max(8, rect.right - MENU_WIDTH), top: rect.bottom + 4 }
          );
          setOpen((v) => !v);
        }}
      >
        <MoreVerticalIcon />
      </button>
      {open && (
        <div className="wtm__menu" role="menu" style={{ width: MENU_WIDTH, ...(anchor ?? {}) }}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={cn(item.danger && "wtm__danger")}
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
