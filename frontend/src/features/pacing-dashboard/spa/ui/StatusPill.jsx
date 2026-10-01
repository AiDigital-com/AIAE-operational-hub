import { highlightTextStyle, highlightTitle } from './highlight-style.js';
const TONE = { g: 'kit-pill--g', w: 'kit-pill--w', b: 'kit-pill--b', n: 'kit-pill--n' };
export default function StatusPill({ text, status = 'n', highlight }) {
  return <span className={`kit-pill ${TONE[status] || TONE.n}`} style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>{text}</span>;
}
