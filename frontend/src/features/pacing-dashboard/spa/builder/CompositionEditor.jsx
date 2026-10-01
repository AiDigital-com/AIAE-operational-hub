import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ConfirmModal from '../ConfirmModal.jsx';
import { ContextualSwitchDialog } from './ContextualSwitch.jsx';
import { switchableKpiForAtom } from './contextual-switch.js';
import ElementPicker from './ElementPicker.jsx';
import useCompositionDrag from './useCompositionDrag.js';
import { compositionGripPlacement, intersectGripRects } from './composition-grip.js';
import { canWrapSelection, reconcileCompositionSelection, selectCompositionElement, singleSelection } from './composition-selection.js';
import { LIMITS } from '../report-v2.js';
import ChartCard from './ChartCard.jsx';
import CompareCard from './CompareCard.jsx';
import KpiCard from './KpiCard.jsx';
import PieCard from './PieCard.jsx';
import TableCard from './TableCard.jsx';
import {
  BadgeEditor, BlockEditor, UnknownFields,
} from './LayoutCard.jsx';
import {
  LAYOUT_BLOCK_LABELS, LAYOUT_NOTE_LABELS, convertLayoutBlock,
} from './layout-model.js';
import {
  addCompositionNode, cloneCompositionNode, compositionAddChoices,
  compositionChildren, compositionPath, duplicateCompositionNode,
  findCompositionNode, freshCompositionNode, moveCompositionNode, expandCompositionRecipe,
  patchCompositionNode, relocateCompositionNode, removeCompositionNode,
  wrapCompositionNodes, unwrapCompositionNode, compositionInsertPosition, dropCompositionNode, compositionWidth, commitAtomSwitch,
} from './composition-model.js';
import './CompositionEditor.css';

const VIEW_CARDS = {
  __proto__: null,
  chart: ChartCard,
  table: TableCard,
  kpi: KpiCard,
  pie: PieCard,
  compare: CompareCard,
};
const VIEW_LABELS = {
  __proto__: null,
  chart: 'Chart', table: 'Table', kpi: 'KPI', pie: 'Pie', compare: 'Compare',
};
const CONTAINER_KEYS = ['id', 'kind', 'title', 'direction', 'distribution', 'frame', 'children', 'span', 'gap', 'sub', 'badge', 'hideSubtitle', 'hideBadge'];
const ATOM_KEYS = ['id', 'kind', 'brick', 'span'];
const FRAME_OPTIONS = [['none', 'No frame'], ['card', 'Card'], ['signal', 'Signal panel']];
const EMPTY_ENV = { dims: [], mappings: null, sourceFacts: null, scopeOptions: null };

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function baseNodeLabel(node, rootId) {
  if (!node) return 'Widget content';
  if (node.id === rootId) return 'Widget content';
  if (node.kind === 'container') return node.title || (node.direction === 'row' ? 'Across' : 'Stack');
  if (node.kind === 'atom') {
    const brick = node.brick || {};
    return brick.label || brick.text || (brick.type === 'statRow' ? brick.cells?.map((cell) => cell.label).filter(Boolean).join(' · ') : '')
      || LAYOUT_NOTE_LABELS[brick.source]
      || ({ planRate: 'Plan rates', bidPair: 'Bid plan vs fact', earned: 'Earned at plan', dynamic: 'Dynamic rates' })[brick.series || brick.source]
      || LAYOUT_BLOCK_LABELS[brick.type] || brick.type || 'Element';
  }
  return node.title || VIEW_LABELS[node.kind] || node.kind || 'Element';
}

function nodeLabel(node, rootId, tree) {
  const label = baseNodeLabel(node, rootId);
  if (!tree || !node || node.id === rootId) return label;
  const parent = compositionPath(tree, node.id).at(-2);
  const peers = compositionChildren(parent).filter((item) => baseNodeLabel(item, rootId) === label);
  return peers.length > 1 ? `${label} ${peers.findIndex((item) => item.id === node.id) + 1}` : label;
}

function nodeKind(node, rootId) {
  if (node?.id === rootId) return 'Widget';
  if (node?.kind === 'container') return 'Container';
  if (node?.kind === 'atom') return LAYOUT_BLOCK_LABELS[node.brick?.type] || 'Element';
  return VIEW_LABELS[node?.kind] || node?.kind || 'Element';
}

function patchFields(value, fields) {
  const out = { ...(isObj(value) ? value : {}) };
  for (const [key, field] of Object.entries(fields)) {
    if (field === undefined) delete out[key];
    else out[key] = field;
  }
  return out;
}

function Field({ label, children }) {
  return (
    <label className="sp-comp-field">
      <span>{label}</span>
      {isValidElement(children) ? cloneElement(children, { 'aria-label': children.props['aria-label'] || label }) : children}
    </label>
  );
}

function SpanField({ node, parent, onChange }) {
  if (parent?.direction !== 'row' || parent.distribution === 'content') return null;
  const weight = node.span || 1;
  const known = Number.isInteger(weight) && weight >= 1 && weight <= 12;
  return <Field label="Width in row">
    <select className="sp-inp sp-inp--sans" value={weight} onChange={(event) => onChange(Number(event.target.value))}>
      {!known && <option value={weight}>{`Custom ratio · ${compositionWidth(node, parent)}%`}</option>}
      {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>
        {`${index + 1} part${index ? 's' : ''} · ${compositionWidth(node, parent, index + 1)}%`}
      </option>)}
    </select>
  </Field>;
}

