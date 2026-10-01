import { highlightTextStyle, highlightTitle } from './highlight-style.js';
const TONE = { g: 'kit-delta--g', b: 'kit-delta--b', n: 'kit-delta--n' };
export default function DeltaChip({ text, tone = 'n', highlight }) {
  return <span className={`kit-delta ${TONE[tone] || TONE.n}`} style={highlightTextStyle(highlight)} title={highlightTitle(highlight)}>{text}</span>;
}
