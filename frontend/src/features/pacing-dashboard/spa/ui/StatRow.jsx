import { highlightTextStyle, highlightTitle } from './highlight-style.js';
// fact / target(needed) / deviation triple — stacks vertically below 240px
// container width via the .kit-statrow flex-wrap rule in kit.css.
//
// `layout: 'pair'` is the same row in equal halves, without the divider above it —
// OverviewBlock2's FinPair (:48-61), which is a stat row by any other name. Default
// 'flex' leaves every existing caller byte-identical.
const TONE = { g: 'var(--status-green)', b: 'var(--status-red)', m: 'var(--text-muted)' };
export default function StatRow({ cells, layout = 'flex' }) {
  return (
    <div className={`kit-statrow${layout === 'pair' ? ' kit-statrow--pair' : ''}`}>
      {cells.map((c, i) => (
        <div className="kit-statrow-cell" key={i}>
          <span className="kit-statrow-l">{c.label}</span>
          <span className="kit-statrow-v" title={highlightTitle(c.highlight)} style={{ ...(c.tone ? { color: TONE[c.tone] } : {}), ...highlightTextStyle(c.highlight) }}>{c.value}</span>
        </div>
      ))}
    </div>
  );
}
