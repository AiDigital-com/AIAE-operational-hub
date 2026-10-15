// workspace/src/pages/Dashboard/components/Settings/Widgets/BlockThumb.jsx
//
// Static schematic thumbnails for the per-pacing gallery (widget-library spec §6):
// a sketch of the block's SHAPE, not a live mount — Journal and the line-item list are
// among the heaviest components in the app, and a row of them behind a settings tab is
// exactly the cost DeferredMount exists to avoid (WidgetGallery.jsx:46-47).
//
// Pure geometry: every shape is a rect in a 120×56 box, coloured by CSS class only
// (design-guard forbids colour literals in JSX, and the sketch has to work in both
// themes — `bar`/`line` are currentColor, so they follow the theme's text tone).
// Nothing here reads data, so nothing here can go stale.
//
// The sketches are meant to be told apart at a glance, so each one owns a
// silhouette no other one uses: ragged paragraph, marker rows, item cards, date
// stamps, one dominant mass, right-aligned amounts, rising line. (The four section
// sketches — gauge strip, two compared columns, tab strip, dense grid — left with
// their blocks in the sections cutover 2026-09-07.)

// [x, y, w, h, class] — class one of: bar (strong), line (soft), accent (tinted).
const SHAPES = {
  // launchPlan — a written recommendation: a title over three ragged text lines.
  launchPlan: [
    [8, 8, 44, 8, 'bar'],
    [8, 24, 104, 5, 'line'],
    [8, 34, 92, 5, 'line'],
    [8, 44, 74, 5, 'line'],
  ],
  // alerts — two warning rows, each a marker followed by its message.
  alerts: [
    [8, 13, 9, 9, 'accent'], [23, 15, 89, 6, 'line'],
    [8, 34, 9, 9, 'accent'], [23, 36, 66, 6, 'line'],
  ],
  // lineItems — a stack of item cards, each a name over its delivery meter. The
  // meter sits UNDER the name (not beside it) so the card reads as a two-storey
  // block: side by side it was a mirror of the journal's stamp-then-note row.
  lineItems: [
    [8, 4, 104, 13, 'line'], [12, 7, 30, 5, 'bar'], [12, 13, 72, 3, 'accent'],
    [8, 22, 104, 13, 'line'], [12, 25, 24, 5, 'bar'], [12, 31, 48, 3, 'accent'],
    [8, 40, 104, 13, 'line'], [12, 43, 34, 5, 'bar'], [12, 49, 88, 3, 'accent'],
  ],
  // journal — dated entries: a short stamp, then the note.
  journal: [
    [8, 10, 20, 6, 'accent'], [34, 10, 78, 6, 'line'],
    [8, 26, 20, 6, 'accent'], [34, 26, 58, 6, 'line'],
    [8, 42, 20, 6, 'accent'], [34, 42, 70, 6, 'line'],
  ],
  // hero — one dominant figure with its caption, plus two supporting panels.
  hero: [
    [8, 8, 52, 22, 'bar'], [8, 34, 52, 7, 'line'], [8, 45, 34, 5, 'line'],
    [68, 8, 44, 17, 'accent'], [68, 29, 44, 17, 'line'],
  ],
  // finance — money rows: a label on the left, the amount flush right.
  finance: [
    [8, 8, 38, 7, 'line'], [82, 8, 30, 7, 'bar'],
    [8, 20, 44, 7, 'line'], [90, 20, 22, 7, 'line'],
    [8, 32, 34, 7, 'line'], [86, 32, 26, 7, 'accent'],
    [8, 44, 42, 7, 'line'], [92, 44, 20, 7, 'line'],
  ],
};

// Standard Chart templates share one sketch: a baseline and a rising series. It is also
// the fallback, so any chart key (`cpm`, `cumImpr`, …) draws it without a table entry.
const CHART_PATH = 'M10 44 L34 32 L58 36 L82 18 L110 12';

export default function BlockThumb({ kind }) {
  // Array.isArray, not a bare lookup: a `kind` that happens to name a prototype
  // member ("constructor") would otherwise return a function and crash the
  // whole settings tab on .map().
  const shape = SHAPES[kind];
  const rects = Array.isArray(shape) ? shape : null;
  return (
    <svg className="blib-th" viewBox="0 0 120 56" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {rects
        ? rects.map(([x, y, w, h, cls], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} rx="2" className={`blib-th-${cls}`} />
        ))
        : (
          <>
            <rect x="8" y="46" width="104" height="2" rx="1" className="blib-th-line" />
            {/* non-scaling-stroke: the box stretches horizontally (preserveAspectRatio
                none), which would otherwise squash the line's weight along its run. */}
            <path d={CHART_PATH} className="blib-th-series" vectorEffect="non-scaling-stroke" />
          </>
        )}
    </svg>
  );
}
