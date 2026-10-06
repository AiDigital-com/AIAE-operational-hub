// workspace/src/pages/Dashboard/components/Settings/Widgets/ChipSettingsPanel.jsx — a chip's settings (spec §6.4).
// A layer that does not register with PopupCoordinator, marked data-dp-popup="1" (the
// MultiSelect idiom), so it opens inside the formula dialog, the Spotlight and a popover
// without closing them; z-index above the dialog's 150. The CONTENT is its own component so a
// headless test drives it without a portal.
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import FormulaChips from '@shared/formula-chips';
import { PopRow, Seg } from './rows.jsx';
import { OPTION_WORDS, SETTING_LABELS, chipFace } from '../chips/info.js';
import { cleanChip } from '../chips/tokens.js';
import { judgeChip } from '../chips/compile.js';
import { placeMenu } from '../menu-placement.js';
import './ChipSettingsPanel.css';

const { CATALOG, SETTING_ORDER } = FormulaChips;
// This app's scale, not Pacing's (see FormulaEditorDialog.css and pacing-spa.css): the panel
// is a portal on <body> opened from inside the formula dialog, so it joins the Hub's other
// portalled popovers at 310 — above the dialog's 305 and the drawer's 300, under the tooltip.
// Pacing's own copy keeps 160, correct against its drawer at 100. Do not carry upstream.
const PANEL_Z = 310;
const N_MAX = 90;
// The row labels are the chip's hover list's (info.js SETTING_LABELS): one vocabulary for both.
const LABELS = SETTING_LABELS;
const word = (k, v) => OPTION_WORDS[`${k}:${v}`] || OPTION_WORDS[String(v)] || String(v);
// An Off | On pair; `why` is the sentence On is dimmed with here, or null.
const ON_OFF = (why) => [['off', 'Off'], ['on', 'On', why]];
const PERIODS_SUM = [['widget', 'Widget period'], ['lastDay', 'Last day with data'], ['lastDays', 'Last N days'], ['flightToDate', 'Flight to date'], ['monthToDate', 'Month to date'], ['wholeMonth', 'Whole month'], ['previousMonth', 'Previous month'], ['previous', 'Previous period'], ['sinceDate', 'Since date'], ['custom', 'Custom dates']];
// A rate counts days with data (`norm` refuses lastDays on a rate chip), so its N row is the data-day kind.
const PERIODS_RATE = PERIODS_SUM.map(([k, l]) => (k === 'lastDays' ? ['lastDataDays', 'Last N days with data'] : [k, l]));
const WHERE_NOTE = 'Where rows arrive with the row aggregates';
const today = () => new Date().toISOString().slice(0, 10);
/** The N a typed string means: a whole number clamped to 1..90, or null while the field holds nothing numeric. */
function clampN(v) {
  if (String(v).trim() === '') return null;
  const num = Number(v);
  return Number.isFinite(num) ? Math.max(1, Math.min(N_MAX, Math.round(num))) : null;
}

/** The period a kind becomes, keeping what the previous period carries that the new kind reads.
 *  `days` rides only on the two data-day kinds: `norm` allows it on lastDataDays and lastDay alone,
 *  so a sum chip's N-day spelling (lastDays) drops it even when the previous period carried it. */
function periodFor(kind, prev) {
  const n = prev && prev.n ? prev.n : 7;
  const days = prev && prev.days ? { days: prev.days } : {};
  switch (kind) {
    case 'widget': return undefined;
    case 'lastDays': return { kind, n };
    case 'lastDataDays': return { kind, n, ...days };
    case 'lastDay': return { kind, ...days };
    // Previous period is the one before the WIDGET period: the face prints one word for every
    // `of`, so the panel writes the one reading a person can see; a nested `of` stays a hand-made form.
    case 'previous': return { kind, of: { kind: 'widget' } };
    case 'sinceDate': return { kind, date: prev && prev.date ? prev.date : today() };
    case 'custom': return { kind, from: prev && prev.from ? prev.from : today(), to: prev && prev.to ? prev.to : today() };
    default: return { kind };
  }
}

/** `judge(chip, placement, slot)` is the host's own rule for the sentence an option is dimmed
 *  with (the field's `judgeOn`, which lifts the engine's «not yet» where the slot stores the
 *  chip as text), so the panel and the field's suggestions say the same thing; judgeChip without one. */
