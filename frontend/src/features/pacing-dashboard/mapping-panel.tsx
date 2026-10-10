import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  savePacingMappings, suggestPacingMappingLibrary,
  type PacingMappingSuggestion,
} from "./api";
import { formatError } from "../../shared/format/error";
import type { SettingsSectionHandle, SettingsSectionProps } from "./settings-section";
// The comparison engine itself, and the row builders the compare widget already uses. Imported
// rather than reimplemented: this editor's job is to PREDICT what the widget will do, and the only
// way to be sure is to ask the same code. An editor that reasons about matching on its own is a
// second implementation of the rule, and the day the two disagree nothing in either repository
// notices.
import MappingDims from "@shared/mapping-dims";
import {
  buildDeliveryRows, buildCm360Groups, buildEffectiveMapping, buildDeliveryCreativesMap,
  creativesBySubRow, buildDeliveryCreativeRows, buildCm360CreativeGroups, creativeCoverage,
} from "./spa/rows.js";
// The reference's own fingerprint, moved in rather than re-derived. It is deliberately blind to
// alias ORDER (aliases are a set) and to object key order, and it excludes the audit stamps the
// server writes - so the drawer does not call itself dirty over something nobody edited.
import { normMappingsV3 } from "./spa/mapping-v3-norm.js";
import "./mapping-panel.css";

/** The drag payload a pool chip carries. A private type so a stray drag from elsewhere on the page
 *  cannot land in a dimension. */
const TOKEN_MIME = "mp3/token";
/** A dimension card being dragged to a new position. */
const DIM_MIME = "mp3/dim";
/** A suggestion card being dragged into the grid. Three distinct types, so a drop target can tell
 *  what landed on it without guessing from the payload. */
const SUGG_MIME = "mp3/sugg";

const { classifyAll, mineTokens } = MappingDims as unknown as {
  classifyAll: (input: Record<string, unknown>) => ClassifyResult;
  mineTokens: (input: Record<string, unknown>) => MinedToken[];
};

/** One chip in the "Detected in names" pool: the word, how often it occurred, and where from. */
export interface MinedToken {
  token: string;
  count: number;
  side: "delivery" | "cm360" | "both";
}

/** `classifyAll`'s per-dimension reach: how many rows on each side it managed to classify. */
interface PerDim {
  dimId: string;
  dCount: number;
  dTotal: number;
  cCount: number;
  cTotal: number;
}

/** `cell_overrides[side][rowKey][dimId]` - a human's answer, which wins over the engine's. */
type CellOverrides = Record<string, Record<string, Record<string, string>>>;

interface ClassifyResult {
  perDim: PerDim[];
  unresolvedCount: number;
  deliveryCells: Record<string, Record<string, string | null>>;
  cm360Cells: Record<string, Record<string, string | null>>;
}

/**
 * Settings → Mapping: the dimension libraries that let CM360 rows and delivery rows be compared.
 *
 * WHY THIS SCREEN EXISTS AT ALL. The two sides name nothing the same way. Delivery rows carry the
 * exploded dimension columns of the delivery mart; CM360 rows carry an ad server's placement and
 * creative strings. A comparison is only possible once somebody says which values on one side mean
 * the same thing as which words on the other, and no amount of data makes that decision - it is
 * domain knowledge. Until it is written down the compare widget says "Nothing classified yet".
 *
 * HOW A VALUE MATCHES, because the editor is unusable without knowing it - and the two sides match
 * by DIFFERENT rules (shared/mapping-dims.js:classifyRow):
 *   - DELIVERY: structured-field EQUALITY. Delivery rows are built with `name: ''`
 *     (`buildDeliverySubRows`), so their name is never consulted; `structuredHits` compares the
 *     value (or an alias) against the row's field values, folded, whole. "CTV" matches a `tactic`
 *     of "CTV"; it does not match a field that merely contains the word.
 *   - CM360: a WHOLE TOKEN inside `placement + ' ' + creative`, folded. "ctv" matches
 *     "Hulu-CTV-15s"; it does not match "CTVision". That side has no structured fields to compare.
 * So a value bridges only when it hits BOTH sides, by each side's own rule - which is why this
 * screen shows what is actually on each side rather than asking anyone to type into the dark.
 *
 * SCOPE. This writes `mappings_v3` whole, as the endpoint takes it. It deliberately does not offer
 * cell overrides or the AI suggestion flows the retired SPA had: those sit on top of a library, and
 * a library that cannot be written at all is the thing that blocks the feature.
 */

/** One value inside a dimension: the label, plus the spellings that should also match it. */
interface ValueDraft {
  value: string;
  aliases: string[];
}

/** One dimension of a mapping - a question asked of both sides, with the answers it accepts. */
interface DimensionDraft {
  id: string;
  name: string;
  /** `manual` is the hand-built library this screen writes. `auto`/`names` are Pacing's other two
   *  sources; a mapping that already uses them is shown read-only rather than silently rewritten. */
  source: string;
  autoKind: string | null;
  values: ValueDraft[];
}

/** One mapping entity: a named library, at one comparison level. */
interface MappingDraft {
  id: string;
  name: string;
  /** What the widget lines up: `placement` = line items against CM360 placements, `li_creative` =
   *  line items against placement x creative rows, `creative` = creatives against creatives.
   *  All three are stored values Pacing accepts (`third-party.mjs`), so all three must round-trip -
   *  reading an unknown one as `placement` would silently downgrade a mapping on the next save. */
  level: string;
  dimensions: DimensionDraft[];
  /** Manual per-row picks, keyed side -> row key -> dimension. Edited here (that is what the row
   *  tables write), so it is pulled out of `rest` rather than carried blindly. */
  cellOverrides: CellOverrides;
  /** Everything this screen does not edit, carried forward verbatim so a save cannot drop it. */
  rest: Record<string, unknown>;
}

export interface PacingMappingSectionProps extends SettingsSectionProps {
  slug: string | undefined;
  /** `mappings_v3` from the dashboard payload. NULL and [] are different: null means the pacing
   *  predates the model. Both start this editor empty; only a save decides what is stored. */
  mappings: Record<string, unknown>[] | null | undefined;
  /** The published CM360 file, for the reference list. Absent until a pull has landed. */
  cm360: { rows?: Record<string, unknown>[] | null } | null | undefined;
  /** The delivery side, as the engine wants it: the raw facts, the per-line-item channel list and
   *  the plan. `buildDeliveryRows` turns them into the same rows the compare widget classifies, so
   *  this editor predicts the widget rather than guessing alongside it.
   *
   *  Note what is NOT here: line item names. The engine builds delivery rows with `name: ''`
   *  (`buildDeliverySubRows`) and classifies that side by structured-field EQUALITY, so the name is
   *  never consulted and the payload does not even carry it. */
  factsDaily?: Record<string, unknown>[] | null;
  types?: Record<string, unknown>[] | null;
  liPlan?: Record<string, unknown> | null;
  /** DSP-native creative rows, when `fetch_creatives` is on and the aux file landed. `null` means
   *  "this pacing does not collect creatives", which is what gates the creative level. */
  creatives?: Record<string, unknown>[] | null;
  /** Changes identity when the server payload is replaced, so the draft re-seeds. */
  seedKey: number;
}

/** All three levels Pacing stores. `creative` needs the creatives aux file, so it is offered only
 *  when this pacing collects one - picking it otherwise would compare against nothing. */
const LEVELS = [
  {
    value: "placement",
    label: "Line items ↔ placements",
    hint: "Delivery line items against CM360 placements.",
  },
  {
    value: "li_creative",
    label: "Line items ↔ creatives",
    hint: "Delivery line items against CM360 placement x creative rows - use when one placement mixes creatives from different units.",
  },
  {
    value: "creative",
    label: "Creatives ↔ creatives",
    hint: "Needs \"Fetch creatives\" in Settings → Data.",
  },
] as const;

/** Fold a string the way shared/mapping-dims.js does, so this screen counts matches the way the
 *  engine will. Whitespace-collapsed, lowercased - nothing else. */
function fold(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}


