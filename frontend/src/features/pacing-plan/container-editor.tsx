/**
 * Container editor for the Pacing Settings plan editor (§9 of the migration plan, US-125) - a named
 * date sub-period of one line item's plan, with its own target and date-children (the monthly-renewal
 * shape: docs/superpowers/archive/specs/2026-05-14-split-containers.md §1 in the Pacing repo). A
 * container exists only once it carries a real `target_impressions > 0` and its date children - that
 * rule, and the "sum of container targets must not exceed the line item's plan" rule, are Pacing's own
 * to enforce; this editor only builds the JSON object the user asked for.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../../shared/ui/modal/modal";
import { fmtInt } from "../pacing-create/format";
import { getCurrency, getPacingCore } from "../pacing-dashboard/engine/engine-loader";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import { detectDateChildOverlaps } from "../pacing-dashboard/spa/containers.js";
import { imprWarning, spendWarning, dimSumsByKey, dimOverKeys, uncoveredInWindow } from "../pacing-dashboard/spa/container-warnings.js";
import { menuItems, splitKey, valuesLabel, draftSplitDaily } from "../pacing-dashboard/spa/dim-groups-editor.js";
import { foldValue, memberDailyOf, GROUP_DIM_KEYS } from "../pacing-dashboard/spa/dim-value-groups.js";
import {
  buildDateChild,
  buildDimChild,
  canDistribute,
  DIM_LABELS,
  dimChildWithMode,
  distributeByMonth,
  duplicateContainer,
  genId,
  nextMonthPeriod,
  resolveDimAbs,
  spendFromRaw,
  unitsFromBudget,
  withBudgetUnits,
  type LiBudgetBase,
  type PacingContainer,
  type PacingDateChild,
  type PacingDimChild,
} from "./containers";
import type { DimGroup } from "./line-item-fields";
import { fmtUnits, MoneyInput, UnitsBudgetInput, UnitsInput } from "./plan-number-inputs";

/** The delivered values per dimension per line item, as fetched: `{ [dim]: { [liId]: string[] } }`. */
export type RawSplits = Record<string, Record<string, string[]>>;

/** What the "not covered by the splits" warning reads: the line's per-day and per-value-per-day
 *  delivery (`facts.liDaily` / `facts.liSplitDaily`, grouped by the SAVED value groups). */
export interface SplitFacts {
  liDaily?: Record<string, Record<string, { im?: number }>>;
  liSplitDaily?: Record<string, Record<string, Record<string, { im?: number }>>>;
}

interface MenuSection {
  key: string;
  label: string;
  items: Array<{ value: string; group: { count: number } | null }>;
}

/** The Spend cell's value - the reference's rule: a USD campaign shows the USD figure, any other
 *  shows the contract-currency amount it was typed in. */
function spendShown(currency: string, row: { native_budget?: number | null; target_spend: number | null }) {
  return currency === "USD" ? row.target_spend : (row.native_budget ?? null);
}

function toUsd(native: number, rate: number): number {
  return getCurrency().currencyToUsd(native, rate);
}

/**
 * One dim split row - the reference's `DimChildRow`. Its dimension and value are fixed once added
 * (they come from the "+ Add dim split" menu); a split on one of the line's value groups says how
 * many values stand behind the name.
 *
 * `%`/`#` is not decoration: `pacing-core.js:resolveDimAbs` reads a percent target as a share of the
 * PARENT container's units. The resolved figure is shown beside it, as in the reference.
 */