export function ChipSettingsContent({ chip, placement, slot, onChange, onReplace, judge }) {
  // The chip the rows SHOW: the prop, echoed locally after every pick so the next pick composes
  // with it before the host hands the new chip back (a headless test never does), and reset
  // whenever the host does.
  const [cur, setCur] = useState(chip);
  useLayoutEffect(() => { setCur(chip); }, [chip]);
  // What the N field shows while it is being typed in (null = the chip's n): the chip takes
  // every whole number as it is typed, but a cleared field stays empty until blur or Enter
  // instead of snapping to 1 under the next digit.
  const [nDraft, setNDraft] = useState(null);
  const base = chip && chip.base;
  useLayoutEffect(() => { setNDraft(null); }, [base]);
  const def = CATALOG[cur && cur.base];
  if (!def) return <div className="wgf-cp-body">Unknown chip {String(cur && cur.base)}</div>;
  const set = (k, v) => {
    const next = { ...cur };
    if (v === undefined) delete next[k]; else next[k] = v;
    const clean = cleanChip(next);
    setCur(clean);
    onChange(clean);
  };
  const refused = (k, v) => (judge || judgeChip)({ ...cur, [k]: v }, placement, slot);
  const rows = [];
  for (const k of SETTING_ORDER) {
    if (k === 'base' || !(k in def.settings)) continue;
    const st = def.settings[k];
    if (k === 'period') {
      const kinds = def.family === 'rate' ? PERIODS_RATE : PERIODS_SUM;
      const p = cur.period;
      const current = p ? p.kind : 'widget';
      rows.push(<PopRow key="period" label="Period"><Seg label="Period" value={current} stack
        options={kinds.map(([v, text]) => [v, text, v === 'widget' ? null : refused('period', periodFor(v, p))])}
        onPick={(v) => set('period', periodFor(v, p))} /></PopRow>);
      if (current === 'lastDays' || current === 'lastDataDays') {
        rows.push(<PopRow key="n" label="N"><input className="sp-inp sp-inp--sans wgf-cp-n" aria-label="N" type="number" min={1} max={N_MAX} inputMode="numeric"
          value={nDraft ?? String(p.n)}
          onChange={(e) => { const v = e.target.value; setNDraft(v); const n = clampN(v); if (n !== null && n !== p.n) set('period', { ...p, n }); }}
          onBlur={() => setNDraft(null)}
          onKeyDown={(e) => { if (e.key === 'Enter') setNDraft(null); }} /></PopRow>);
      }
      // Own days: a rate over the line's own data days (spec §2.1), so only on a data-day period
      // and only where there is a line to own them.
      if (def.family === 'rate' && (current === 'lastDataDays' || current === 'lastDay') && (placement.grain === 'li' || placement.grain === 'dateLi')) {
        rows.push(<PopRow key="days" label="Own days"><Seg label="Own days" value={p.days === 'row' ? 'on' : 'off'}
          options={ON_OFF(p.days === 'row' ? null : refused('period', { ...p, days: 'row' }))}
          onPick={(v) => { const np = { ...p }; if (v === 'on') np.days = 'row'; else delete np.days; set('period', np); }} /></PopRow>);
      }
      // A date field being cleared or retyped writes nothing until it holds a date again, so
      // every chip the panel writes passes norm (`date is YYYY-MM-DD`).
      if (current === 'sinceDate') rows.push(<PopRow key="since" label="Since"><input className="sp-inp sp-inp--sans" aria-label="Since date" type="date" value={p.date} onChange={(e) => { if (e.target.value) set('period', { ...p, date: e.target.value }); }} /></PopRow>);
      // Two rows shaped like Since, not two inputs in one 212 px column (a date control needs
      // about 115 px, so a pair would clip). Each bounds the other, as norm's «to is not before
      // from»: a From typed past To drags To along, and the other way round.
      if (current === 'custom') {
        rows.push(<PopRow key="from" label="From"><input className="sp-inp sp-inp--sans" aria-label="From date" type="date" value={p.from} max={p.to}
          onChange={(e) => { const v = e.target.value; if (v) set('period', { ...p, from: v, to: p.to < v ? v : p.to }); }} /></PopRow>);
        rows.push(<PopRow key="to" label="To"><input className="sp-inp sp-inp--sans" aria-label="To date" type="date" value={p.to} min={p.from}
          onChange={(e) => { const v = e.target.value; if (v) set('period', { ...p, from: p.from > v ? v : p.from, to: v }); }} /></PopRow>);
      }
      continue;
    }
    if (k === 'skipEmpty') {
      rows.push(<PopRow key={k} label={LABELS[k]}><Seg label={LABELS[k]} value={cur.skipEmpty ? 'on' : 'off'}
        options={ON_OFF(cur.skipEmpty ? null : refused('skipEmpty', true))}
        onPick={(v) => set('skipEmpty', v === 'on' ? true : undefined)} /></PopRow>);
      continue;
    }
    if (st.where) { rows.push(<PopRow key={k} label="Where" note={WHERE_NOTE} />); continue; }
    if (st.holder) continue;
    if (!st.options) continue;
    const value = k in cur ? cur[k] : st.def;
    rows.push(<PopRow key={k} label={LABELS[k] || k}><Seg label={LABELS[k] || k} value={value} stack={st.options.length > 3}
      options={st.options.map((v) => [v, word(k, v), v === value ? null : refused(k, v)])} onPick={(v) => set(k, v === st.def ? undefined : v)} /></PopRow>);
  }
  return (
    <div className="wgf-cp-body">
      <div className="wgf-cp-head">
        <span className="wgf-cp-name">{def.name}</span>
        <label className="wgf-cp-change"><span>Change to</span>
          <select className="sp-inp sp-inp--sans" aria-label="Change to" value={cur.base} onChange={(e) => onReplace(e.target.value)}>
            {Object.keys(CATALOG).map((b) => <option key={b} value={b}>{CATALOG[b].name}</option>)}
          </select></label>
      </div>
      <div className="wgf-cp-face" aria-live="polite">{chipFace(cur)}</div>
      {rows.length ? rows : <div className="wgf-cp-none">This chip has no settings.</div>}
    </div>
  );
}

