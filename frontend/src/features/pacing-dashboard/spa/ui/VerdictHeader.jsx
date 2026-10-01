import { highlightTextStyle, highlightTitle } from './highlight-style.js';
const DOT = { g: 'var(--status-green)', w: 'var(--status-amber)', b: 'var(--status-red)', n: 'var(--text-faint)' };
export default function VerdictHeader({ word, status = 'n', reason, highlight }) {
  return (
    <div className="kit-verdict">
      <div className="kit-verdict-row">
        <span className="kit-verdict-dot" style={{ background: DOT[status] || DOT.n }} />
        <span className="kit-verdict-word" style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>{word}</span>
      </div>
      {reason && <div className="kit-verdict-reason">{reason}</div>}
    </div>
  );
}
