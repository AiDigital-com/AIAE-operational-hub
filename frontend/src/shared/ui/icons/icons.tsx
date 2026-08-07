/**
 * Small inline SVG icons (no icon-library dependency). Each inherits `currentColor`
 * and a 1em box so it sizes with surrounding text.
 */

interface IconProps {
  className?: string;
}

function svgProps(className?: string) {
  return {
    className,
    width: "1em",
    height: "1em",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

/** Grid / overview glyph. */
export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** Team / stacked people glyph. */
export function TeamIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
      <circle cx="17.5" cy="9" r="2.4" />
      <path d="M16 14.5c2.7.2 5 2 5 5.5" />
    </svg>
  );
}

/** Funnel glyph (matches the reference toolbar). */
export function FilterIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2}>
      <path d="M3 5h18l-7 8v5l-4 2v-7z" />
    </svg>
  );
}

/** Vertical three-dot "more actions" (kebab) glyph. */
export function MoreVerticalIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} fill="currentColor" stroke="none">
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </svg>
  );
}

/** Magnifier glyph. */
export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </svg>
  );
}

/** Users / people glyph for nav. */
export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" />
      <circle cx="17.5" cy="9" r="2.4" />
      <path d="M16 14.5c2.7.2 5 2 5 5.5" />
    </svg>
  );
}

/** Single-user glyph for nav. */
export function ProfileIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

/** Refresh glyph. */
export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
    </svg>
  );
}

/** Settings / gear glyph. */
export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9 2 2 0 1 1-2.8 2.8 1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2 2 2 0 1 1-2.8-2.8 1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9 2 2 0 1 1 2.8-2.8 1.7 1.7 0 0 0 2.9-1.2 2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2 2 2 0 1 1 2.8 2.8 1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** Tree-branch connector glyph, prefixing a line-item row nested under its campaign. */
export function BranchIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2}>
      <path d="M6 3v9a4 4 0 0 0 4 4h7" />
    </svg>
  );
}

/** Plus glyph for "add" actions (add IO, add line item). */
export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Tray-with-arrow glyph for actions that push data out of the Hub (writing a ClicData data source). */
export function UploadIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.2}>
      <path d="M12 16V4M7 9l5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

/** X glyph for close actions (modal/sheet header). */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.2}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** Four-corner expand glyph (visual-only "expand to fullscreen" affordance). */
export function ExpandIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2}>
      <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
    </svg>
  );
}

/** Info-circle glyph for inline note banners. */
export function InfoIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.5M11 12h1v4h1" />
    </svg>
  );
}

/** Pencil glyph for edit-mode banners and actions. */
export function EditIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.2}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/** Curved back arrow glyph for undo actions. */
export function UndoIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.2}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}

interface SortIconProps extends IconProps {
  /** Which direction is currently active, or omitted when this column isn't the active sort. */
  active?: "asc" | "desc";
}

/** Stacked up/down chevrons marking a sortable column header; the active direction stays full-opacity. */
export function SortIcon({ className, active }: SortIconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.4}>
      <path d="M7 10.5l5-5 5 5" opacity={active === "desc" ? 0.35 : 1} />
      <path d="M7 13.5l5 5 5-5" opacity={active === "asc" ? 0.35 : 1} />
    </svg>
  );
}

/** Folder glyph, marking an insertion-order group row. */
export function FolderIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M3 6a1.5 1.5 0 0 1 1.5-1.5H9l2 2.2h8a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 19 19.5H4.5A1.5 1.5 0 0 1 3 18z" />
    </svg>
  );
}

/** Trash-can glyph for delete actions. */
export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </svg>
  );
}

/** Chevron left glyph for sidebar collapse. */
export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.2}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

/** Chevron right glyph for sidebar agency rows. */
export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.2}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

/** Chevron down glyph for a control that opens a menu beneath itself. */
export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.2}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Tick glyph, for a state that has been reached rather than an action to take. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2.4}>
      <path d="M4 12.5l5.5 5.5L20 7" />
    </svg>
  );
}

/** Two offset sheets - copy to clipboard. */
export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H5.5A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
    </svg>
  );
}

interface LogoIconProps extends IconProps {
  fill?: string;
  stroke?: string;
}

/** Moon glyph for dark-mode toggle. */
export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/** Sun glyph for light-mode toggle. */
export function SunIcon({ className }: IconProps) {
  return (
    <svg {...svgProps(className)} strokeWidth={2}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19" />
    </svg>
  );
}

/** Brand sparkle / asterisk logo mark. */
export function LogoIcon({ className, fill = "var(--primary)", stroke = "var(--color-accent-contrast)" }: LogoIconProps) {
  return (
    <svg className={className} width="1em" height="1em" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill={fill} />
      <path d="M16 7v18M7 16h18M9.76 9.76l12.48 12.48M22.24 9.76L9.76 22.24" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
