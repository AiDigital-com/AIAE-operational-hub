/**
 * Container editor for the Pacing Settings plan editor (§9 of the migration plan, US-125) - a named
 * date sub-period of one line item's plan, with its own target and date-children (the monthly-renewal
 * shape: docs/superpowers/archive/specs/2026-05-14-split-containers.md §1 in the Pacing repo). A
 * container exists only once it carries a real `target_impressions > 0` and its date children - that
 * rule, and the "sum of container targets must not exceed the line item's plan" rule, are Pacing's own
 * to enforce; this editor only builds the JSON object the user asked for.
 */
import { useState } from "react";
import { Modal } from "../../shared/ui/modal/modal";
import { NumericField } from "../pacing-create/numeric-field";
import { fmtInt, parseEditableNumber } from "../pacing-create/format";
import {
  buildDateChild,
  buildDimChild,
  DIM_KEYS,
  DIM_LABELS,
  dimKeysOverTarget,
  duplicateContainer,
  genId,
  nextMonthPeriod,
  resolveDimAbs,
  type PacingContainer,
  type PacingDateChild,
  type PacingDimChild,
} from "./containers";

/**
 * One sub-breakdown row (§10, US-129/130).
 *
 * The value is a free-text input, not a picker. The retired SPA offered only values
 * BigQuery had already delivered (`availableSplits` in PacingTab.jsx), which makes a
 * brand-new plan impossible to write - and US-130 is explicitly about planning against
 * a label that does not exist in NetSuite yet. Free text is the wider behaviour and
 * subsumes the old one.
 *
 * `%`/`units` is not decoration: `pacing-core.js:resolveDimAbs` reads a percent target
 * as a share of the PARENT container's units, so the same number means two very
 * different things depending on this toggle. The resolved figure is shown beside it
 * so nobody has to hold that conversion in their head.
 */
function DimChildRow({
  child,
  container,
  onChange,
  onRemove,
}: {
  child: PacingDimChild;
  container: PacingContainer;
  onChange: (next: PacingDimChild) => void;
  onRemove: () => void;
}) {
  const resolved = resolveDimAbs(child, container);
  const showResolved = child.target_mode === "percent" && (Number(child.target_value) || 0) > 0;
  return (
    <div className="pplan__dim-child">
      <select
        className="pplan__select pplan__input--dim-key"
        value={child.dim_key}
        onChange={(e) => onChange({ ...child, dim_key: e.target.value })}
        aria-label="Sub-breakdown dimension"
      >
        {DIM_KEYS.map((k) => (
          <option key={k} value={k}>{DIM_LABELS[k]}</option>
        ))}
      </select>
      <input
        type="text"
        className="pplan__input pplan__input--dim-value"
        value={child.dim_value}
        placeholder="Value"
        onChange={(e) => onChange({ ...child, dim_value: e.target.value })}
        aria-label="Sub-breakdown value"
      />
      <NumericField
        value={child.target_value == null ? "" : String(child.target_value)}
        onChange={(v) => onChange({ ...child, target_value: parseEditableNumber(v) ?? null })}
        ariaLabel="Sub-breakdown target"
        placeholder="Target"
        className="pplan__input pplan__input--num"
      />
      <select
        className="pplan__select pplan__input--dim-mode"
        value={child.target_mode}
        onChange={(e) => onChange({ ...child, target_mode: e.target.value as PacingDimChild["target_mode"] })}
        aria-label="Sub-breakdown target mode"
      >
        <option value="absolute">units</option>
        <option value="percent">%</option>
      </select>
      <span className="pplan__dim-resolved" aria-hidden={!showResolved}>
        {showResolved ? `= ${fmtInt(Math.round(resolved))}` : ""}
      </span>
      <input
        type="number"
        step="0.01"
        className="pplan__input pplan__input--num pplan__input--dim-margin"
        value={child.margin_percent ?? ""}
        placeholder="Margin %"
        onChange={(e) => onChange({ ...child, margin_percent: e.target.value === "" ? null : Number(e.target.value) })}
        aria-label="Sub-breakdown margin percent"
      />
      <button
        type="button"
        className="pplan__icon-btn"
        onClick={onRemove}
        aria-label={`Remove sub-breakdown ${child.dim_key}: ${child.dim_value || "(no value)"}`}
        title="Remove sub-breakdown"
      >
        ×
      </button>
    </div>
  );
}