/** A stable id for a new entity. Matches Pacing's own shape so a round-trip keeps it. */
function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Read the server's mapping list into the editor's draft, keeping every field it does not edit. */
function seed(mappings: Record<string, unknown>[] | null | undefined): MappingDraft[] {
  if (!Array.isArray(mappings)) return [];
  return mappings.map((m) => {
    const { id, name, level, dimensions, cell_overrides: overrides, ...rest } = m as Record<string, unknown>;
    const dims = Array.isArray(dimensions) ? dimensions : [];
    return {
      id: typeof id === "string" && id ? id : newId("mp"),
      name: typeof name === "string" && name ? name : "Mapping",
      // Mirrors Pacing's own allow-list. A stored `li_creative` that fell through to `placement`
      // here would be written back as `placement` by the next save, quietly re-pointing the widget
      // at different rows - a data change nobody asked for and nobody can see.
      level: level === "creative" || level === "li_creative" ? level : "placement",
      dimensions: dims.map((d) => {
        const dim = (d ?? {}) as Record<string, unknown>;
        const values = Array.isArray(dim.values) ? dim.values : [];
        return {
          id: typeof dim.id === "string" && dim.id ? dim.id : newId("dim"),
          name: typeof dim.name === "string" ? dim.name : "",
          source: typeof dim.source === "string" ? dim.source : "manual",
          autoKind: typeof dim.auto_kind === "string" ? dim.auto_kind : null,
          values: values.map((v) => {
            const val = (v ?? {}) as Record<string, unknown>;
            return {
              value: typeof val.value === "string" ? val.value : "",
              aliases: Array.isArray(val.aliases) ? val.aliases.map(String) : [],
            };
          }),
        };
      }),
      cellOverrides: isOverrideMap(overrides) ? overrides : {},
      rest,
    };
  });
}

/** Overrides arrive from the wire untyped. Anything that is not a plain nested string map is
 *  dropped rather than half-trusted: a malformed entry would make a cell claim a pick it has not
 *  got, and the save would write the malformation back. */
function isOverrideMap(v: unknown): v is CellOverrides {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const side of Object.values(v as Record<string, unknown>)) {
    if (!side || typeof side !== "object" || Array.isArray(side)) return false;
    for (const row of Object.values(side as Record<string, unknown>)) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    }
  }
  return true;
}

/** A row in either table. The two sides carry different fields, so this is the union of what the
 *  label and impressions columns read. */
interface TableRow {
  key: string;
  liId?: string;
  label?: string;
  display?: string;
  placement?: string;
  creative?: string;
  impressions?: number;
  /** ISO date this row was last seen delivering - what the activity filter counts back from. */
  last_seen?: string | null;
}

const fmtNum = (n: unknown) => Number(n || 0).toLocaleString("en-US");

/** What to call a row. A delivery row has no composed name - the pipeline split it into fields
 *  server-side - so fall back to the fields that actually tell them apart. */
function rowLabel(r: TableRow, side: "delivery" | "cm360"): string {
  if (side === "cm360") {
    return [r.placement ?? r.key, r.creative].filter(Boolean).join(" · ");
  }
  const named = r.label || r.display;
  if (named) return named;
  return r.liId ? `LI ${r.liId}` : r.key;
}

/** The row-key separator the engine uses inside a delivery sub-row key (line item + fields). */
const KEY_SEP = "\u0001";

/**
 * Write (or clear) one manual pick, the way the reference's `setCellOverride` does.
 *
 * Two rules carry real weight. The delivery side of an auto dimension is NOT overridable - the
 * structured field is the truth there, and the CM360 side of the same dimension is, because it has
 * no such field. And clearing a sub-row cell must also drop the older line-item-level entry for
 * that dimension, or the effective view re-expands it on the next render and the pick comes back
 * from the dead.
 */
function setCellOverride(
  base: CellOverrides,
  dim: DimensionDraft,
  side: string,
  key: string,
  dimId: string,
  value: string | null,
): CellOverrides {
  if (dim.autoKind && side !== "cm360") return base;

  const out: CellOverrides = {};
  for (const [s, rows] of Object.entries(base)) {
    out[s] = {};
    for (const [k, cols] of Object.entries(rows)) out[s][k] = { ...cols };
  }

  if (value == null || value.trim() === "") {
    const sideMap = out[side];
    if (sideMap) {
      const targets = [key];
      if (side === "delivery" && !key.startsWith(`cr${KEY_SEP}`)) {
        const sep = key.indexOf(KEY_SEP);
        if (sep > 0) targets.push(key.slice(0, sep));
      }
      for (const k of targets) {
        if (!sideMap[k]) continue;
        delete sideMap[k][dimId];
        if (Object.keys(sideMap[k]).length === 0) delete sideMap[k];
      }
      if (Object.keys(sideMap).length === 0) delete out[side];
    }
    return out;
  }

  if (!out[side]) out[side] = {};
  if (!out[side][key]) out[side][key] = {};
  out[side][key][dimId] = String(value);
  return out;
}

/**
 * Turn the draft back into the wire shape, dropping the rows a user left blank.
 *
 * The three auto dimensions are SERIALISED, not just rendered. They are what makes a mapping
 * classify anything at all before a library exists - the widget reads the stored entity, and a
 * stored entity with no dimensions classifies nothing, so a mapping nobody added a dimension to
 * would say "Nothing classified yet" forever. Seeding on both sides of the dirty comparison keeps
 * it honest: an untouched mapping still reads as clean.
 */
function toWire(drafts: MappingDraft[]): Record<string, unknown>[] {
  return drafts.map(withAutoDims).map((m) => ({
    ...m.rest,
    id: m.id,
    name: m.name.trim() || "Mapping",
    level: m.level,
    ...(Object.keys(m.cellOverrides).length ? { cell_overrides: m.cellOverrides } : {}),
    dimensions: m.dimensions
      .filter((d) => d.name.trim())
      .map((d) => ({
        id: d.id,
        name: d.name.trim(),
        source: d.source,
        ...(d.autoKind ? { auto_kind: d.autoKind } : {}),
        values: d.values
          .filter((v) => v.value.trim())
          .map((v) => ({
            value: v.value.trim(),
            aliases: v.aliases.map((a) => a.trim()).filter(Boolean),
          })),
      })),
  }));
}

/** The wire shape of one dimension, as the engine reads it. */
interface WireDim {
  id: string;
  name: string;
  source: string;
  auto_kind?: string;
  values: { value: string; aliases: string[] }[];
}

/** A delivery row as `buildDeliveryRows` emits it - `fields` is the structured tuple the engine
 *  classifies on, and the only part this screen reads. */
interface DeliveryRow {
  key: string;
  fields: Record<string, string>;
}

/** The three dimensions every mapping gets for free, because both sides can answer them without
 *  anyone authoring a thing: the delivery side reads a structured field (channel/tactic) or the row
 *  date (month). Ids are fixed so that seeding is deterministic and can never read as an edit. */
const AUTO_DIMS: DimensionDraft[] = [
  { id: "dm_auto_channel", name: "Channel", source: "auto", autoKind: "channel", values: [] },
  { id: "dm_auto_tactic", name: "Tactic", source: "auto", autoKind: "tactic", values: [] },
  { id: "dm_auto_month", name: "Month", source: "auto", autoKind: "month", values: [] },
];

/** A mapping with no dimensions of its own shows the three auto ones. RENDER ONLY: this never goes
 *  back through `onChange`, so opening a freshly created mapping does not dirty the drawer and
 *  saving it does not silently store three dimensions nobody asked for. */
function withAutoDims(m: MappingDraft): MappingDraft {
  if (m.dimensions.length) return m;
  return { ...m, dimensions: AUTO_DIMS.map((d) => ({ ...d, values: [] })) };
}

/** One entity in the shape the engine reads. */
function toWireEntity(m: MappingDraft): Record<string, unknown> {
  return toWire([m])[0];
}