function DimChildRow({
  child,
  container,
  li,
  currency,
  rate,
  liCoef,
  dimOver,
  group,
  onChange,
  onRemove,
}: {
  child: PacingDimChild;
  container: PacingContainer;
  li: LiBudgetBase;
  currency: string;
  rate: number;
  liCoef: boolean;
  /** This row's dimension resolves above the container's own target - its target is tinted. */
  dimOver: boolean;
  /** The line's value group this split is on, or null for a plain value. */
  group: DimGroup | null;
  onChange: (next: PacingDimChild) => void;
  onRemove: () => void;
}) {
  const resolved = resolveDimAbs(child, container);
  const marginInvalid = coefMarginInvalid(liCoef, child.margin_percent);
  const label = DIM_LABELS[child.dim_key] || child.dim_key;
  const title = group ? `${label}: ${child.dim_value} = ${group.values.join(", ")}` : `${label}: ${child.dim_value}`;
  // A budget means an ABSOLUTE target: the row flips to units, re-derived from the budget. Clearing
  // drops both money fields and leaves the target alone (the reference's `setSpendNative`).
  function setSpend(raw: string) {
    const money = spendFromRaw(raw, rate, toUsd);
    if (money.target_spend == null) {
      onChange({ ...child, ...money });
      return;
    }
    const units = unitsFromBudget(money.target_spend, li.planImpr, li.budgetUsd);
    onChange({ ...child, ...money, target_mode: "absolute", ...(units != null ? { target_value: units } : {}) });
  }
  return (
    <div className="pplan__dim-child">
      <div className="pplan__dim-identity" title={title}>
        <span className="pplan__dim-key">{label}</span>
        <strong className="pplan__dim-value">
          {child.dim_value}
          {group && <span className="pplan__vg-count"> {valuesLabel(group.values.length)}</span>}
        </strong>
      </div>
      <UnitsInput
        value={child.target_value}
        inputMode={child.target_mode === "percent" ? "decimal" : "numeric"}
        onChange={(v) => onChange({ ...child, target_value: v })}
        ariaLabel="Dim split target"
        placeholder="Target"
        className={`pplan__input pplan__input--num${dimOver ? " pplan__input--over" : ""}`}
      />
      <select
        className="pplan__select pplan__input--dim-mode"
        value={child.target_mode || "absolute"}
        onChange={(e) => onChange(dimChildWithMode(child, container, e.target.value as PacingDimChild["target_mode"]))}
        aria-label="Dim split target mode"
      >
        <option value="absolute">#</option>
        <option value="percent">%</option>
      </select>
      <MoneyInput
        value={spendShown(currency, child)}
        rate={rate}
        currency={currency}
        onChange={setSpend}
        placeholder="Spend"
        ariaLabel={`Dim split spend (${currency})`}
        className="pplan__input pplan__input--num"
      />
      <input
        type="number"
        step="0.01"
        className={`pplan__input pplan__input--num pplan__input--dim-margin${marginInvalid ? " pplan__input--invalid" : ""}`}
        aria-invalid={marginInvalid || undefined}
        value={child.margin_percent ?? ""}
        placeholder="Margin %"
        onChange={(e) => onChange({ ...child, margin_percent: e.target.value === "" ? null : Number(e.target.value) })}
        aria-label="Dim split margin percent"
      />
      {/* Units are integers: a 10% share of 84,211 reads 8,421, not 8,421.1. */}
      <span className="pplan__dim-resolved" title="Resolved units">= {fmtInt(Math.round(resolved))}</span>
      <button
        type="button"
        className={`pplan__notify-chip${child.notify_in_summary ? " pplan__notify-chip--on" : ""}`}
        onClick={() => onChange({ ...child, notify_in_summary: !child.notify_in_summary })}
        title={child.notify_in_summary ? "In Daily Summary — click to remove" : "Add this dim split to Daily Summary"}
        aria-pressed={!!child.notify_in_summary}
      >
        {child.notify_in_summary ? "✓ Summary" : "Summary"}
      </button>
      <button
        type="button"
        className="pplan__icon-btn"
        onClick={onRemove}
        aria-label={`Remove dim split ${label}: ${child.dim_value}`}
        title="Remove dim split"
      >
        ×
      </button>
    </div>
  );
}

/**
 * A menu hanging from a button, portalled to <body> (the container card clips its overflow) and
 * placed from the button's rect, flipping up near the bottom of the window. Outside click, Escape,
 * scrolling the page or resizing it closes it - the reference's menu behaviour.
 */
function useAnchoredMenu(menuHeight: number, minWidth: number) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: minWidth });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(Math.max(b.width, minWidth), window.innerWidth - 16);
    const left = Math.max(8, Math.min(b.left, window.innerWidth - width - 8));
    const below = b.bottom + 4;
    const openUp = below + menuHeight > window.innerHeight - 8 && b.top - menuHeight - 4 > 8;
    setPos({ top: openUp ? b.top - menuHeight - 4 : below, left, width });
  }, [menuHeight, minWidth]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The drawer closes on Escape too; this one is the menu's.
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus({ preventScroll: true });
    };
    const onMove = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return { open, setOpen, pos, btnRef, menuRef };
}