function StructureNode({ node, rootId, root, parent, selectedId, selectedIds, onSelect, checkedIds = [], selecting = false, onCheck, drag, onDragStart }) {
  const children = compositionChildren(node);
  const container = node?.kind === 'container';
  const [expanded, setExpanded] = useState(node.id === rootId || children.some((child) => child.kind === 'container'));
  useEffect(() => {
    if (node.id !== selectedId && findCompositionNode(node, selectedId)) setExpanded(true);
  }, [node, selectedId]);
  useEffect(() => {
    if (container && node.id === selectedId) setExpanded(true);
  }, [container, node.id, selectedId]);
  const baseLabel = nodeLabel(node, rootId);
  const peers = compositionChildren(parent).filter((entry) => nodeLabel(entry, rootId) === baseLabel);
  const label = peers.length > 1 ? `${baseLabel} ${peers.findIndex((entry) => entry.id === node.id) + 1}` : baseLabel;
  const drop = drag?.targetId === node.id ? drag.placement : null;
  const kind = nodeKind(node, rootId);
  return (
    <li className={`sp-comp-tree-node${container ? ' sp-comp-tree-node--container' : ''}`}>
      <div className={`sp-comp-node-row${drop ? ` sp-comp-drop--${drop}` : ''}${drag?.nodeId === node.id ? ' sp-comp-node-row--dragging' : ''}`} data-composition-drop={node.id}>
        {node.id !== rootId && <button type="button" className="sp-comp-grip" aria-label={`Drag ${label}`} onPointerDown={(event) => onDragStart(event, node.id)} title="Drag to move">⠿</button>}
        {selecting && node.id !== rootId && <input type="checkbox" className="sp-comp-select" aria-label={`Select ${label}`} checked={checkedIds.includes(node.id)} onChange={() => onCheck(node.id)} />}
        {container && children.length ? <button type="button" className="sp-comp-disclosure"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`} aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}>{expanded ? '⌄' : '›'}</button> : <span className="sp-comp-disclosure-space" />}
        <button type="button"
          className={`sp-comp-node${selectedIds.includes(node.id) ? ' sp-comp-node--selected' : ''}`}
          aria-current={selectedId === node.id ? 'true' : undefined}
          data-composition-outline={node.id} title={`${label} · ${kind}`}
          onClick={(event) => { if (container) setExpanded(true); onSelect(node.id, { additive: event.ctrlKey || event.metaKey }); }}>
          <b>{label}</b>
          {kind !== label && <span className="sp-comp-node-kind">{kind}</span>}
          {container && !expanded ? <span>{children.length}</span>
            : parent?.direction === 'row' && parent.distribution !== 'content' ? <span>{`${compositionWidth(node, parent)}%`}</span> : null}
        </button>
      </div>
      {container && children.length ? <ol hidden={!expanded} className="sp-comp-children">
        {children.map((child) => <StructureNode key={child.id} node={child} rootId={rootId}
          root={root} parent={node} selectedId={selectedId} selectedIds={selectedIds} onSelect={onSelect} checkedIds={checkedIds} selecting={selecting} onCheck={onCheck} drag={drag} onDragStart={onDragStart} />)}
      </ol> : null}
    </li>
  );
}

// Keep the grip beside its element in screen pixels. The overlay sits outside the
// widget's clipping frame, so edge cards retain both their real layout and a full hit area.
export function visibleTextRects(root, bounds) {
  const doc = root?.ownerDocument;
  if (!doc?.createRange || !doc.createTreeWalker) return [];
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(root, showText);
  const rects = [];
  const clips = new Map([[root, bounds]]);
  const clipFor = (element) => {
    if (!element) return bounds;
    if (clips.has(element)) return clips.get(element);
    let clip = clipFor(element.parentElement);
    if (clip) {
      const style = doc.defaultView?.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) clip = null;
      else if (style && ['hidden', 'clip', 'auto', 'scroll'].some((value) => (
        style.overflow === value || style.overflowX === value || style.overflowY === value
      ))) clip = intersectGripRects(clip, element.getBoundingClientRect());
    }
    clips.set(element, clip);
    return clip;
  };
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.nodeValue?.trim() || !text.parentElement) continue;
    const clip = clipFor(text.parentElement);
    if (!clip) continue;
    const range = doc.createRange();
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) {
      const visible = intersectGripRects(rect, clip);
      if (visible) rects.push(visible);
    }
    range.detach?.();
  }
  return rects;
}

function PreviewGrip({ canvas, stage, viewport, scale, editor }) {
  const [position, setPosition] = useState(null);
  const movable = editor && editor.selectedId !== editor.rootId && !(editor.selectedIds?.length > 1);
  const dragging = !!editor?.drag;
  const measure = useCallback(() => {
    if (dragging) return;
    const node = movable ? [...(canvas.current?.querySelectorAll('[data-composition-node]') || [])]
      .find((element) => element.dataset.compositionNode === editor.selectedId) : null;
    let next = null;
    if (node?.getClientRects().length && stage.current?.getClientRects().length && viewport.current?.getClientRects().length) {
      const box = node.getBoundingClientRect(), origin = stage.current.getBoundingClientRect();
      const viewportBox = viewport.current.getBoundingClientRect();
      const bounds = {
        left: viewportBox.left + viewport.current.clientLeft,
        top: viewportBox.top + viewport.current.clientTop,
        right: viewportBox.left + viewport.current.clientLeft + viewport.current.clientWidth,
        bottom: viewportBox.top + viewport.current.clientTop + viewport.current.clientHeight,
      };
      const choice = compositionGripPlacement({ x: box.right, y: box.top }, visibleTextRects(canvas.current, bounds), bounds);
      next = { left: box.right - origin.left + choice.dx, top: box.top - origin.top + choice.dy };
    }
    setPosition((old) => old?.left === next?.left && old?.top === next?.top ? old : next);
  }, [canvas, stage, viewport, scale, movable, dragging, editor?.selectedId]);
  useLayoutEffect(measure, [measure]);
  useEffect(() => {
    const element = viewport.current;
    const win = element?.ownerDocument?.defaultView;
    if (!element || !canvas.current || !win?.requestAnimationFrame) return;
    let frame = 0;
    // Text, width and scroll changes can arrive together. Measure once per frame,
    // including style-only arrangement edits that leave the canvas size unchanged.
    const schedule = () => {
      if (frame) return;
      frame = win.requestAnimationFrame(() => { frame = 0; measure(); });
    };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    for (const node of [canvas.current, stage.current, element]) if (node) resize?.observe(node);
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    mutation?.observe(canvas.current, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    element.addEventListener('scroll', schedule, { passive: true });
    return () => {
      resize?.disconnect(); mutation?.disconnect();
      element.removeEventListener('scroll', schedule);
      if (frame) win.cancelAnimationFrame(frame);
    };
  }, [canvas, stage, viewport, measure]);
  if (!movable || !position) return null;
  return <button type="button" className="rpt-composition-grip" data-composition-grip={editor.selectedId}
    style={position} aria-label={`Drag ${editor.selectedLabel} in preview`} title="Drag to move"
    aria-description="Drag to move. Activate with the keyboard to open element settings and placement controls."
    onClick={(event) => { event.stopPropagation(); if (event.detail === 0) editor.onInspect?.(); }}
    onPointerDown={(event) => editor.onDragStart?.(event, editor.selectedId)}><span aria-hidden="true">⠿</span></button>;
}

export function CompositionPreview({ renderPreview, editor, expanded, onExpand }) {
  const viewport = useRef(null);
  const canvas = useRef(null);
  const stage = useRef(null);
  const [mode, setMode] = useState('fit');
  const [size, setSize] = useState({ width: 680, height: 0, narrow: false });
  useEffect(() => {
    if (!viewport.current || !canvas.current || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      if (!viewport.current.clientWidth) return;
      const styles = getComputedStyle(viewport.current);
      const next = { width: viewport.current.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight), height: canvas.current.offsetHeight,
        narrow: (viewport.current.closest('.sp-comp')?.clientWidth || 680) < 680 };
      setSize((old) => old.width === next.width && old.height === next.height && old.narrow === next.narrow ? old : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current); observer.observe(canvas.current); measure();
    return () => observer.disconnect();
  }, []);
  const canvasWidth = size.narrow ? Math.max(1, size.width) : 680;
  const scale = !size.narrow && mode === 'fit' ? Math.min(1, size.width / canvasWidth) : 1;
  const multiple = editor?.selectedIds?.length > 1;
  const label = multiple ? `${editor.selectedIds.length} elements selected` : editor?.selectedLabel || 'Widget content';
  return <section className={`sp-comp-preview${expanded ? ' sp-comp-preview--expanded' : ''}`}>
    <div className="sp-comp-section-head">
      <div><b>Preview</b></div>
      <div className="sp-comp-preview-actions" role="group" aria-label="Preview size">
        {!size.narrow && ['fit', 'actual'].map((value) => <button type="button" key={value} className="sp-comp-expand"
          aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'fit' ? 'Fit' : '100%'}</button>)}
        <button type="button" className="sp-comp-expand" aria-pressed={expanded} onClick={onExpand}>{expanded ? 'Collapse' : 'Expand'}</button>
      </div>
    </div>
    {editor && <div className="sp-comp-preview-selection" role="group" aria-label="Preview selection"
      data-preview-selection={multiple ? undefined : editor.selectedId}>
      <span>{label}</span>
      <button type="button" className="sp-comp-preview-edit" aria-label={multiple ? 'Edit selection' : `Edit ${label}`}
        onClick={() => editor.onInspect?.()}><i className="ri-edit-line" aria-hidden="true" /> Edit</button>
    </div>}
    <div ref={viewport} className="sp-comp-preview-scroll">
      <div ref={stage} className="sp-comp-preview-stage" style={{ width: canvasWidth * scale, height: size.height ? size.height * scale : undefined }}>
        <div ref={canvas} className="wgf-preview" style={{ width: canvasWidth, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {renderPreview(editor)}
        </div>
        <PreviewGrip canvas={canvas} stage={stage} viewport={viewport} scale={scale} editor={editor} />
      </div>
    </div>
  </section>;
}

function ContainerInspector({ node, root, parent, widget, formulaPreview, onChange, onInvalid }) {
  const set = (fields) => onChange(patchFields(node, fields));
  const direction = node.direction === 'row' || node.direction === 'column' ? node.direction : String(node.direction || '');
  const frame = FRAME_OPTIONS.some(([value]) => value === node.frame) ? node.frame : String(node.frame || '');
  const subPresent = hasOwn(node, 'sub');
  const [subEnabled, setSubEnabled] = useState(subPresent && !node.hideSubtitle);
  const gap = node.gap == null ? 'auto' : String(node.gap);
  const appearance = [FRAME_OPTIONS.find(([value]) => value === frame)?.[1] || frame || 'No frame'];
  if (subPresent && !node.hideSubtitle) appearance.push('supporting text');
  if (hasOwn(node, 'badge') && !node.hideBadge) appearance.push('badge');
  return (
    <div className="sp-comp-form">
      <Field label="Title">
        <input
          className="sp-inp sp-inp--sans"
          value={node.title || ''}
          maxLength={LIMITS.title}
          placeholder={root ? 'Optional Widget heading' : 'Optional title'}
          onChange={(event) => set({ title: event.target.value.slice(0, LIMITS.title) })}
        />
      </Field>
      <Field label="Arrange children">
        <select
          className="sp-inp sp-inp--sans"
          value={direction}
          onChange={(event) => set({ direction: event.target.value, distribution: event.target.value === 'row' ? node.distribution : undefined })}
        >
          {direction !== 'row' && direction !== 'column' ? <option value={direction}>{`Stored value: ${direction || 'missing'}`}</option> : null}
          <option value="row">Across</option>
          <option value="column">Top to bottom</option>
        </select>
      </Field>
      {direction === 'row' && <Field label="Column widths">
        <select className="sp-inp sp-inp--sans" aria-label="Column widths" value={node.distribution || 'relative'}
          onChange={(event) => set({ distribution: event.target.value === 'content' ? 'content' : undefined })}>
          <option value="relative">Relative shares</option>
          <option value="content">Fit content</option>
        </select>
      </Field>}
      <Field label="Spacing">
        <select className="sp-inp sp-inp--sans" value={gap} onChange={(event) => set({ gap: event.target.value === 'auto' ? undefined : event.target.value })}>
          {!['auto', 'tight', 'compact', 'normal', 'relaxed'].includes(gap) ? <option value={gap}>{`Stored value: ${gap}`}</option> : null}
          <option value="auto">Automatic</option>
          <option value="tight">Tight</option>
          <option value="compact">Compact</option>
          <option value="normal">Normal</option>
          <option value="relaxed">Relaxed</option>
        </select>
      </Field>
      <details className="sp-comp-appearance">
        <summary>{`Appearance · ${appearance.join(' · ')}`}</summary>
        <div className="sp-comp-appearance-body">
          <Field label="Frame">
            <select
              className="sp-inp sp-inp--sans"
              value={frame}
              onChange={(event) => set({ frame: event.target.value })}
            >
              {!FRAME_OPTIONS.some(([value]) => value === frame) ? <option value={frame}>{`Stored value: ${frame || 'missing'}`}</option> : null}
              {FRAME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <div className="sp-comp-field">
            <label className="sp-comp-present">
              <input type="checkbox" checked={subEnabled} onChange={(event) => {
                setSubEnabled(event.target.checked);
                if (node.sub) set({ hideSubtitle: event.target.checked ? undefined : true });
                else if (subPresent) set({ sub: undefined, hideSubtitle: undefined });
              }} />
              Supporting text
            </label>
            {subEnabled ? (
              <input
                className="sp-inp sp-inp--sans"
                aria-label="Supporting text"
                value={node.sub || ''}
                maxLength={LIMITS.support}
                placeholder="Optional"
                onChange={(event) => set(event.target.value ? { sub: event.target.value, hideSubtitle: undefined } : { sub: undefined, hideSubtitle: undefined })}
              />
            ) : null}
          </div>
          <BadgeEditor
            col={node}
            widget={widget}
            formulaPreview={formulaPreview}
            viewId={node.id}
            allowHide
            invalidKey={`container:${node.id}`}
            onInvalid={onInvalid}
            onFields={set}
          />

        </div>
      </details>
      <UnknownFields
        value={node}
        knownKeys={CONTAINER_KEYS}
        label={root ? 'Widget content' : 'Container'}
        invalidKey={`container:${node.id}:extra`}
        onInvalid={onInvalid}
        onChange={onChange}
      />
    </div>
  );
}

function AtomInspector({ node, parent, spec, widget, formulaPreview, onChange, onInvalid, onAskRetype }) {
  const type = node.brick?.type || '';
  return (
    <div className="sp-comp-form">
      <BlockEditor
        block={node.brick}
        spec={spec}
        widget={widget}
        formulaPreview={formulaPreview}
        viewId={node.id}
        path={node.id}
        onInvalid={onInvalid}
        onChange={(brick) => onChange({ ...node, brick })}
      />
      <details className="sp-comp-appearance sp-comp-change-type"><summary>Change display type</summary><div className="sp-comp-appearance-body">
      <Field label="Element type">
        <select
          className="sp-inp sp-inp--sans"
          value={type}
          onChange={(event) => onAskRetype(event.target.value)}
        >
          {!hasOwn(LAYOUT_BLOCK_LABELS, type) ? <option value={type}>{`Stored type: ${type || 'missing'}`}</option> : null}
          {Object.entries(LAYOUT_BLOCK_LABELS).map(([type, label]) => (
            <option key={type} value={type}>{label}</option>
          ))}
        </select>
      </Field>
      </div></details>
      <UnknownFields
        value={node}
        knownKeys={ATOM_KEYS}
        label="Element"
        invalidKey={`atom:${node.id}:extra`}
        onInvalid={onInvalid}
        onChange={onChange}
      />
    </div>
  );
}

function descendantsOf(node, into = new Set()) {
  for (const child of compositionChildren(node)) {
    into.add(child.id);
    descendantsOf(child, into);
  }
  return into;
}

function containersOf(node, into = []) {
  if (node?.kind === 'container') into.push(node);
  for (const child of compositionChildren(node)) containersOf(child, into);
  return into;
}

export default function CompositionEditor({
  view, spec, widget, env = EMPTY_ENV, patch, onRemoveControl, onDraftInvalid, renderPreview, formulaPreview, historyRevision = 0, historyGuardRef, onHistoryBoundary, selectionRequest,
}) {
  const [selection, setSelection] = useState(() => singleSelection(view.id));
  const selectedId = selection.activeId;
  const selectionKey = selection.ids.join(':');
  useEffect(() => { onHistoryBoundary?.(); }, [selectedId, selectionKey, onHistoryBoundary]);
  const setSelectedId = useCallback((id) => setSelection(singleSelection(id)), []);
  const [atomSwitch, setAtomSwitch] = useState(null);
  const atomSwitchAnchor = useRef(null);
  const [adding, setAdding] = useState(null);
  const [selecting, setSelecting] = useState(false);
  const checkedIds = selection.ids.filter((id) => id !== view.id);
  const multiple = selection.ids.length > 1;
  const structureRef = useRef(null);
  const composerRef = useRef(null);
  const [narrow, setNarrow] = useState(false);
  const [ask, setAsk] = useState(null);
  const [notice, setNotice] = useState('');
  const [dragMessage, setDragMessage] = useState('');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [pane, setPane] = useState('structure');
  const inspectorHeading = useRef(null);
  const invalid = useRef(new Set());
  const inspectorRef = useRef(null);
  const connectionFocus = useRef(null);

  const selected = findCompositionNode(view, selectedId) || view;
  const path = compositionPath(view, selected.id);
  const parent = path.length > 1 ? path[path.length - 2] : null;
  const siblings = parent ? compositionChildren(parent) : [view];
  const selectedIndex = siblings.findIndex((node) => node.id === selected.id);
  const root = selected.id === view.id;

  const markInvalid = useCallback((key, bad) => {
    if (bad) invalid.current.add(key);
    else invalid.current.delete(key);
    onDraftInvalid?.(invalid.current.size > 0);
  }, [onDraftInvalid]);
  useEffect(() => () => onDraftInvalid?.(false), [onDraftInvalid]);
  useEffect(() => {
    setSelection((old) => reconcileCompositionSelection(view, old));
  }, [view]);

  const leaveInspector = useCallback((action) => {
    // Layout/Atom FormulaField writes every raw keystroke into the Widget draft. Its syntax
    // guard can therefore unmount safely: the report validator still sees and blocks the bad
    // expression. Unknown-field JSON and Spotlight drafts remain local and must ask first.
    const localOnly = [...invalid.current].filter((key) => !key.endsWith(':formula'));
    if (!localOnly.length) { action(); return; }
    setAsk({
      title: 'Leave this unfinished field?',
      message: 'The selected element contains unfinished text. Leaving it can close that editor and discard text that has not reached the Widget draft.',
      confirmLabel: 'Leave field',
      onConfirm: () => {
        invalid.current.clear();
        onDraftInvalid?.(false);
        setAsk(null);
        action();
      },
    });
  }, [onDraftInvalid]);

  if (historyGuardRef) historyGuardRef.current = leaveInspector;
  useEffect(() => {
    setAdding(null); setAsk(null); setAtomSwitch(null); setNotice(''); setSelecting(false);
    setSelection((old) => singleSelection(old.activeId));
  }, [historyRevision]);
  useEffect(() => {
    if (!composerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 680));
    observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, []);

  const select = useCallback((id, { additive = false, surface = 'structure', elementId } = {}) => {
    const apply = () => {
      connectionFocus.current = surface === 'connection' ? { id, elementId } : null;
      setNotice('');
      setSelection((old) => selectCompositionElement(view, old, id, additive));
      setSelecting(additive);
      if (surface !== 'preview' || !narrow) setPane('settings');
    };
    if (id === selectedId && !additive && !multiple) apply();
    else leaveInspector(apply);
  }, [leaveInspector, selectedId, multiple, view, narrow]);
  const handledRequest = useRef(null);
  useEffect(() => {
    if (!selectionRequest || handledRequest.current === selectionRequest.token) return;
    handledRequest.current = selectionRequest.token;
    const id = findCompositionNode(view, selectionRequest.elementId)?.id
      || findCompositionNode(view, selectionRequest.viewId)?.id;
    if (id) select(id, { surface: 'connection', elementId: selectionRequest.elementId });
  }, [selectionRequest, select, view]);
  const patchNode = useCallback((id, next) => patch((current) => (
    patchCompositionNode(current, view.id, id, () => next)
  )), [patch, view.id]);

  const allContainers = useMemo(() => containersOf(view), [view]);
  const excludedTargets = useMemo(() => descendantsOf(selected, new Set([selected.id])), [selected]);
  const moveTargets = allContainers.filter((node) => !excludedTargets.has(node.id));
  const choices = useMemo(() => compositionAddChoices(widget, env), [widget, env]);
  const openAdd = (placement = selected.kind === 'container' ? 'inside' : 'after') => leaveInspector(() => {
    setAdding({ targetId: selected.id, placement });
  });
  const toggleChecked = (id) => {
    if (id === view.id) return;
    select(id, { additive: true, surface: 'preview' });
  };
  const wrapSelected = () => leaveInspector(() => {
    const ids = checkedIds.length ? checkedIds : [selected.id];
    const next = wrapCompositionNodes(spec, view.id, ids);
    if (next === spec) { setNotice('These elements cannot fit in another container or their widths are too small to preserve. Adjust widths or reduce nesting.'); return; }
    const oldIds = new Set(allContainers.map((node) => node.id));
    const wrapper = containersOf(next.views[0]).find((node) => !oldIds.has(node.id));
    patch((current) => wrapCompositionNodes(current, view.id, ids));
    setSelecting(false); setSelectedId(wrapper.id);
    setNotice('');
  });
  const unwrapSelected = () => leaveInspector(() => {
    const perform = () => {
      const next = unwrapCompositionNode(spec, view.id, selected.id);
      if (next === spec) { setNotice('The parent container has no room, or these widths are too small to preserve. Adjust widths or move an element first.'); return; }
      patch((current) => unwrapCompositionNode(current, view.id, selected.id));
      setSelectedId(selected.children[0]?.id || parent.id); setAsk(null); setNotice('');
    };
    const changesArrangement = selected.children.length > 1 && selected.direction !== parent.direction;
    if (changesArrangement || selected.title || selected.sub || selected.badge || selected.frame !== 'none') setAsk({
      title: 'Remove container and keep contents?', message: `Its elements stay. The container’s title, frame, supporting text and badge are removed.${changesArrangement ? ` Elements will be arranged ${parent.direction === 'row' ? 'across the parent row' : 'in the parent column'}.` : ''}`, confirmLabel: 'Keep contents', onConfirm: perform,
    }); else perform();
  });
  const { drag, start: startDrag } = useCompositionDrag({ hostRef: composerRef, spec, view, onNotice: setDragMessage,
    onDrop: (nodeId, targetId, placement) => leaveInspector(() => {
      patch((current) => dropCompositionNode(current, view.id, nodeId, targetId, placement));
      setSelectedId(nodeId); setSelecting(false); setNotice(''); setDragMessage('Element moved.');
    }),
  });
  const beginDrag = (event, nodeId) => {
    setDragMessage('');
    if (multiple) { setSelectedId(nodeId); setSelecting(false); }
    startDrag(event, nodeId);
  };

  const addChoice = (choice, opts = choice.opts) => {
    const position = compositionInsertPosition(view, adding?.targetId || selected.id, adding?.placement || 'inside');
    if (!position) return;
    const fresh = freshCompositionNode(choice.kind, spec, opts);
    const trial = addCompositionNode(spec, view.id, position.parentId, choice.kind, position.index, opts);
    if (trial === spec) {
      setAdding(null);
      setNotice('This element does not fit here. Remove an element or reduce the nesting first.');
      return;
    }
    setNotice('');
    patch((current) => addCompositionNode(current, view.id, position.parentId, choice.kind, position.index, opts));
    setAdding(null);
    setSelectedId(fresh.id);
    setPane('settings');
  };

  const moveSelected = (direction) => patch((current) => (
    moveCompositionNode(current, view.id, selected.id, direction)
  ));
  const duplicateSelected = () => {
    if (root || !parent) return;
    leaveInspector(() => {
      const clone = cloneCompositionNode(selected, spec);
      const trial = addCompositionNode(spec, view.id, parent.id, clone, selectedIndex + 1);
      if (trial === spec) {
        setNotice('This copy does not fit here. Remove an element or reduce the nesting first.');
        return;
      }
      setNotice('');
      patch((current) => duplicateCompositionNode(current, view.id, selected.id));
      setSelectedId(clone.id);
      setPane('settings');
    });
  };
  const removeSelected = () => {
    if (root || !parent) return;
    leaveInspector(() => setAsk({
      title: 'Remove this element?',
      message: `“${nodeLabel(selected, view.id, view)}” and everything inside it leave this Widget. Nothing is stored until you press Save.`,
      confirmLabel: 'Remove',
      onConfirm: () => {
        patch((current) => removeCompositionNode(current, view.id, selected.id));
        setSelectedId(parent.id);
        setAsk(null);
      },
    }));
  };
  const askRetype = (type) => {
    if (type === selected.brick?.type) return;
    leaveInspector(() => {
      const converted = convertLayoutBlock(selected.brick, type, spec);
      const apply = () => {
        patchNode(selected.id, { ...selected, brick: converted.brick }); setAsk(null);
        setNotice(converted.needsTarget ? 'Choose a target for this element.' : '');
      };
      if (!converted.incompatible.length) { apply(); return; }
      setAsk({ title: 'Change this element?',
        message: `${LAYOUT_BLOCK_LABELS[type] || type} keeps compatible settings. It cannot use: ${converted.incompatible.map((field) => field.label).join(', ')}. You can undo this change.`,
        confirmLabel: 'Change element', onConfirm: apply });
    });
  };

  useEffect(() => {
    if (pane === 'settings' && narrow) {
      inspectorHeading.current?.focus({ preventScroll: true });
    }
  }, [selected.id, pane, narrow]);

  // Resolve only after the selected inspector has committed. Scheduling a frame
  // from the selection event can still see the previous inspector's rows.
  useEffect(() => {
    const request = connectionFocus.current;
    if (!request || selected.id !== request.id || !inspectorRef.current) return;
    connectionFocus.current = null;
    const row = [...inspectorRef.current.querySelectorAll('[data-content-id]')]
      .find((button) => button.dataset.contentId === request.elementId);
    const target = row || inspectorHeading.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });

  const inspectSelected = () => {
    setPane('settings');
    requestAnimationFrame(() => {
      inspectorHeading.current?.focus({ preventScroll: true });
      inspectorHeading.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };

  useEffect(() => {
    if (!composerRef.current || typeof requestAnimationFrame !== 'function') return;
    const frame = requestAnimationFrame(() => {
      const reveal = (host, target) => {
        if (!host || !target || !host.getClientRects().length || !target.getClientRects().length) return;
        const box = host.getBoundingClientRect(), item = target.getBoundingClientRect();
        if (item.top < box.top) host.scrollTop -= box.top - item.top + 4;
        else if (item.bottom > box.bottom) host.scrollTop += Math.min(item.top - box.top, item.bottom - box.bottom) + 4;
        if (item.left < box.left) host.scrollLeft -= box.left - item.left + 4;
        else if (item.right > box.right) host.scrollLeft += Math.min(item.left - box.left, item.right - box.right) + 4;
      };
      const host = composerRef.current;
      reveal(structureRef.current, [...host.querySelectorAll('[data-composition-outline]')].find((node) => node.dataset.compositionOutline === selected.id));
      reveal(host.querySelector('.sp-comp-preview-scroll'), [...host.querySelectorAll('[data-composition-node]')].find((node) => node.dataset.compositionNode === selected.id));
    });
    return () => cancelAnimationFrame(frame);
  }, [selected.id]);

  const Card = VIEW_CARDS[selected.kind] || null;
  const switchableAtom = selected.kind === 'atom' ? switchableKpiForAtom(selected) : null;
  const previewHandlers = useRef(null);
  previewHandlers.current = { select, inspectSelected, beginDrag };
  const previewEditor = useMemo(() => ({
    selectedId: selected.id, selectedIds: selection.ids,
    selectedLabel: nodeLabel(selected, view.id, view), rootId: view.id,
    labelFor: (node) => nodeLabel(node, view.id, view),
    onSelect: (id, options) => previewHandlers.current.select(id, { ...options, surface: 'preview' }),
    onInspect: () => previewHandlers.current.inspectSelected(),
    onDragStart: (event, id) => previewHandlers.current.beginDrag(event, id),
    drag,
  }), [selected, selection.ids, view, drag]);
  const switchSpec = atomSwitch ? patchCompositionNode(spec, view.id, atomSwitch.original.id, () => atomSwitch.converted) : null;
  return (
    <div ref={composerRef} className={`sp-comp sp-comp--${pane}${previewExpanded ? ' sp-comp--expanded' : ''}`}>
      <div className="sp-comp-pane-switch" role="group" aria-label="Editor panels">
        {[['structure', 'Structure'], ['preview', 'Preview'], ['settings', 'Settings']].map(([value, label]) => (
          <button type="button" key={value} aria-pressed={pane === value} onClick={() => setPane(value)}>{label}</button>
        ))}
      </div>
      {notice ? <div className="sp-comp-notice" role="status">{notice}</div> : null}
      <div className="sr-only" role="status">{dragMessage}</div>
      <div className="sp-comp-main">
        <section ref={structureRef} className="sp-comp-structure" aria-label="Widget structure">
          <div className="sp-comp-section-head">
            <div>
              <b>Structure</b>
              <span>{`${compositionChildren(view).length} top-level element${compositionChildren(view).length === 1 ? '' : 's'}`}</span>
            </div>
            <button type="button" className="wgf-add" onClick={() => openAdd()}>
              + Add element
            </button>
          </div>
          <div className="sp-comp-tree-tools">
            <button type="button" className="sp-comp-text-button" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); }}>{selecting ? 'Done selecting' : 'Select elements'}</button>
            {multiple && <span className="sp-comp-selection-count">{`${checkedIds.length} selected`}</span>}
          </div>
          {compositionChildren(view).length ? (
            <ol className="sp-comp-tree">
              <StructureNode
                node={view}
                rootId={view.id}
                selectedId={selected.id}
                selectedIds={selection.ids}
                onSelect={select}
                root={view} checkedIds={checkedIds} selecting={selecting} onCheck={toggleChecked} drag={drag} onDragStart={beginDrag}
              />
            </ol>
          ) : (
            <button type="button" className="sp-comp-empty" onClick={() => openAdd()}>
              <i className="ri-add-circle-line" aria-hidden="true" />
              <b>Add the first element</b>
              <span>Choose a container, chart, table, KPI or smaller content element.</span>
            </button>
          )}
        </section>

        <div className="sp-comp-workspace">
          {renderPreview ? (
            <CompositionPreview renderPreview={renderPreview}
              editor={previewEditor}
              expanded={previewExpanded} onExpand={() => setPreviewExpanded((value) => !value)} />
          ) : null}

        <section ref={inspectorRef} className="sp-comp-inspector" data-selected-node={selected.id} aria-label="Selected element settings">
          {multiple ? <div className="sp-comp-multiple">
            <div className="sp-comp-inspector-head"><b ref={inspectorHeading} tabIndex={-1}>{`${selection.ids.length} elements selected`}</b></div>
            <div className="sp-comp-selection-list">{selection.ids.map((id) => {
              const node = findCompositionNode(view, id);
              return <button key={id} type="button" onClick={() => select(id)}>
                <b>{nodeLabel(node, view.id, view)}</b>
                <span>{compositionPath(view, id).slice(0, -1).map((entry) => nodeLabel(entry, view.id, view)).join(' / ')}</span>
              </button>;
            })}</div>
            <button type="button" className="sp-comp-text-button" disabled={!canWrapSelection(view, selection.ids)} onClick={wrapSelected}>{`Wrap ${selection.ids.length} in container`}</button>
            {!canWrapSelection(view, selection.ids) && <p className="sp-comp-selection-hint">To share a container, select elements with the same parent.</p>}
          </div> : <>
          <nav className="sp-comp-crumbs" aria-label="Selected element path">
            {path.map((node, index) => (
              <span key={node.id}>
                {index ? <i aria-hidden="true">›</i> : null}
                <button type="button" onClick={() => select(node.id)}>{nodeLabel(node, view.id, view)}</button>
              </span>
            ))}
          </nav>
          <div className="sp-comp-inspector-head">
            <div>
              {nodeKind(selected, view.id) !== nodeLabel(selected, view.id, view) && <span>{nodeKind(selected, view.id)}</span>}
              <b ref={inspectorHeading} tabIndex={-1}>{nodeLabel(selected, view.id, view)}</b>
            </div>
            {!root ? (
              <div className="sp-comp-actions">
                <button type="button" className="sp-rb-btn" aria-label={`Move selected element ${parent?.direction === 'row' ? 'left' : 'up'}`} aria-disabled={selectedIndex <= 0 ? true : undefined} onClick={() => { if (selectedIndex > 0) moveSelected(-1); }}>{parent?.direction === 'row' ? '◀' : '▲'}</button>
                <button type="button" className="sp-rb-btn" aria-label={`Move selected element ${parent?.direction === 'row' ? 'right' : 'down'}`} aria-disabled={selectedIndex >= siblings.length - 1 ? true : undefined} onClick={() => { if (selectedIndex < siblings.length - 1) moveSelected(1); }}>{parent?.direction === 'row' ? '▶' : '▼'}</button>
                <button type="button" className="sp-rb-btn" aria-label="Duplicate selected element" onClick={duplicateSelected}><i className="ri-file-copy-line" aria-hidden="true" /></button>
                <button type="button" className="sp-rb-btn sp-rb-btn--rm" aria-label="Remove selected element" onClick={removeSelected}>×</button>
              </div>
            ) : null}
          </div>

          <div className="sp-comp-insert-actions sp-comp-toolbar">
            {selected.kind === 'container' && <button type="button" className="sp-comp-text-button" onClick={() => openAdd('inside')}>+ Add inside</button>}
            {!root && <button type="button" className="sp-comp-text-button" onClick={() => openAdd('after')}>+ Add after</button>}
          {!root && <details className="sp-comp-arrange"><summary>Arrange</summary>
            <div className="sp-comp-arrange-body">
            <SpanField node={selected} parent={parent} onChange={(span) => patchNode(selected.id, patchFields(selected, { span }))} />
            <div className="sp-comp-insert-actions">
              <button type="button" className="sp-comp-text-button" onClick={wrapSelected}>Wrap in container</button>
              {selected.kind === 'container' && <button type="button" className="sp-comp-text-button" onClick={unwrapSelected}>Remove container, keep contents</button>}
            </div>
          {moveTargets.length ? (
            <Field label="Move to">
              <select
                className="sp-inp sp-inp--sans"
                value={parent?.id || ''}
                onChange={(event) => {
                  const targetId = event.target.value;
                  const trial = relocateCompositionNode(spec, view.id, selected.id, targetId);
                  if (trial === spec) {
                    setNotice('This move would exceed the Widget nesting or element limit.');
                    return;
                  }
                  setNotice('');
                  patch((current) => relocateCompositionNode(current, view.id, selected.id, targetId));
                }}
              >
                {moveTargets.map((container) => (
                  <option key={container.id} value={container.id}>
                    {compositionPath(view, container.id).map((node) => nodeLabel(node, view.id, view)).join(' / ')}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
            </div>
          </details>}
          </div>

          {selected.kind === 'container' ? (
            <ContainerInspector
              key={`${selected.id}:${historyRevision}`}
              node={selected}
              root={root}
              parent={parent}
              widget={widget}
              formulaPreview={formulaPreview}
              onInvalid={markInvalid}
              onChange={(next) => patchNode(selected.id, next)}
            />
          ) : null}
          {switchableAtom && <button ref={atomSwitchAnchor} type="button" className="sp-comp-text-button" onClick={() => setAsk({
            title: 'Use a switchable KPI?',
            message: 'The formula and target stay the same. The KPI will display its own comparison and status instead of the current number style.',
            confirmLabel: 'Set up switch', onConfirm: () => { setAsk(null); setAtomSwitch({ original: selected, converted: switchableAtom }); },
          })}>Make value switchable…</button>}
          {selected.kind === 'atom' ? (
            <>
            {selected.brick?.type === 'flightBullet' && <button type="button" className="sp-comp-recipe-button" onClick={() => leaveInspector(() => {
              const trial = expandCompositionRecipe(spec, view.id, selected.id);
              if (trial === spec) { setNotice('This composition needs space for a container and three elements. Stored custom fields must be resolved before expanding.'); return; }
              patch((current) => expandCompositionRecipe(current, view.id, selected.id));
              setNotice('Flight now contains editable text, progress and remaining time.');
            })}><b>Edit elements</b><span>Day · Progress · Remaining time</span></button>}
            <AtomInspector
              key={`${selected.id}:${historyRevision}`}
              node={selected}
              parent={parent}
              spec={spec}
              widget={widget}
              formulaPreview={formulaPreview}
              onInvalid={markInvalid}
              onAskRetype={askRetype}
              onChange={(next) => patchNode(selected.id, next)}
            />
            </>
          ) : null}
          {Card ? (
            <div className="sp-comp-view-inspector">
              <Card
                embedded
                key={`${selected.id}:${historyRevision}`}
                view={selected}
                spec={spec}
                widget={widget}
                formulaPreview={formulaPreview}
                env={env}
                patch={patch}
                first={selectedIndex <= 0}
                last={selectedIndex >= siblings.length - 1}
                onMove={(direction) => moveSelected(direction === 'up' ? -1 : 1)}
                onDropAt={() => {}}
                onRemove={removeSelected}
                onRemoveControl={onRemoveControl}
                onDraftInvalid={(bad) => markInvalid(`view:${selected.id}`, bad)}
              />
            </div>
          ) : null}
          {!Card && selected.kind !== 'container' && selected.kind !== 'atom' ? (
            <div className="sp-comp-form">
              <div className="sp-comp-notice">
                This stored element does not match a Composer type. Its complete JSON remains editable for repair.
              </div>
              <UnknownFields
                key={`${selected.id}:${historyRevision}`}
                value={selected}
                knownKeys={[]}
                label="Stored element"
                invalidKey={`stored:${selected.id}:extra`}
                onInvalid={markInvalid}
                onChange={(next) => patchNode(selected.id, next)}
              />
            </div>
          ) : null}
          </>}
        </section>
        </div>
      </div>

      {adding && <ElementPicker choices={choices}
        destination={`${adding.placement === 'inside' ? 'Inside' : 'After'} ${nodeLabel(findCompositionNode(view, adding.targetId), view.id, view)}`}
        onPick={addChoice} onClose={() => setAdding(null)} />}


      {atomSwitch && <ContextualSwitchDialog widget={{ ...widget, spec: switchSpec }} env={env}
        slot={{ viewId: atomSwitch.original.id, kind: 'value' }} anchorRef={atomSwitchAnchor}
        patch={(mutate) => patch((current) => commitAtomSwitch(current, view.id, atomSwitch.original, atomSwitch.converted, mutate))}
        onClose={() => setAtomSwitch(null)} />}
      {ask ? (
        <ConfirmModal
          title={ask.title}
          message={ask.message}
          confirmLabel={ask.confirmLabel}
          onConfirm={ask.onConfirm}
          onCancel={() => setAsk(null)}
        />
      ) : null}
    </div>
  );
}