/** The delivery side carries no composed name - the engine builds its rows with `name: ''` and
 *  classifies them by field equality. The token POOL still wants words, so the structured field
 *  values are glued into a synthetic `_`-delimited name and fed to the engine's own name tokenizer,
 *  which reads positions 5-16. Classification never sees this string, so no false token match can
 *  leak in through it. `channel` and `tactic` are left out: they are auto dimensions that classify
 *  themselves, and pooling their values would invite someone to author a duplicate by hand. */
function syntheticNameFromFields(fields: Record<string, string> | undefined): string {
  const vals: string[] = [];
  for (const k of Object.keys(fields ?? {})) {
    if (k === "channel" || k === "tactic") continue;
    const v = (fields ?? {})[k];
    if (v && v !== "-") vals.push(v);
  }
  return vals.length ? `x_x_x_x_${vals.join("_")}` : "";
}

/**
 * One value, as a chip. The value's own name is the button; its aliases live in a popover behind
 * it, because a value usually has none and a row of alias inputs would make the common case look
 * like work. The chip is also a drop target: dropping a pool word ONTO it adds an ALIAS, where
 * dropping onto the card around it adds a new VALUE.
 *
 * @param value      the value and its aliases
 * @param readOnly   true while the dimension is still auto-derived - unlock it to edit
 * @param onChange   replaces this value's aliases
 * @param onRemove   drops the value, returning its word to the pool
 */
