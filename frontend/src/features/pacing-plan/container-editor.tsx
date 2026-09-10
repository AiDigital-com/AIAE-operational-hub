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
  duplicateContainer,
  genId,
  nextMonthPeriod,
  type PacingContainer,
  type PacingDateChild,
} from "./containers";

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

  const dateChildSum = container.date_children.reduce((s, dc) => s + (Number(dc.target_impressions) || 0), 0);
  const dateChildOver = (Number(container.target_impressions) || 0) > 0 && dateChildSum > (Number(container.target_impressions) || 0);
  const splitCount = container.date_children.length;

  return (
    <div className="pplan__container-card">
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