/** Distribute by Month - the reference's `DistributeButton`. */
function DistributeButton({ disabled, onDistribute }: { disabled: boolean; onDistribute: (mode: "proportional" | "equal") => void }) {
  const menu = useAnchoredMenu(2 * 32 + 8, 180);
  return (
    <>
      <button
        ref={menu.btnRef}
        type="button"
        className="pplan__add-btn pplan__dist-btn"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={() => {
          if (!disabled) menu.setOpen((v) => !v);
        }}
        title="Distribute by Month — split this container into monthly date children"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        Distribute
      </button>
      {menu.open &&
        createPortal(
          <div ref={menu.menuRef} className="pplan-menu" role="menu" style={{ top: menu.pos.top, left: menu.pos.left, width: menu.pos.width }}>
            {(["proportional", "equal"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="menuitem"
                className="pplan-menu__item"
                onClick={() => {
                  menu.setOpen(false);
                  onDistribute(mode);
                }}
              >
                {mode === "proportional" ? "Proportional (by days)" : "Equal (fixed per month)"}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * "+ Add dim split" - the reference's `AddDimChildButton`. Lists what the line has delivered (a
 * value group once, under its name), minus what this container already splits on, and keeps two
 * actions under the list: "Group values…" opens the group editor, "Type a value…" adds a split on a
 * value that has not delivered yet - so a campaign that starts next week can be planned today.
 */
function AddDimSplitButton({
  liId,
  rawSplits,
  groups,
  existingValues,
  onAdd,
  onGroupValues,
}: {
  liId: string;
  rawSplits: RawSplits | null | undefined;
  groups: DimGroup[];
  existingValues: Set<string>;
  onAdd: (dimKey: string, value: string) => void;
  onGroupValues: (anchor: HTMLElement | null) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [typedDim, setTypedDim] = useState<string>(GROUP_DIM_KEYS[0]);
  const [typedValue, setTypedValue] = useState("");
  const sections = (menuItems(rawSplits, liId, groups) as MenuSection[])
    .map((d) => ({ ...d, items: d.items.filter((it) => !existingValues.has(splitKey(d.key, it.value, groups))) }))
    .filter((d) => d.items.length > 0);
  const itemCount = sections.reduce((n, d) => n + d.items.length, 0);
  const menuH = Math.min(sections.length * 22 + itemCount * 32 + 8 + (typing ? 80 : 72), 320);
  const menu = useAnchoredMenu(menuH, 320);

  function close() {
    menu.setOpen(false);
    setTyping(false);
    setTypedValue("");
  }

  // The typed value: empty, already split on here, or a member of a group (its rows read as the
  // group, so a split on it could never deliver) adds nothing. A value spelled like a group is that
  // group: its exact name is what gets added.
  const typed = typedValue.trim();
  const typedFold = foldValue(typed);
  const typedGroup = groups.find((g) => g.dim_key === typedDim && foldValue(g.name) === typedFold) || null;
  const typedMember = !typedGroup && groups.some((g) => g.dim_key === typedDim && g.values.some((v) => foldValue(v) === typedFold));
  const canAddTyped = !!typed && !typedMember && !existingValues.has(splitKey(typedDim, typedGroup ? typedGroup.name : typed, groups));
  function addTyped() {
    if (!canAddTyped) return;
    onAdd(typedDim, typedGroup ? typedGroup.name : typed);
    close();
  }

  return (
    <>
      <button
        ref={menu.btnRef}
        type="button"
        className="pplan__add-btn"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={() => (menu.open ? close() : menu.setOpen(true))}
      >
        + Add dim split
      </button>
      {menu.open &&
        createPortal(
          <div ref={menu.menuRef} className="pplan-menu pplan-menu--scroll" style={{ top: menu.pos.top, left: menu.pos.left, width: menu.pos.width }}>
            {sections.map((d) => (
              <div key={d.key}>
                <div className="pplan-menu__hd">{d.label}</div>
                {d.items.map((it) => (
                  <button
                    key={`${d.key}:${it.value}`}
                    type="button"
                    className="pplan-menu__item"
                    onClick={() => {
                      onAdd(d.key, it.value);
                      close();
                    }}
                  >
                    {it.value}
                    {it.group && <span className="pplan__vg-count"> group · {valuesLabel(it.group.count)}</span>}
                  </button>
                ))}
              </div>
            ))}
            <div className="pplan-menu__ft">
              {typing ? (
                <>
                  <div className="pplan-menu__hd">Value not delivered yet</div>
                  <div className="pplan-menu__form">
                    <select className="pplan__select" aria-label="Dimension" value={typedDim} onChange={(e) => setTypedDim(e.target.value)}>
                      {GROUP_DIM_KEYS.map((k) => (
                        <option key={k} value={k}>{DIM_LABELS[k] || k}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="pplan__input"
                      aria-label="Value"
                      autoFocus
                      maxLength={300}
                      value={typedValue}
                      onChange={(e) => setTypedValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTyped();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="button button--primary button--sm"
                      disabled={!canAddTyped}
                      onClick={addTyped}
                      title={typedMember ? "This value is in a value group of this line" : undefined}
                    >
                      Add
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="pplan-menu__item pplan-menu__item--action"
                    onClick={() => {
                      const anchor = menu.btnRef.current;
                      close();
                      onGroupValues(anchor);
                    }}
                  >
                    Group values…
                  </button>
                  <button type="button" className="pplan-menu__item pplan-menu__item--action" onClick={() => setTyping(true)}>
                    Type a value…
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * Is an ENTERED margin outside the coefficient contract's range?
 *
 * Only on a coefficient line item, and only once something is typed: blank means "inherit from the
 * level above", which is always legal and is how most splits are written. `validateCoefLi` (server,
 * and `coef-precheck.ts` before the save) is the real gate; this is the in-place red border on the
 * offending cell, ported from the retired SPA's own `marginInvalid` in `PacingTab.jsx`.
 */
function coefMarginInvalid(liCoef: boolean, margin: number | null | undefined): boolean {
  if (!liCoef || margin == null) return false;
  const n = Number(margin);
  return !(Number.isFinite(n) && n >= 0 && n < 100);
}

function DateChildRow({
  child,
  li,
  currency,
  rate,
  liCoef,
  imprOver,
  spendOver,
  onChange,
  onRemove,
}: {
  child: PacingDateChild;
  li: LiBudgetBase;
  currency: string;
  rate: number;
  liCoef: boolean;
  /** The date splits' units / spend add up past the container's own - every row's cell is tinted. */
  imprOver: boolean;
  spendOver: boolean;
  onChange: (next: PacingDateChild) => void;
  onRemove: () => void;
}) {
  const marginInvalid = coefMarginInvalid(liCoef, child.margin_percent);
  return (
    <div className="pplan__date-child">
      <input
        type="text"
        className="pplan__input pplan__input--name"
        value={child.name ?? ""}
        placeholder="Period name (optional)"
        aria-label="Date split name"
        onChange={(e) => onChange({ ...child, name: e.target.value })}
      />
      <input
        type="date"
        className="pplan__input"
        value={child.fs ?? ""}
        aria-label="Date split start"
        onChange={(e) => onChange({ ...child, fs: e.target.value || null })}
      />
      <input
        type="date"
        className="pplan__input"
        value={child.fe ?? ""}
        aria-label="Date split end"
        onChange={(e) => onChange({ ...child, fe: e.target.value || null })}
      />
      <UnitsBudgetInput
        value={child.target_impressions}
        onChange={(v) => onChange({ ...child, target_impressions: v })}
        fromBudget={unitsFromBudget(Number(child.target_spend) || 0, li.planImpr, li.budgetUsd)}
        ariaLabel="Date split units"
        className={`pplan__input pplan__input--num${imprOver ? " pplan__input--over" : ""}`}
      />
      {/* Both money fields, as the reference writes them: the typed amount is the contract-currency
          truth, `target_spend` its USD cache at the campaign rate (dash-gate re-derives the cache on
          save anyway). The units follow the new budget. */}
      <MoneyInput
        value={spendShown(currency, child)}
        rate={rate}
        currency={currency}
        onChange={(raw) => {
          const money = spendFromRaw(raw, rate, toUsd);
          onChange(money.target_spend == null ? { ...child, ...money } : withBudgetUnits({ ...child, ...money }, money.target_spend, li));
        }}
        placeholder="Spend"
        ariaLabel={`Date split spend (${currency})`}
        className={`pplan__input pplan__input--num${spendOver ? " pplan__input--over" : ""}`}
      />
      {/* The middle level of the coefficient's margin chain (dim child → DATE CHILD → container →
          line item, `PacingCore.buildMarginIndex`). Without this input the engine could resolve a
          date child's own margin but nobody could write one. */}
      <input
        type="number"
        step="0.01"
        className={`pplan__input pplan__input--num pplan__input--dc-margin${marginInvalid ? " pplan__input--invalid" : ""}`}
        aria-invalid={marginInvalid || undefined}
        value={child.margin_percent ?? ""}
        placeholder="Margin %"
        aria-label="Date split margin percent"
        onChange={(e) => onChange({ ...child, margin_percent: e.target.value === "" ? null : Number(e.target.value) })}
      />
      <button type="button" className="pplan__icon-btn" onClick={onRemove} aria-label="Remove date split" title="Remove date split">
        ×
      </button>
    </div>
  );
}

function DuplicateContainerDialog({
  src,
  onConfirm,
  onCancel,
}: {
  src: PacingContainer;
  onConfirm: (opts: { name: string | null; fs: string; fe: string; scale: number }) => void;
  onCancel: () => void;
}) {
  const seed = nextMonthPeriod(src.fs, src.fe);
  const [name, setName] = useState(seed.name || `${src.name || "Container"} (copy)`);
  const [fs, setFs] = useState(seed.fs);
  const [fe, setFe] = useState(seed.fe);
  const [scale, setScale] = useState("1.0");
  const scaleN = parseFloat(scale);
  const scaleValid = Number.isFinite(scaleN) && scaleN > 0;
  const datesValid = !!fs && !!fe && fs <= fe;
  const canSave = name.trim().length > 0 && datesValid && scaleValid;

  return (
    <Modal open onClose={onCancel} title="Duplicate container" subtitle={`Clones "${src.name || "Container"}" — all date splits, scaled by factor.`}>
      <div className="pplan__dialog-body">
        <label className="pplan__field">
          <span className="pplan__field-label">New name</span>
          <input type="text" className="pplan__input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="pplan__field-row">
          <label className="pplan__field">
            <span className="pplan__field-label">Period start</span>
            <input type="date" className="pplan__input" value={fs} onChange={(e) => setFs(e.target.value)} />
          </label>
          <label className="pplan__field">
            <span className="pplan__field-label">Period end</span>
            <input type="date" className="pplan__input" value={fe} onChange={(e) => setFe(e.target.value)} />
          </label>
        </div>
        {!datesValid && <p className="pplan__hint pplan__hint--warn">End date must be on or after start.</p>}
        <label className="pplan__field">
          <span className="pplan__field-label">Scale</span>
          <input
            type="number"
            step="0.01"
            min="0"
            className="pplan__input pplan__input--num"
            value={scale}
            onChange={(e) => setScale(e.target.value)}
          />
        </label>
        <p className="pplan__hint">
          {!scaleValid
            ? "Scale must be a positive number."
            : scaleN === 1
              ? "Exact copy — targets unchanged."
              : `${scaleN > 1 ? "+" : ""}${Math.round((scaleN - 1) * 1000) / 10}% — every absolute target is multiplied.`}
        </p>
      </div>
      <div className="pplan__dialog-actions">
        <button type="button" className="button button--ghost button--sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="button button--primary button--sm"
          disabled={!canSave}
          onClick={() => onConfirm({ name: name.trim(), fs, fe, scale: scaleN })}
        >
          Duplicate
        </button>
      </div>
    </Modal>
  );
}

// Containers start collapsed; the header still carries name / period / units / split count /
// actions, so nothing needed for scanning is hidden. A container added one click ago opens.
export function ContainerCard({
  liId,
  container,
  li,
  currency,
  rate,
  liCoef,
  rawSplits,
  groups,
  splitFacts,
  onGroupValues,
  onChange,
  onRemove,
  onDuplicate,
  defaultOpen = false,
}: {
  liId: string;
  container: PacingContainer;
  /** The owning line item's units and USD budget - what a budget is turned into units against. */
  li: LiBudgetBase;
  currency: string;
  /** The campaign rate (native → USD), 1 on a USD campaign. */
  rate: number;
  /** Whether the OWNING line item is on coefficient cost. Only used to flag an out-of-range margin
   *  on a split before the save - the figures themselves are the same either way. */
  liCoef: boolean;
  /** The values the pacing has delivered, as fetched - what "+ Add dim split" offers. */
  rawSplits?: RawSplits | null;
  /** The line's DRAFT value groups. */
  groups: DimGroup[];
  splitFacts?: SplitFacts | null;
  /** "Group values…" from the add menu: open the line's group editor on a new group. */
  onGroupValues: (anchor: HTMLElement | null) => void;
  onChange: (next: PacingContainer) => void;
  onRemove: () => void;
  onDuplicate: (dup: PacingContainer) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  function setField<K extends keyof PacingContainer>(field: K, value: PacingContainer[K]) {
    onChange({ ...container, [field]: value });
  }
  function setSpend(raw: string) {
    const money = spendFromRaw(raw, rate, toUsd);
    // Clearing leaves the units alone - there is nothing to prorate.
    onChange(money.target_spend == null ? { ...container, ...money } : withBudgetUnits({ ...container, ...money }, money.target_spend, li));
  }
  function setDateChild(idx: number, next: PacingDateChild) {
    onChange({ ...container, date_children: container.date_children.map((dc, i) => (i === idx ? next : dc)) });
  }
  function removeDateChild(idx: number) {
    onChange({ ...container, date_children: container.date_children.filter((_, i) => i !== idx) });
  }
  function addDateChild() {
    onChange({ ...container, date_children: [...container.date_children, buildDateChild(container)] });
  }
  function setDimChild(idx: number, next: PacingDimChild) {
    onChange({ ...container, dim_children: container.dim_children.map((dx, i) => (i === idx ? next : dx)) });
  }
  function removeDimChild(idx: number) {
    onChange({ ...container, dim_children: container.dim_children.filter((_, i) => i !== idx) });
  }
  function addDimChild(dimKey: string, dimValue: string) {
    onChange({ ...container, dim_children: [...container.dim_children, buildDimChild(dimKey, dimValue)] });
  }
  function doDistribute(mode: "proportional" | "equal") {
    onChange(distributeByMonth(container, mode, rate, (usd, r) => getCurrency().usdToNative(usd, r)));
  }

  const dateChildren = container.date_children || [];
  const dimChildren = container.dim_children || [];
  const dcOverlaps = detectDateChildOverlaps(container) as Array<{ a: { idx: number; name?: string | null }; b: { idx: number; name?: string | null }; start: string; end: string }>;
  const dcSumImpr = dateChildren.reduce((sum, dc) => sum + (Number(dc.target_impressions) || 0), 0);
  const dcSumSpend = dateChildren.reduce((sum, dc) => sum + (Number(dc.target_spend) || 0), 0);
  const cTi = Number(container.target_impressions) || 0;
  const cTs = Number(container.target_spend) || 0;
  const imprOver = imprWarning(cTi, dcSumImpr);
  const spendOver = spendWarning(cTs, dcSumSpend);

  // Per dimension, never across: Audience and Geo splits cut the same units along independent axes,
  // so their targets do not add up.
  const dimSums = dimSumsByKey(dimChildren.map((dx) => ({ key: dx.dim_key, abs: resolveDimAbs(dx, container) }))) as Record<string, number>;
  const dimOverSet = new Set<string>(dimOverKeys(cTi, dimSums));

  // A value already split on here is not offered again; on a dimension the line groups, `Promo`
  // hides `promo` too (the save's rule 7).
  const existingDimValues = new Set(dimChildren.map((dx) => splitKey(dx.dim_key, dx.dim_value, groups) as string));
  const groupOf = (dx: PacingDimChild) =>
    groups.find((g) => g.dim_key === dx.dim_key && foldValue(g.name) === foldValue(dx.dim_value)) || null;

  const splitCount = dateChildren.length + dimChildren.length;

  // Container dim scope (spec 2026-08-14): splits that COVER the container make it a statement
  // about all of its units, so its periods count only the declared values. Shown two ways: what it
  // now counts, and what that drops.
  const dimFilter = getPacingCore().containerDimFilter(container as unknown as Record<string, unknown>);
  const scopeLabel = dimFilter
    ? Object.keys(dimFilter).map((k) => `${DIM_LABELS[k] || k} · ${dimFilter[k].join(", ")}`).join("  ·  ")
    : null;
  const uncovered = useMemo(() => {
    if (!dimFilter || !splitFacts?.liSplitDaily) return [];
    // The facts are grouped by the SAVED value groups, the splits on screen by the DRAFT ones.
    const daily = draftSplitDaily(splitFacts.liSplitDaily[liId], memberDailyOf(splitFacts.liSplitDaily)?.[liId], groups);
    return uncoveredInWindow(daily, splitFacts.liDaily?.[liId] ?? {}, container, dimFilter) as Array<{ dim: string; value: string; im: number; pct: number }>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeLabel, splitFacts, liId, container, groups]);

  return (
    <div className="pplan__container-card">
      {/* Summary and actions sit in ONE flex row as siblings, so neither can overlap the other. Not
          nested, because both are buttons. */}
      <div className="pplan__container-top">
        <button type="button" className="pplan__container-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className={`pplan__chevron${open ? " pplan__chevron--open" : ""}`}>▸</span>
          <span className="pplan__container-name">{container.name || "Container"}</span>
          {container.fs && container.fe && (
            <span className="pplan__container-period">
              {container.fs} – {container.fe}
            </span>
          )}
          {scopeLabel && (
            <span className="pplan__container-scope" title="These splits cover the container, so its periods count only this delivery">
              counts only {scopeLabel}
            </span>
          )}
          <span className="pplan__container-units">{fmtInt(container.target_impressions || 0)} units</span>
          <span className="pplan__badge">
            {splitCount} split{splitCount === 1 ? "" : "s"}
          </span>
        </button>
        <div className="pplan__container-actions">
          <button type="button" className="button button--ghost button--sm" onClick={() => setDuplicating(true)} title="Duplicate this container">
            Duplicate
          </button>
          <button
            type="button"
            className="pplan__icon-btn"
            onClick={() => setShowRemoveConfirm(true)}
            aria-label="Remove container"
            title="Remove container"
          >
            ×
          </button>
        </div>
      </div>

      {open && (
        <div className="pplan__container-body">
          <div className="pplan__field-row">
            <label className="pplan__field pplan__field--grow">
              <span className="pplan__field-label">Name</span>
              <input
                type="text"
                className="pplan__input"
                value={container.name || ""}
                placeholder="Container name"
                onChange={(e) => setField("name", e.target.value)}
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Period start</span>
              <input type="date" className="pplan__input" value={container.fs} onChange={(e) => setField("fs", e.target.value)} />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Period end</span>
              <input type="date" className="pplan__input" value={container.fe} onChange={(e) => setField("fe", e.target.value)} />
            </label>
          </div>
          <div className="pplan__field-row">
            <label className="pplan__field">
              <span className="pplan__field-label">Units</span>
              <UnitsBudgetInput
                value={container.target_impressions}
                onChange={(v) => setField("target_impressions", v)}
                fromBudget={unitsFromBudget(cTs, li.planImpr, li.budgetUsd)}
                ariaLabel="Container units"
                className="pplan__input pplan__input--num"
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Spend</span>
              <MoneyInput
                value={spendShown(currency, container)}
                rate={rate}
                currency={currency}
                onChange={setSpend}
                placeholder="0"
                ariaLabel="Container spend"
                className="pplan__input pplan__input--num"
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Margin %</span>
              <input
                type="number"
                step="0.01"
                className={`pplan__input pplan__input--num${containerMarginInvalid(liCoef, container) ? " pplan__input--invalid" : ""}`}
                aria-invalid={containerMarginInvalid(liCoef, container) || undefined}
                placeholder="inherit"
                value={container.margin_percent ?? ""}
                onChange={(e) => setField("margin_percent", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
          </div>

          <div className="pplan__subsection">
            <div className="pplan__subsection-head">Date splits ({dateChildren.length})</div>
            {dateChildren.map((dc, idx) => (
              <DateChildRow
                key={dc.id || idx}
                child={dc}
                li={li}
                currency={currency}
                rate={rate}
                liCoef={liCoef}
                imprOver={imprOver}
                spendOver={spendOver}
                onChange={(next) => setDateChild(idx, next)}
                onRemove={() => removeDateChild(idx)}
              />
            ))}
            {imprOver && (
              <p className="pplan__hint pplan__hint--warn">
                ⚠ Date-children units sum ({fmtUnits(dcSumImpr)}) exceeds container target ({fmtUnits(cTi)})
              </p>
            )}
            {spendOver && (
              <p className="pplan__hint pplan__hint--warn">
                ⚠ Date-children spend sum ({fmtUnits(dcSumSpend)}) exceeds container target ({fmtUnits(cTs)})
              </p>
            )}
            {dcOverlaps.map((ov, i) => (
              <p key={`ov-${i}`} className="pplan__hint pplan__hint--info">
                ⚠ Date-children overlap: {ov.a.name || `Split ${ov.a.idx + 1}`} & {ov.b.name || `Split ${ov.b.idx + 1}`}: {ov.start} – {ov.end}
              </p>
            ))}
            <div className="pplan__split-actions">
              <button type="button" className="pplan__add-btn" onClick={addDateChild}>
                + Add date split
              </button>
              <DistributeButton disabled={!canDistribute(container)} onDistribute={doDistribute} />
            </div>
          </div>

          {/* Date splits say WHEN this container's units land; dim splits say WHAT they are. Always
              there, since a value can be typed before it delivers. */}
          <div className="pplan__subsection">
            <div className="pplan__subsection-head">Dim splits ({dimChildren.length})</div>
            {dimChildren.map((dx, idx) => (
              <DimChildRow
                key={dx.id || idx}
                child={dx}
                container={container}
                li={li}
                currency={currency}
                rate={rate}
                liCoef={liCoef}
                dimOver={dimOverSet.has(dx.dim_key)}
                group={groupOf(dx)}
                onChange={(next) => setDimChild(idx, next)}
                onRemove={() => removeDimChild(idx)}
              />
            ))}
            {[...dimOverSet].map((k) => (
              <p key={`dimover-${k}`} className="pplan__hint pplan__hint--warn">
                ⚠ {DIM_LABELS[k] || k} splits resolve to {fmtUnits(Math.round(dimSums[k]))} — above the container target ({fmtUnits(cTi)})
              </p>
            ))}
            {uncovered.slice(0, 4).map((u) => (
              <p key={`uncov-${u.dim}-${u.value}`} className="pplan__hint pplan__hint--warn">
                ⚠ {u.value} — {fmtUnits(Math.round(u.im))} delivered in this window ({u.pct.toFixed(1)}%), not covered by the{" "}
                {DIM_LABELS[u.dim] || u.dim} splits
              </p>
            ))}
            {uncovered.length > 4 && (
              <p className="pplan__hint pplan__hint--warn">
                ⚠ …and {uncovered.length - 4} more value{uncovered.length - 4 > 1 ? "s" : ""} not covered by the splits
              </p>
            )}
            <div className="pplan__split-actions">
              <AddDimSplitButton
                liId={liId}
                rawSplits={rawSplits}
                groups={groups}
                existingValues={existingDimValues}
                onAdd={addDimChild}
                onGroupValues={onGroupValues}
              />
            </div>
          </div>
        </div>
      )}

      {duplicating && (
        <DuplicateContainerDialog
          src={container}
          onCancel={() => setDuplicating(false)}
          onConfirm={(opts) => {
            onDuplicate(duplicateContainer(container, opts));
            setDuplicating(false);
          }}
        />
      )}

      {showRemoveConfirm && (
        <Modal
          open
          onClose={() => setShowRemoveConfirm(false)}
          title={`Remove container "${container.name || ""}"?`}
          subtitle="This will remove the container and all its date / dim children. This can't be undone easily."
        >
          <div className="pplan__dialog-actions">
            <button type="button" className="button button--ghost button--sm" onClick={() => setShowRemoveConfirm(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--danger button--sm"
              onClick={() => {
                setShowRemoveConfirm(false);
                onRemove();
              }}
            >
              Remove
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function containerMarginInvalid(liCoef: boolean, container: PacingContainer): boolean {
  return coefMarginInvalid(liCoef, container.margin_percent);
}

export function buildNewContainerId(): string {
  return genId("c");
}