function ValueChip({
  value, lockedValue, onChange, onRemove,
}: {
  value: ValueDraft;
  /** True for an auto dimension: the VALUE is the delivery data's, so it cannot be removed - but
   *  its aliases are still editable, because they are the CM360 side's only way in. */
  lockedValue: boolean;
  onChange: (next: ValueDraft) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [dropping, setDropping] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  const aliases = value.aliases ?? [];

  // Close on Escape or a click outside. Escape is stopped here on purpose: letting it through would
  // also close the settings drawer and lose the user's place in this tab.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const addAlias = (raw: string) => {
    const a = raw.trim();
    if (!a || aliases.some((x) => fold(x) === fold(a))) return;
    onChange({ ...value, aliases: [...aliases, a] });
  };

  return (
    <span
      ref={ref}
      className={`pmap__val${dropping ? " pmap__val--drop" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TOKEN_MIME)) return;
        e.preventDefault();
        e.stopPropagation();   // beat the card behind us, which would add a VALUE
        setDropping(true);
      }}
      onDragLeave={(e) => { e.stopPropagation(); setDropping(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(TOKEN_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        const tok = e.dataTransfer.getData(TOKEN_MIME) || e.dataTransfer.getData("text/plain");
        if (tok) addAlias(tok);
      }}
    >
      <button
        type="button"
        className="pmap__val-label"
        title={aliases.length ? `Also matches: ${aliases.join(", ")}` : "Edit aliases"}
        onClick={() => setOpen((o) => !o)}
      >
        {value.value}
        {aliases.length > 0 && <span className="pmap__val-badge">+{aliases.length}</span>}
      </button>
      {!lockedValue && (
        <button
          type="button"
          className="pmap__val-x"
          title="Remove - the word returns to the pool"
          onClick={onRemove}
        >
          &times;
        </button>
      )}
      {open && (
        <div className="pmap__pop" role="dialog" aria-label={`Aliases for ${value.value}`}>
          <div className="pmap__pop-hd">
            <span title={value.value}>{value.value}</span>
            <button type="button" className="pmap__val-x" title="Close" onClick={() => setOpen(false)}>
              &times;
            </button>
          </div>
          {aliases.length === 0 ? (
            <p className="pmap__hint">No aliases yet - add the spellings CM360 uses.</p>
          ) : (
            <div className="pmap__pop-aliases">
              {aliases.map((a) => (
                <span key={a} className="pmap__val">
                  {a}
                  {(
                    <button
                      type="button"
                      className="pmap__val-x"
                      title="Remove alias"
                      onClick={() => onChange({
                        ...value, aliases: aliases.filter((x) => x !== a),
                      })}
                    >
                      &times;
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {(
            <input
              className="pmap__pop-in"
              placeholder="+ alias"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                addAlias(draft);
                setDraft("");
              }}
              onBlur={() => { addAlias(draft); setDraft(""); }}
            />
          )}
        </div>
      )}
    </span>
  );
}

/**
 * One mapping in the list. Clicking it opens its editor; the rename and delete controls inside stop
 * the click so they do not also open it.
 *
 * The counters read LIBRARY dimensions only. The three auto ones are scaffolding every mapping has,
 * so counting them would print "3 dimensions" on a mapping nobody has touched.
 *
 * Delete asks twice. One click removing a whole dimension library, with its aliases and its manual
 * picks, is the kind of thing a mis-aimed cursor should not be able to do; the confirm reverts on
 * blur, so clicking away cancels.
 *
 * @param entity    the mapping
 * @param onOpen    open its editor
 * @param onRename  rename it
 * @param onDelete  drop it from the draft
 */
function EntityCard({
  entity, onOpen, onRename, onDelete,
}: {
  entity: MappingDraft;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const libDims = entity.dimensions.filter((d) => !d.autoKind);
  const valueCount = libDims.reduce((n, d) => n + d.values.length, 0);
  const level = LEVELS.find((l) => l.value === entity.level);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div
      className="pmap__ent"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen();
      }}
    >
      <div className="pmap__ent-top">
        {renaming ? (
          <input
            className="pmap__ent-name"
            value={entity.name}
            maxLength={60}
            placeholder="Untitled mapping"
            aria-label="Mapping name"
            autoFocus
            onClick={stop}
            onBlur={() => setRenaming(false)}
            onKeyDown={(e) => {
              stop(e);
              if (e.key !== "Enter" && e.key !== "Escape") return;
              e.preventDefault();
              setRenaming(false);
            }}
            onChange={(e) => onRename(e.target.value)}
          />
        ) : (
          <span className="pmap__ent-name">{entity.name.trim() || "Untitled mapping"}</span>
        )}
        {/* The KIND, not the level: the level is spelled out in words on the line below, and a
            card that repeated it twice would read as two different facts. */}
        <span className="pmap__kind">Dimensions</span>
        <button
          type="button"
          className="pmap__icon"
          aria-label="Rename mapping"
          onClick={(e) => { stop(e); setRenaming(true); }}
        >
          &#9998;
        </button>
        {confirming ? (
          <button
            type="button"
            className="pmap__remove pmap__remove--confirm"
            autoFocus
            onClick={(e) => { stop(e); onDelete(); }}
            onBlur={() => setConfirming(false)}
          >
            Delete?
          </button>
        ) : (
          <button
            type="button"
            className="pmap__icon"
            aria-label="Delete mapping"
            onClick={(e) => { stop(e); setConfirming(true); }}
          >
            &times;
          </button>
        )}
        <span className="pmap__chev" aria-hidden="true">&rsaquo;</span>
      </div>
      <div className="pmap__ent-counts">
        <span>{level?.label ?? entity.level}</span>
        <span>
          {libDims.length} {libDims.length === 1 ? "dimension" : "dimensions"}
          {" · "}
          {valueCount} {valueCount === 1 ? "value" : "values"}
        </span>
      </div>
    </div>
  );
}

export const PacingMappingSection = forwardRef<SettingsSectionHandle, PacingMappingSectionProps>(
  function PacingMappingSection(
    // The data props are all optional: a caller that has not resolved its dashboard payload yet is
    // a normal state, not a programming error, and must not take the tab down with it.
    { slug, mappings, cm360, factsDaily, types, liPlan, creatives, seedKey, onDirtyChange },
    ref,
  ) {
    const [base, setBase] = useState<MappingDraft[]>(() => seed(mappings));
    const [draft, setDraft] = useState<MappingDraft[]>(base);
    // Never auto-open, even with a single mapping: the list is the point at which someone decides
    // WHICH mapping they are editing, and skipping it hides that there can be more than one.
    const [openId, setOpenId] = useState<string | null>(null);
    /** Which dimension a chip is currently hovering over, for the drop highlight. */
    const [dropDimId, setDropDimId] = useState<string | null>(null);
    /** Which card slot a dragged dimension or suggestion would land in. */
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    /** Which side's rows the tables show, and the two filters over them. */
    const [rowTab, setRowTab] = useState<"delivery" | "cm360">("delivery");
    const [rowQuery, setRowQuery] = useState("");
    const [unresolvedOnly, setUnresolvedOnly] = useState(false);
    /** 'all' | '30' | '7' - a cutoff measured from the freshest row in the DATA, not the clock. */
    const [activity, setActivity] = useState("all");
    /** Proposed dimensions, held as drafts: accepting one is what makes it an edit. */
    const [suggestions, setSuggestions] = useState<PacingMappingSuggestion[]>([]);
    const [suggestNotice, setSuggestNotice] = useState<string | null>(null);

    // Re-seed when the server payload is replaced. Keyed on seedKey rather than on `mappings`
    // itself: the array identity changes on every refetch, which would throw away a draft mid-edit.
    useEffect(() => {
      const next = seed(mappings);
      setBase(next);
      setDraft(next);
      setOpenId((prev) => (next.some((m) => m.id === prev) ? prev : null));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey]);

    const dirty = useMemo(
      () => normMappingsV3(toWire(draft)) !== normMappingsV3(toWire(base)),
      [draft, base],
    );
    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    const draftRef = useRef(draft);
    draftRef.current = draft;

    const save = useMutation({
      mutationFn: (next: MappingDraft[]) => {
        if (!slug) throw new Error("This pacing has no dashboard yet.");
        // An editor emptied to nothing means "clear", which the endpoint spells as null. An empty
        // array would say "migrated, nothing mapped" - a different answer the compare screens read
        // differently.
        const wire = toWire(next);
        return savePacingMappings(slug, wire.length ? wire : null);
      },
    });

    useImperativeHandle(ref, () => ({
      async save() {
        if (!dirty) return { ok: true as const };
        try {
          await save.mutateAsync(draftRef.current);
          setBase(draftRef.current);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, message: formatError(error) };
        }
      },
      reset() {
        setDraft(base);
        // A mapping created in this session is gone after a reset; leaving it "open" would strand
        // the editor on an entity that no longer exists, with no way back to the list.
        setOpenId((prev) => (base.some((m) => m.id === prev) ? prev : null));
        setSuggestions([]);
        setSuggestNotice(null);
      },
    }));

    // ── the reference lists ───────────────────────────────────────────────────────────────────
    // What is actually on each side. Without these an alias is a guess, and a guess that misses
    // costs a save, a refetch and a reload before it shows.
    const cm360Texts = useMemo(() => {
      const rows = cm360?.rows;
      if (!Array.isArray(rows)) return [];
      const seen = new Set<string>();
      for (const row of rows) {
        const text = `${row?.placement ?? ""} ${row?.creative ?? ""}`.trim();
        if (text) seen.add(text);
        // Bounded: this is a reading aid, and a real file carries tens of thousands of rows.
        if (seen.size >= 200) break;
      }
      return [...seen];
    }, [cm360]);

    const open = draft.find((m) => m.id === openId) ?? null;

    // ── the engine's own view of this draft ───────────────────────────────────────────────────
    // Everything below asks the comparison engine what it would do, rather than reasoning about
    // matching here. The rules differ per side (delivery = structured-field equality, CM360 =
    // whole-token match) and per dimension kind, and keeping a second copy of all that in this file
    // is how an editor starts promising bridges the widget does not make.

    const cm360Raw = useMemo(
      () => (Array.isArray(cm360?.rows) ? (cm360.rows as Record<string, unknown>[]) : []),
      [cm360],
    );
    const cm360HasData = cm360Raw.length > 0;

    // One row per line item x split-field tuple, exactly as the widget builds them.
    const deliveryRows = useMemo(
      () => buildDeliveryRows(factsDaily ?? [], types ?? [], liPlan ?? {}),
      [factsDaily, types, liPlan],
    );
    const cm360Rows = useMemo(() => buildCm360Groups(cm360Raw), [cm360Raw]);

    // Creative-level rows, built only for the level that needs them. `creatives == null` means the
    // pacing does not collect them at all, which is what disables that level rather than drawing it
    // empty.
    const deliveryCreatives = useMemo(() => buildDeliveryCreativesMap(creatives), [creatives]);
    const deliveryCreativesByRow = useMemo(
      () => creativesBySubRow(deliveryCreatives, deliveryRows),
      [deliveryCreatives, deliveryRows],
    );

    const level = open?.level ?? "placement";
    const creativeDeliveryRows = useMemo(
      () => (level === "creative" ? buildDeliveryCreativeRows(creatives, factsDaily ?? [], types ?? []) : []),
      [level, creatives, factsDaily, types],
    );
    const creativeCm360Rows = useMemo(
      () => (level !== "placement" ? buildCm360CreativeGroups(cm360Raw) : []),
      [level, cm360Raw],
    );
    const activeDeliveryRows = level === "creative" ? creativeDeliveryRows : deliveryRows;
    const activeCm360Rows = level === "placement" ? cm360Rows : creativeCm360Rows;
    const coverage = useMemo(
      () => (level === "creative" ? creativeCoverage(creatives, factsDaily ?? []) : null),
      [level, creatives, factsDaily],
    );

    // The mapping as the engine should see it: the three auto dimensions stand in for an entity
    // that has none yet, and every auto dimension's values are derived live from the delivery data
    // and merged with whatever aliases are stored. RENDER ONLY - never routed into the draft, so
    // opening the tab cannot dirty it.
    const effectiveMapping = useMemo(() => {
      if (!open) return null;
      const body = toWireEntity(withAutoDims(open));
      return buildEffectiveMapping(body, deliveryRows) as { dimensions: WireDim[] };
    }, [open, deliveryRows]);

    // One classification pass, shared by every number on the screen.
    const classified = useMemo(
      () => (effectiveMapping
        ? classifyAll({
          deliveryRows: activeDeliveryRows,
          cm360Rows: activeCm360Rows,
          mapping: effectiveMapping,
          // At creative level the creative names ARE the rows, so folding them into the delivery
          // token surface would match a row against itself.
          deliveryCreatives: level === "creative" ? null : deliveryCreativesByRow,
        })
        : null),
      [effectiveMapping, activeDeliveryRows, activeCm360Rows, deliveryCreativesByRow, level],
    );
    const perDimById = useMemo(() => {
      const map: Record<string, PerDim> = {};
      for (const pd of classified?.perDim ?? []) map[pd.dimId] = pd;
      return map;
    }, [classified]);

    // The effective dimension list, by id - so a rendered auto dimension can show the values the
    // engine derived for it even though the draft stores none.
    const effectiveDimById = useMemo(() => {
      const map: Record<string, WireDim> = {};
      for (const d of effectiveMapping?.dimensions ?? []) map[d.id] = d;
      return map;
    }, [effectiveMapping]);

    /** The distinct field values behind those rows - the reading aid beside the CM360 placements. */
    const deliveryValueList = useMemo(() => {
      const out = new Set<string>();
      for (const r of deliveryRows as DeliveryRow[]) {
        for (const k of Object.keys(r.fields ?? {})) {
          const v = String((r.fields ?? {})[k] ?? "").trim();
          if (v && v !== "-") out.add(v);
        }
      }
      return [...out].sort();
    }, [deliveryRows]);

    // ── the row tables ────────────────────────────────────────────────────────────────────────
    // Every row the comparison will see, with the engine's verdict per dimension. This is where a
    // mapping stops being a guess: a cell the engine could not decide is a row that will land in
    // "Unmapped", and the only way to see which rows those are - before a save, a refetch and a
    // reload - is to list them.
    const cells = useMemo(
      () => ({
        delivery: classified?.deliveryCells ?? {},
        cm360: classified?.cm360Cells ?? {},
      }) as Record<string, Record<string, Record<string, string | null>>>,
      [classified],
    );

    /** The dimensions the tables column by - the effective list, so an auto dimension's derived
     *  values show up in its cell dropdown. */
    const tableDims = useMemo(
      () => (effectiveMapping?.dimensions ?? []),
      [effectiveMapping],
    );

    const cellValue = (side: string, key: string, dimId: string): string | null => {
      const row = cells[side]?.[key];
      return row && row[dimId] != null ? row[dimId] : null;
    };
    const isOverridden = (side: string, key: string, dimId: string): boolean =>
      open?.cellOverrides?.[side]?.[key]?.[dimId] != null;
    /** A row with at least one cell the engine could not decide - the actionable kind. */
    const rowHasUnresolved = (side: string, key: string): boolean =>
      tableDims.some((d) => !d.auto_kind && cellValue(side, key, d.id) == null);

    const activeRows = (rowTab === "delivery" ? activeDeliveryRows : activeCm360Rows) as TableRow[];
    const activeUnresolved = useMemo(
      () => activeRows.reduce(
        (n, r) => n + tableDims.filter((d) => !d.auto_kind && cellValue(rowTab, r.key, d.id) == null).length,
        0,
      ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [activeRows, tableDims, rowTab, cells],
    );

    /** The freshest date anything was seen, across BOTH sides. The activity cutoff counts back from
     *  here rather than from today: the data can lag by days, and a wall-clock window would quietly
     *  hide every row on a pacing whose last refresh was last week. */
    const latestSeen = useMemo(() => {
      let latest: string | null = null;
      for (const r of [...(activeDeliveryRows as TableRow[]), ...(activeCm360Rows as TableRow[])]) {
        const d = r.last_seen;
        if (d && (latest == null || d > latest)) latest = d;
      }
      return latest;
    }, [activeDeliveryRows, activeCm360Rows]);

    const cutoff = useMemo(() => {
      if (activity === "all" || !latestSeen) return null;
      const d = new Date(`${latestSeen}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (activity === "30" ? 30 : 7));
      return d.toISOString().slice(0, 10);
    }, [activity, latestSeen]);

    const shownRows = useMemo(() => {
      const q = rowQuery.trim().toLowerCase();
      return activeRows.filter((r) => {
        if (cutoff && !(r.last_seen && r.last_seen >= cutoff)) return false;
        if (unresolvedOnly && !rowHasUnresolved(rowTab, r.key)) return false;
        if (!q) return true;
        // Search the text a reader can actually SEE, not the internal key: a delivery key carries
        // a separator and the line item id, which would match things nobody typed.
        return rowLabel(r, rowTab).toLowerCase().includes(q);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeRows, rowQuery, unresolvedOnly, cutoff, rowTab, cells, tableDims]);

    /**
     * One cell. Three of the four states are a dropdown; the exceptions are the two surfaces where
     * a human has nothing to add:
     *   - Month is resolved per day at comparison time, so no single row has one value;
     *   - the DELIVERY side of Channel/Tactic reads a structured field, which is authoritative.
     * The CM360 side of those same dimensions IS pickable - there is no field to defer to there.
     */
    function renderCell(side: "delivery" | "cm360", key: string, dim: WireDim) {
      const v = cellValue(side, key, dim.id);

      if (dim.auto_kind === "month") {
        return <span className="pmap__cell pmap__cell--muted" title="Resolved per day at comparison time">auto</span>;
      }
      if (dim.auto_kind && side === "delivery") {
        return v == null
          ? <span className="pmap__cell pmap__cell--dash">—</span>
          : <span className="pmap__cell pmap__cell--auto">{v}</span>;
      }

      const overridden = isOverridden(side, key, dim.id);
      const cls = v == null ? "pmap__cell--pick" : overridden ? "pmap__cell--picked" : "pmap__cell--auto";
      const label = v == null
        ? `Pick ${dim.name}`
        : overridden ? `Change ${dim.name} (manually picked)` : `Change ${dim.name} (auto-matched)`;
      return (
        <select
          className={`pmap__cell ${cls}`}
          value={v == null ? "" : v}
          aria-label={label}
          onChange={(e) => pick(side, key, dim.id, e.target.value || null)}
        >
          <option value="">—</option>
          {(dim.values ?? []).map((val) => (
            <option key={val.value} value={val.value}>{val.value}</option>
          ))}
        </select>
      );
    }

    /** The dimension list as rendered - the draft's own, or the seeded auto ones on a fresh one. */
    function dimsOf(m: MappingDraft): DimensionDraft[] {
      return m.dimensions.length ? m.dimensions : withAutoDims(m).dimensions;
    }

    /** Move a dimension card to a new slot. Order is what the comparison breaks down by first. */
    function reorderDim(from: number, to: number) {
      if (!open || from === to) return;
      const list = [...dimsOf(open)];
      const [moved] = list.splice(from, 1);
      list.splice(from < to ? to - 1 : to, 0, moved);
      editMapping(open.id, { dimensions: list });
    }

    /** A word dropped on empty space becomes a dimension of its own, seeded with that word. */
    function addDimFromToken(token: string) {
      if (!open) return;
      editMapping(open.id, {
        dimensions: [...dimsOf(open), {
          id: newId("dim"),
          name: "New dimension",
          source: "names",
          autoKind: null,
          values: [{ value: token, aliases: [] }],
        }],
      });
    }

    /**
     * Replace one value's aliases, by NAME rather than by position.
     *
     * The name matters because an AUTO dimension stores no values at all - its labels are derived
     * from the delivery data every render. Giving one of them an alias materializes just THAT value
     * into the draft and leaves `auto_kind` alone, so the dimension keeps reading the structured
     * field on the delivery side while the CM360 side gains something to match on. Those are two
     * separate decisions in the reference, and collapsing them into "convert the whole dimension"
     * would make an alias cost the delivery side's field authority.
     */
    function setAliases(dimId: string, valueName: string, aliases: string[]) {
      if (!open) return;
      const base = open.dimensions.length ? open.dimensions : withAutoDims(open).dimensions;
      editMapping(open.id, {
        dimensions: base.map((d) => {
          if (d.id !== dimId) return d;
          const found = d.values.some((v) => fold(v.value) === fold(valueName));
          const values = found
            ? d.values.map((v) => (fold(v.value) === fold(valueName) ? { ...v, aliases } : v))
            : [...d.values, { value: valueName.replace(/\s+/g, " ").trim(), aliases }];
          return { ...d, values };
        }),
      });
    }

    /**
     * Unlock an auto dimension into an ordinary library, seeded with the values the engine is
     * currently deriving for it. Until this happens Channel/Tactic store nothing and read the
     * delivery row's structured field; afterwards they are a normal hand-edited list, which is the
     * only way to add an alias so the CM360 side can match them too.
     */
    function convertDim(dimId: string) {
      if (!open) return;
      const seeded = withAutoDims(open).dimensions.find((d) => d.id === dimId);
      const eff = effectiveDimById[dimId];
      if (!seeded) return;
      const converted: DimensionDraft = {
        id: seeded.id,
        name: seeded.name,
        source: "manual",
        autoKind: null,
        values: (eff?.values ?? []).map((v) => ({ value: v.value, aliases: v.aliases ?? [] })),
      };
      const base = open.dimensions.length ? open.dimensions : withAutoDims(open).dimensions;
      editMapping(open.id, {
        dimensions: base.map((d) => (d.id === dimId ? converted : d)),
      });
    }

    const suggest = useMutation({
      mutationFn: () => {
        if (!slug) throw new Error("This pacing has no dashboard yet.");
        return suggestPacingMappingLibrary(slug, open?.id ?? null);
      },
      onSuccess: (result) => {
        // Names that already exist are dropped: accepting one would make a second dimension the
        // engine then has to choose between, and the user cannot see why.
        const taken = new Set((open?.dimensions ?? []).map((d) => fold(d.name)));
        setSuggestions(result.dimensions.filter((d) => !taken.has(fold(d.name))));
        setSuggestNotice(result.notice);
      },
    });

    /** Take a proposal into the draft, at the slot it was dropped on. THIS is the edit - fetching
     *  one never dirties anything. */
    function acceptSuggestion(index: number, at?: number) {
      if (!open) return;
      const sug = suggestions[index];
      if (!sug) return;
      const list = [...dimsOf(open)];
      const dim: DimensionDraft = {
        id: newId("dim"),
        name: sug.name,
        source: "names",
        autoKind: null,
        values: (sug.values ?? []).map((v) => ({ value: v.value, aliases: v.aliases ?? [] })),
      };
      list.splice(at == null ? list.length : at, 0, dim);
      editMapping(open.id, { dimensions: list });
      setSuggestions((prev) => prev.filter((_, i) => i !== index));
    }

    function pick(side: string, key: string, dimId: string, value: string | null) {
      if (!open) return;
      const dim = withAutoDims(open).dimensions.find((d) => d.id === dimId);
      if (!dim) return;
      const next = setCellOverride(open.cellOverrides, dim, side, key, dimId, value);
      if (next === open.cellOverrides) return;   // refused: delivery side of an auto dimension
      editMapping(open.id, { cellOverrides: next });
    }

    // ── the token pool ────────────────────────────────────────────────────────────────────────
    // Words actually present in the data, so nobody has to invent a value and find out after a save
    // whether it matched. A `both` chip is the useful one: it occurs on each side, so a value named
    // after it bridges. Delivery names are synthesised from the structured fields (see
    // syntheticNameFromFields) because the payload carries no composed name.
    const minedTokens = useMemo(() => {
      const liNames = deliveryRows.map((r: DeliveryRow) => syntheticNameFromFields(r.fields));
      const deliveryCreativeNames: string[] = [];
      for (const lid of Object.keys(deliveryCreatives ?? {})) {
        deliveryCreativeNames.push(...((deliveryCreatives as Record<string, string[]>)[lid] ?? []));
      }
      const cm = cm360Raw.map((r) => ({ placement: r?.placement, creative: r?.creative }));
      return mineTokens({ liNames, cm360Rows: cm, deliveryCreativeNames });
    }, [deliveryRows, deliveryCreatives, cm360Raw]);

    // Derived: mined minus whatever is already spoken for as a value or an alias. Removing a value
    // elsewhere makes its chip reappear here for free, so this holds no state of its own.
    const visibleTokens = useMemo(() => {
      const used = new Set<string>();
      for (const d of effectiveMapping?.dimensions ?? []) {
        for (const v of d.values ?? []) {
          used.add(fold(v.value));
          for (const a of v.aliases ?? []) used.add(fold(a));
        }
      }
      return minedTokens.filter((t) => !used.has(fold(t.token)));
    }, [minedTokens, effectiveMapping]);

    // ── mutations on the draft ────────────────────────────────────────────────────────────────
    function editMapping(id: string, patch: Partial<MappingDraft>) {
      setDraft((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    }
    function editDim(mappingId: string, dimId: string, patch: Partial<DimensionDraft>) {
      setDraft((prev) => prev.map((m) => (m.id !== mappingId ? m : {
        ...m,
        dimensions: m.dimensions.map((d) => (d.id === dimId ? { ...d, ...patch } : d)),
      })));
    }

    return (
      <>
        {/* Words actually present in the data. Drag one into a dimension to make it a value - a
            `both` chip is the one worth taking, since it occurs on each side and therefore
            bridges. The pool is derived, so a value removed below reappears here by itself.
            It belongs to the editor: it is a tool for building ONE mapping. */}
        {open && (
        <section className="pmap__section">
          <div className="pmap__row">
            <h3 className="pmap__label">
              Detected in names <span className="pmap__label-sub">— drag into a dimension</span>
            </h3>
            <span className="pmap__legend">
              <span className="pmap__lg pmap__lg--delivery">Delivery</span>
              <span className="pmap__lg pmap__lg--cm360">CM360</span>
              <span className="pmap__lg pmap__lg--both">Both</span>
            </span>
          </div>
          <div className="pmap__chips">
            {visibleTokens.length === 0 ? (
              <span className="pmap__hint">
                {deliveryRows.length === 0 && !cm360HasData
                  ? "Nothing to read yet."
                  : "All detected values are assigned."}
              </span>
            ) : (
              visibleTokens.map((t) => (
                <span
                  key={`${t.side}:${t.token}`}
                  className={`pmap__tok pmap__tok--${t.side}`}
                  draggable
                  title={`${t.token} · ${t.count} ${t.count === 1 ? "occurrence" : "occurrences"} (${t.side})`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TOKEN_MIME, t.token);
                    e.dataTransfer.setData("text/plain", t.token);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  {t.token}
                  <span className="pmap__tok-cnt">×{t.count}</span>
                </span>
              ))
            )}
            {!cm360HasData && (
              <span className="pmap__poolhint" title="Pull a CM360 source in Settings → Data to detect placement words too">
                CM360 not pulled yet
              </span>
            )}
          </div>
        </section>
        )}

        {/* List OR editor, never both. The list is where someone chooses WHICH mapping they are
            working on; leaving it on screen under an open editor made two different things look
            like one page. */}
        {!open && (
        <section className="pmap__section">
          <div className="pmap__row">
            <h3 className="pmap__label">
              Mappings <span className="pmap__label-sub">— route external data and maintain shared names</span>
            </h3>
            <button
              type="button"
              className="pmap__add"
              onClick={() => {
                const created: MappingDraft = {
                  id: newId("mp"), name: "New mapping", level: "placement", dimensions: [],
                  cellOverrides: {}, rest: {},
                };
                setDraft((prev) => [...prev, created]);
                setOpenId(created.id);
              }}
            >
              + Add mapping
            </button>
          </div>

          {draft.length === 0 ? (
            <p className="pmap__hint pmap__hint--block">
              No mapping yet. A mapping says which values on the delivery side mean the same thing as
              which words in the ad server&rsquo;s placements, which is what lets the two be compared
              at all.
              {!cm360HasData && (
                <>
                  {" "}
                  CM360 has not been pulled for this pacing yet &mdash; add a source in Settings
                  &rarr; Data. Building a mapping by hand still works; it just has nothing to check
                  itself against until the pull lands.
                </>
              )}
            </p>
          ) : (
            <div className="pmap__ents">
              {draft.map((m) => (
                <EntityCard
                  key={m.id}
                  entity={m}
                  onOpen={() => setOpenId(m.id)}
                  onRename={(name) => editMapping(m.id, { name })}
                  onDelete={() => {
                    setDraft((prev) => prev.filter((x) => x.id !== m.id));
                    setOpenId((prev) => (prev === m.id ? null : prev));
                  }}
                />
              ))}
            </div>
          )}
        </section>
        )}

        {open && (
          <section className="pmap__section">
            <div className="pmap__row">
              <button type="button" className="pmap__back" onClick={() => setOpenId(null)}>
                &larr; All mappings
              </button>
              {/* The name sits in the header beside the way back, not in a labelled field below:
                  it is this screen's title, and a form row for it pushed the actual work down. */}
              <input
                className="pmap__title"
                type="text"
                value={open.name}
                aria-label="Mapping name"
                placeholder="Untitled mapping"
                onChange={(e) => editMapping(open.id, { name: e.target.value })}
              />
            </div>

            {/* Three fixed choices, so a segmented control rather than a dropdown: all of them are
                worth seeing at once, and which one is unavailable is itself information. */}
            <div className="pmap__seg-row">
              <span className="pmap__label">Compare by</span>
              <div className="pmap__seg" role="tablist" aria-label="Compare by">
                {LEVELS.map((l) => {
                  const off = l.value === "creative" && creatives == null && open.level !== "creative";
                  return (
                    <button
                      key={l.value}
                      type="button"
                      role="tab"
                      aria-selected={open.level === l.value}
                      className={`pmap__seg-btn${open.level === l.value ? " pmap__seg-btn--on" : ""}`}
                      disabled={off}
                      title={off ? "Needs \u201cFetch creatives\u201d in Settings \u2192 Data" : l.hint}
                      onClick={() => editMapping(open.id, { level: l.value })}
                    >
                      {l.label}
                    </button>
                  );
                })}
              </div>
              {/* Creative rows only exist for creatives that are named. If they cover less than
                  the whole delivery, say so here rather than letting the comparison look short. */}
              {open.level === "creative" && coverage != null && coverage < 0.995 && (
                <span className="pmap__badge">
                  Creative rows cover {Math.round(coverage * 100)}% of delivery impressions
                </span>
              )}
            </div>

            {/* Proposals, not edits: fetching leaves the draft alone, and only Add puts one in.
                When no model is connected Pacing says so in words and proposes nothing, which is a
                normal answer rather than a failure. */}
            {suggest.isError && (
              <p className="pmap__hint pmap__hint--block">{formatError(suggest.error)}</p>
            )}
            {suggestNotice && !suggestions.length && (
              <p className="pmap__hint pmap__hint--block">{suggestNotice}</p>
            )}
            {suggestions.length > 0 && (
              <div className="pmap__sugg">
                <div className="pmap__row">
                  <span className="pmap__hint">Drag one into Dimensions, or press Add.</span>
                  <button
                    type="button"
                    className="pmap__remove"
                    onClick={() => setSuggestions([])}
                  >
                    Dismiss all
                  </button>
                </div>
                <div className="pmap__sugg-cards">
                  {suggestions.map((sug, i) => (
                    <div
                      key={`${sug.name}:${i}`}
                      className="pmap__sugg-card"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(SUGG_MIME, String(i));
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                    >
                      <div className="pmap__ent-top">
                        <span className="pmap__ent-name">{sug.name}</span>
                        <button
                          type="button"
                          className="pmap__val-x"
                          title="Dismiss suggestion"
                          onClick={() => setSuggestions((prev) => prev.filter((_, j) => j !== i))}
                        >
                          &times;
                        </button>
                      </div>
                      {/* The values are the whole reason to accept or dismiss one, so they are on
                          the card rather than hidden in a tooltip. */}
                      <div className="pmap__vals">
                        {(sug.values ?? []).map((v) => (
                          <span
                            key={v.value}
                            className="pmap__val"
                            title={(v.aliases ?? []).length ? `Also matches: ${(v.aliases ?? []).join(", ")}` : v.value}
                          >
                            <span className="pmap__val-label">{v.value}</span>
                            {(v.aliases ?? []).length > 0 && (
                              <span className="pmap__val-badge">+{(v.aliases ?? []).length}</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <button type="button" className="pmap__add" onClick={() => acceptSuggestion(i)}>
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pmap__row">
              <h3 className="pmap__label">
                Dimensions <span className="pmap__label-sub">— each becomes a comparison breakdown</span>
              </h3>
              <button
                type="button"
                className="pmap__add"
                disabled={suggest.isPending || !slug}
                onClick={() => suggest.mutate()}
              >
                {suggest.isPending ? "Asking…" : "✨ Suggest"}
              </button>
            </div>

            {open.dimensions.length === 0 && (
              <p className="pmap__hint pmap__hint--block">
                A dimension is one question asked of both sides &mdash; &ldquo;which format?&rdquo;,
                &ldquo;which audience?&rdquo; &mdash; and its values are the answers it accepts.
              </p>
            )}

            {/* The grid itself is a drop target: a word dropped on EMPTY space becomes a dimension
                of its own, which is how a mapping gets built from nothing. Dropping on a card adds
                a value to it instead, and dropping on a value chip adds an alias - three targets,
                told apart by the drag type and by stopPropagation on the inner two. */}
            <div
              className={`pmap__grid${dropIndex === -1 ? " pmap__grid--drop" : ""}`}
              onDragOver={(e) => {
                const t = e.dataTransfer.types;
                if (!t.includes(TOKEN_MIME) && !t.includes(DIM_MIME) && !t.includes(SUGG_MIME)) return;
                e.preventDefault();
                setDropIndex(-1);
              }}
              onDragLeave={() => setDropIndex(null)}
              onDrop={(e) => {
                setDropIndex(null);
                setDropDimId(null);
                const t = e.dataTransfer.types;
                if (t.includes(SUGG_MIME)) {
                  e.preventDefault();
                  acceptSuggestion(Number(e.dataTransfer.getData(SUGG_MIME)));
                  return;
                }
                if (t.includes(DIM_MIME)) return;   // a reorder that missed a slot: leave it alone
                if (!t.includes(TOKEN_MIME)) return;
                e.preventDefault();
                const tok = e.dataTransfer.getData(TOKEN_MIME) || e.dataTransfer.getData("text/plain");
                if (tok) addDimFromToken(tok);
              }}
            >
            {withAutoDims(open).dimensions.map((d, dimIndex) => {
              const pd = perDimById[d.id];
              const eff = effectiveDimById[d.id];
              // An auto dimension stores no values - the engine derives them from the delivery data
              // every render. Show those, so the row is not an empty box that looks broken.
              // An auto dimension stores nothing until a value is given an alias; the engine
              // derives its labels every render. So the list shown is the derived one, with any
              // value the draft HAS materialized taking its place - a value that already carries
              // an alias must show it, and must not appear twice.
              const shownValues: ValueDraft[] = d.autoKind
                ? (eff?.values ?? []).map((v) => {
                  const stored = d.values.find((x) => fold(x.value) === fold(v.value));
                  return stored ?? { value: v.value, aliases: v.aliases ?? [] };
                })
                : d.values;
              return (
              <div
                key={d.id}
                className={`pmap__dim${dropDimId === d.id ? " pmap__dim--dropover" : ""}${dropIndex === dimIndex ? " pmap__dim--slot" : ""}`}
                draggable
                onDragStart={(e) => {
                  // Never start a card drag from something interactive inside it.
                  if ((e.target as HTMLElement).closest("input, select, button, .pmap__val")) {
                    e.preventDefault();
                    return;
                  }
                  e.dataTransfer.setData(DIM_MIME, String(dimIndex));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  const t = e.dataTransfer.types;
                  if (t.includes(DIM_MIME) || t.includes(SUGG_MIME)) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropIndex(dimIndex);
                    return;
                  }
                  if (!t.includes(TOKEN_MIME)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setDropDimId(d.id);
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  setDropDimId((prev) => (prev === d.id ? null : prev));
                }}
                onDrop={(e) => {
                  const t = e.dataTransfer.types;
                  setDropDimId(null);
                  setDropIndex(null);
                  if (t.includes(SUGG_MIME)) {
                    e.preventDefault();
                    e.stopPropagation();
                    acceptSuggestion(Number(e.dataTransfer.getData(SUGG_MIME)), dimIndex);
                    return;
                  }
                  if (t.includes(DIM_MIME)) {
                    e.preventDefault();
                    e.stopPropagation();
                    reorderDim(Number(e.dataTransfer.getData(DIM_MIME)), dimIndex);
                    return;
                  }
                  if (!t.includes(TOKEN_MIME)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const tok = e.dataTransfer.getData(TOKEN_MIME) || e.dataTransfer.getData("text/plain");
                  if (!tok || d.autoKind) return;
                  if (d.values.some((v) => fold(v.value) === fold(tok))) return;
                  editDim(open.id, d.id, { values: [...d.values, { value: tok, aliases: [] }] });
                }}
              >
                {/* Name, what kind it is, and the one action it offers - on one line, so a card
                    is three short rows and a grid of them can be read at a glance. */}
                <div className="pmap__dim-hd">
                  <input
                    className="pmap__dim-name"
                    type="text"
                    value={d.name}
                    placeholder="Format"
                    aria-label="Dimension name"
                    readOnly={!!d.autoKind}
                    onChange={(e) => editDim(open.id, d.id, { name: e.target.value })}
                  />
                  {d.source !== "manual" && (
                    // A dimension Pacing derives. Its values are read-only until it is unlocked.
                    <span className="pmap__tag">{d.autoKind ?? d.source}</span>
                  )}
                  {d.autoKind && d.autoKind !== "month" && (
                    <button
                      type="button"
                      className="pmap__mini"
                      title="Make editable - unlock the values so they can carry aliases, which is the only way the CM360 side can match this dimension"
                      onClick={() => convertDim(d.id)}
                    >
                      Edit values
                    </button>
                  )}
                  {!d.autoKind && (
                    <button
                      type="button"
                      className="pmap__icon"
                      title="Remove dimension - its values return to the pool above"
                      onClick={() => editMapping(open.id, {
                        dimensions: (open.dimensions.length ? open.dimensions : withAutoDims(open).dimensions)
                          .filter((x) => x.id !== d.id),
                      })}
                    >
                      &times;
                    </button>
                  )}
                </div>


                <div className="pmap__vals">
                  {shownValues.length === 0 && (
                    <span className="pmap__hint">
                      No values yet - drag a word from the pool above, or add one.
                    </span>
                  )}
                  {shownValues.map((v, i) => (
                    <ValueChip
                      key={`${v.value}:${i}`}
                      value={v}
                      // Aliases are editable on an auto dimension too - that is the ONLY way its
                      // CM360 side can ever match, since that side has no structured field to read.
                      // What is locked is the value itself: it comes from the delivery data, and
                      // changing it is what "Edit values" is for.
                      lockedValue={!!d.autoKind}
                      onChange={(next) => setAliases(d.id, v.value, next.aliases)}
                      onRemove={() => editDim(open.id, d.id, {
                        values: d.values.filter((x) => fold(x.value) !== fold(v.value)),
                      })}
                    />
                  ))}
                  {!d.autoKind && (
                    <input
                      className="pmap__valin"
                      placeholder="+ value"
                      aria-label={`Add a value to ${d.name || "this dimension"}`}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const raw = e.currentTarget.value.trim();
                        if (!raw || d.values.some((x) => fold(x.value) === fold(raw))) return;
                        editDim(open.id, d.id, { values: [...d.values, { value: raw, aliases: [] }] });
                        e.currentTarget.value = "";
                      }}
                    />
                  )}
                </div>

                {/* How far this dimension actually reaches, straight from the engine. The delivery
                    count is never alarmed: a young dimension at 1/8 is normal. The CM360 count goes
                    amber when short, because an unclassified placement is a row the comparison will
                    drop into "Unmapped". Month is literal "auto" - both sides carry dates, there is
                    nothing to reach. */}
                <p className="pmap__fx">
                  {d.autoKind === "month" ? (
                    <span className="pmap__fx-auto">auto — both sides carry dates</span>
                  ) : (
                    <>
                      <span className="pmap__fx-ok">{pd ? `${pd.dCount}/${pd.dTotal}` : "0/0"}</span>
                      {" delivery rows"}
                      {cm360HasData && pd && (
                        <>
                          {" · "}
                          <span className={pd.cCount < pd.cTotal ? "pmap__fx-miss" : "pmap__fx-ok"}>
                            {pd.cCount}/{pd.cTotal}
                          </span>
                          {level === "placement" ? " placements" : " creatives"}
                        </>
                      )}
                    </>
                  )}
                </p>
              </div>
              );
            })}
              {/* The way in sits IN the grid, as a slot of its own: the two ways to make a
                  dimension - drop a word on it, or press the button - are the same act, and
                  putting the button in the header hid the drop target entirely. */}
              <div className="pmap__dim pmap__dim--new">
                <span className="pmap__hint">Drop a word here to make a dimension</span>
                <button
                  type="button"
                  className="pmap__add"
                  onClick={() => editMapping(open.id, {
                    dimensions: [...dimsOf(open), {
                      id: newId("dim"), name: "", source: "manual", autoKind: null,
                      values: [],
                    }],
                  })}
                >
                  + New dimension
                </button>
              </div>
            </div>
          </section>
        )}

        {open && (
          <section className="pmap__section">
            <div className="pmap__row">
              <h3 className="pmap__label">
                Rows <span className="pmap__label-sub">— what the comparison will see</span>
              </h3>
              <span className="pmap__count">
                {shownRows.length === activeRows.length
                  ? `${activeRows.length}`
                  : `${shownRows.length} of ${activeRows.length}`}
                {activeUnresolved > 0 && ` · ${activeUnresolved} unresolved`}
              </span>
            </div>
            <p className="pmap__hint pmap__hint--block">
              What the comparison will actually see. A cell the engine could not decide is amber -
              pick a value and that row stops landing in &ldquo;Unmapped&rdquo;.
            </p>

            {/* Every control here is bare - pills, a plain search box, a checkbox - so they share
                one baseline. A label-stacked field among them would sit a line higher. */}
            <div className="pmap__rowctl">
              <div className="pmap__tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={rowTab === "delivery"}
                  className={`pmap__tab${rowTab === "delivery" ? " pmap__tab--active" : ""}`}
                  onClick={() => setRowTab("delivery")}
                >
                  Delivery <span className="pmap__count">{activeDeliveryRows.length}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rowTab === "cm360"}
                  className={`pmap__tab${rowTab === "cm360" ? " pmap__tab--active" : ""}`}
                  onClick={() => setRowTab("cm360")}
                >
                  CM360 <span className="pmap__count">{activeCm360Rows.length}</span>
                </button>
              </div>
              <input
                className="pmap__search"
                type="search"
                value={rowQuery}
                aria-label="Filter rows"
                placeholder="Filter rows"
                onChange={(e) => setRowQuery(e.target.value)}
              />
              <select
                className="pmap__search"
                value={activity}
                aria-label="Activity"
                title="Counts back from the freshest date in the data, not from today - the data can lag."
                onChange={(e) => setActivity(e.target.value)}
              >
                <option value="all">Any activity</option>
                <option value="30">Seen in the last 30 days</option>
                <option value="7">Seen in the last 7 days</option>
              </select>
              <label className="pmap__check">
                <input
                  type="checkbox"
                  checked={unresolvedOnly}
                  onChange={(e) => setUnresolvedOnly(e.target.checked)}
                />
                Unresolved only
              </label>
            </div>

            {activeRows.length === 0 ? (
              <p className="pmap__hint">
                {rowTab === "delivery"
                  ? "No delivery rows yet."
                  : "CM360 not pulled yet — add a source in Settings → Data to compare placements."}
              </p>
            ) : (
              <div className="pmap__rowswrap">
                <table className="pmap__rows">
                  <thead>
                    <tr>
                      <th scope="col">{rowTab === "delivery" ? "Line item" : "Placement"}</th>
                      <th scope="col" className="pmap__num">Impressions</th>
                      {tableDims.map((d) => <th key={d.id} scope="col">{d.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.length === 0 ? (
                      <tr>
                        <td colSpan={2 + tableDims.length} className="pmap__hint">
                          {unresolvedOnly || rowQuery.trim()
                            ? "No rows match the filter."
                            : "Every row is classified."}
                        </td>
                      </tr>
                    ) : shownRows.map((r) => (
                      <tr key={r.key}>
                        <td className="pmap__rowname" title={r.display ?? r.key}>
                          {rowLabel(r, rowTab)}
                        </td>
                        <td className="pmap__num">{fmtNum(r.impressions)}</td>
                        {tableDims.map((d) => (
                          <td key={d.id}>{renderCell(rowTab, r.key, d)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {open && (
        <section className="pmap__section">
          <h3 className="pmap__label">What is on each side</h3>
          <p className="pmap__hint pmap__hint--block">
            The two sides match by different rules. On the delivery side a value must EQUAL a
            dimension value - write it exactly as listed. On the CM360 side it matches as a whole
            word: <code>ctv</code> matches <code>Hulu-CTV-15s</code>, and does not match
            {" "}<code>CTVision</code>.
          </p>
          <div className="pmap__sides">
            <div className="pmap__side">
              <h4 className="pmap__subheading">Delivery values ({deliveryValueList.length})</h4>
              <ul className="pmap__samples">
                {deliveryValueList.slice(0, 12).map((n) => <li key={n}>{n}</li>)}
                {deliveryValueList.length === 0 && (
                  <li className="pmap__hint">No delivery data yet.</li>
                )}
              </ul>
            </div>
            <div className="pmap__side">
              <h4 className="pmap__subheading">CM360 placements ({cm360Texts.length})</h4>
              <ul className="pmap__samples">
                {cm360Texts.slice(0, 12).map((t) => <li key={t}>{t}</li>)}
                {cm360Texts.length === 0 && (
                  <li className="pmap__hint">
                    No CM360 rows yet. Choose a source in Settings &rarr; Data and let the pull land.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </section>
        )}
      </>
    );
  },
);