export default function ChipSettingsPanel({ open, chip, placement, slot, anchorEl, onChange, onReplace, onClose, label, judge }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  // The chip the panel is open on: Escape and an outside click hand focus back to it.
  const triggerRef = useRef(anchorEl); triggerRef.current = anchorEl;
  // Escape belongs to the innermost open thing: window CAPTURE + stopPropagation, the idiom
  // MultiSelect and Popover use, so the host behind this layer does not take the key too.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const onEscape = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeRef.current?.();
      triggerRef.current?.focus({ preventScroll: true });
    };
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      // The chip is not «outside»: it toggles, and closing here would fight the re-open on the same click.
      if (triggerRef.current && typeof triggerRef.current.contains === 'function' && triggerRef.current.contains(e.target)) return;
      // Focus standing inside the panel would land on <body>; the chip takes it back, as on Escape.
      if (ref.current && ref.current.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true });
      closeRef.current?.();
    };
    window.addEventListener('keydown', onEscape, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onEscape, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !ref.current || !anchorEl?.getBoundingClientRect) return undefined;
    const place = () => {
      if (!ref.current || !anchorEl?.getBoundingClientRect) return;
      const a = anchorEl.getBoundingClientRect();
      const panelW = ref.current.offsetWidth || 340; const panelH = ref.current.offsetHeight || 200;
      // placeMenu right-aligns to `right`: hand it the chip's LEFT edge plus the panel width so
      // the panel's left edge sits under the chip's left edge, then its flip-and-clamp does the rest.
      const next = placeMenu({ top: a.top, bottom: a.bottom, right: a.left + panelW }, { panelW, panelH, viewportW: window.innerWidth, viewportH: window.innerHeight });
      // A same-place write keeps the current object, so a scroll inside the panel re-renders nothing.
      setPos((prev) => (prev && prev.top === next.top && prev.left === next.left ? prev : next));
    };
    place();
    // The panel opens from the keyboard too (spec §6.3): focus moves onto it, so Tab reaches
    // its rows and Escape is aimed at this layer rather than at the host behind it.
    if (!ref.current.contains(document.activeElement)) ref.current.focus({ preventScroll: true });
    // Capture: a scroll inside the drawer body does not bubble to window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, anchorEl, chip]);
  if (!open || typeof document === 'undefined') return null;
  // The dialog is named after the chip it is open on («Avg CPM settings»), unless the host names it.
  const def = CATALOG[chip && chip.base];
  const rootLabel = label || (def ? `${def.name} settings` : 'Chip settings');
  return createPortal(
    <div data-dp-popup="1" ref={ref} className="wgf-cp" role="dialog" aria-label={rootLabel} tabIndex={-1}
      style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, zIndex: PANEL_Z }}>
      <ChipSettingsContent chip={chip} placement={placement} slot={slot} onChange={onChange} onReplace={onReplace} judge={judge} />
    </div>, document.body,
  );
}