function DateChildRow({
  child,
  onChange,
  onRemove,
}: {
  child: PacingDateChild;
  onChange: (next: PacingDateChild) => void;
  onRemove: () => void;
}) {
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
      <NumericField
        value={child.target_impressions == null ? "" : String(child.target_impressions)}
        onChange={(v) => onChange({ ...child, target_impressions: parseEditableNumber(v) ?? null })}
        placeholder="Units"
        ariaLabel="Date split target impressions"
        className="pplan__input pplan__input--num"
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

export function ContainerCard({
  container,
  currency,
  onChange,
  onRemove,
  onDuplicate,
  defaultOpen = false,
}: {
  container: PacingContainer;
  currency: string;
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
  function addDimChild() {
    // Seeds on the first key with an empty value, exactly as the retired SPA's
    // addDimChild did - the manager then picks the axis and types the value.
    onChange({ ...container, dim_children: [...container.dim_children, buildDimChild(DIM_KEYS[0], "")] });
  }

  const dateChildSum = container.date_children.reduce((s, dc) => s + (Number(dc.target_impressions) || 0), 0);
  const dateChildOver = (Number(container.target_impressions) || 0) > 0 && dateChildSum > (Number(container.target_impressions) || 0);
  // Date splits and sub-breakdowns are counted together: both are ways this container
  // is cut up, and the header is telling the reader how much is folded away below it.
  const splitCount = container.date_children.length + container.dim_children.length;
  const dimOverKeys = dimKeysOverTarget(container);

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
          <span className="pplan__container-units">{fmtInt(container.target_impressions)} units</span>
          <span className="pplan__badge">
            {splitCount} split{splitCount === 1 ? "" : "s"}
          </span>
        </button>
        <div className="pplan__container-actions">
          <button type="button" className="button button--ghost button--sm" onClick={() => setDuplicating(true)}>
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
              <input type="text" className="pplan__input" value={container.name} onChange={(e) => setField("name", e.target.value)} />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Start</span>
              <input type="date" className="pplan__input" value={container.fs} onChange={(e) => setField("fs", e.target.value)} />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">End</span>
              <input type="date" className="pplan__input" value={container.fe} onChange={(e) => setField("fe", e.target.value)} />
            </label>
          </div>
          <div className="pplan__field-row">
            <label className="pplan__field">
              <span className="pplan__field-label">Target impressions</span>
              <NumericField
                value={container.target_impressions == null ? "" : String(container.target_impressions)}
                onChange={(v) => setField("target_impressions", parseEditableNumber(v) ?? null)}
                ariaLabel="Container target impressions"
                className="pplan__input pplan__input--num"
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Budget ({currency})</span>
              <NumericField
                value={container.native_budget == null ? "" : String(container.native_budget)}
                onChange={(v) => setField("native_budget", parseEditableNumber(v) ?? null)}
                ariaLabel="Container budget"
                className="pplan__input pplan__input--num"
              />
            </label>
            <label className="pplan__field">
              <span className="pplan__field-label">Margin % (inherit if blank)</span>
              <input
                type="number"
                step="0.01"
                className="pplan__input pplan__input--num"
                value={container.margin_percent ?? ""}
                onChange={(e) => setField("margin_percent", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
          </div>

          <div className="pplan__subsection">
            <div className="pplan__subsection-head">Date splits ({splitCount})</div>
            {container.date_children.map((dc, idx) => (
              <DateChildRow key={dc.id} child={dc} onChange={(next) => setDateChild(idx, next)} onRemove={() => removeDateChild(idx)} />
            ))}
            {dateChildOver && (
              <p className="pplan__hint pplan__hint--warn">
                ⚠ Date splits sum to {fmtInt(dateChildSum)}, above this container's own target ({fmtInt(container.target_impressions)}).
              </p>
            )}
            <button type="button" className="pplan__add-btn" onClick={addDateChild}>
              + Add date split
            </button>
          </div>

          {/* §10. Date splits say WHEN this container's units land; sub-breakdowns say
              WHAT they are. A container can carry both, and they cut the same units
              along independent axes — which is why the warning below is per dimension
              and never a sum across them. */}
          <div className="pplan__subsection">
            <div className="pplan__subsection-head">Sub-breakdowns ({container.dim_children.length})</div>
            {container.dim_children.map((dx, idx) => (
              <DimChildRow
                key={dx.id}
                child={dx}
                container={container}
                onChange={(next) => setDimChild(idx, next)}
                onRemove={() => removeDimChild(idx)}
              />
            ))}
            {dimOverKeys.map((key) => (
              <p key={key} className="pplan__hint pplan__hint--warn">
                ⚠ {DIM_LABELS[key] || key} sub-breakdowns outrun this container's target
                ({fmtInt(container.target_impressions)}).
              </p>
            ))}
            <button type="button" className="pplan__add-btn" onClick={addDimChild}>
              + Add sub-breakdown
            </button>
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
          title={`Remove container "${container.name || "Container"}"?`}
          subtitle={`This removes the container and its ${splitCount} date split${splitCount === 1 ? "" : "s"}. This can't be undone.`}
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

export function buildNewContainerId(): string {
  return genId("c");
}
