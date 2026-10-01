const REFERENCES = { target: 'Target', guide: 'Guide', marker: 'Marker' };
const DIRECTIONS = new Set(['above', 'below', 'outside']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every((key) => keys.includes(key));
const reference = (value) => Object.hasOwn(REFERENCES, value);

function readPercent(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
    value = Number(text);
  }
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** UI percentages are relative to a positive reference, never percentage points.
 * The existing runtime still multiplies the reference: negative references reverse
 * these meanings and belong in the advanced condition editor. */
export function makeRelativeCondition(value) {
  if (!object(value) || !reference(value.reference) || !DIRECTIONS.has(value.direction)) return null;
  const bound = (factor) => ({ kind: value.reference, ...(factor !== 1 ? { factor } : {}) });
  if (value.direction === 'outside') {
    // Keep the old symmetric shorthand for callers creating a preset. The editor
    // always supplies both fields, so a blank side cannot borrow the other one.
    const explicit = Object.hasOwn(value, 'belowPercent') || Object.hasOwn(value, 'abovePercent');
    const below = readPercent(explicit ? value.belowPercent : value.percent);
    const above = readPercent(explicit ? value.abovePercent : value.percent);
    if (below === null || above === null) return null;
    return { op: 'outside', threshold: bound(1 - below / 100), upper: bound(1 + above / 100) };
  }
  const percent = readPercent(value.percent);
  if (percent === null) return null;
  return { op: value.direction === 'above' ? 'gt' : 'lt', threshold: bound(1 + (value.direction === 'above' ? percent : -percent) / 100) };
}

function readFactor(bound) {
  if (!onlyKeys(bound, ['kind', 'factor', 'offset']) || !reference(bound.kind)) return null;
  if (Object.hasOwn(bound, 'offset') && bound.offset !== 0) return null;
  const factor = Object.hasOwn(bound, 'factor') ? bound.factor : 1;
  return Number.isFinite(factor) ? factor : null;
}

function neighboringPercents(value) {
  if (!Number.isFinite(value) || value < 0) return [];
  if (value === 0) return [0];
  // Inverting the two rounded operations (1 ± p / 100) can land one float
  // beside the original percent. Test its immediate neighbors, still exactly.
  const number = new Float64Array([value]);
  const bits = new BigUint64Array(number.buffer);
  const original = bits[0];
  bits[0] = original - 1n;
  const previous = number[0];
  bits[0] = original + 1n;
  return [value, previous, number[0]].filter(Number.isFinite);
}

function exactPercent(candidates, matches) {
  for (const value of candidates.flatMap(neighboringPercents)) {
    // Prefer a readable decimal only when it recreates every authored factor.
    for (let precision = 1; precision <= 17; precision += 1) {
      const percent = Number(value.toPrecision(precision));
      if (Number.isFinite(percent) && percent >= 0 && matches(percent)) return percent;
    }
  }
  return null;
}

/** Recognize only conditions that this UI can rebuild without changing a factor.
 * Keep the authored condition in the editor draft; merely opening it must not
 * replace explicit defaults or reduce the precision of a legacy expression. */
export function readRelativeCondition(condition) {
  if (!onlyKeys(condition, ['op', 'threshold', 'upper'])) return null;
  const direction = { gt: 'above', lt: 'below', outside: 'outside' }[condition.op];
  if (!DIRECTIONS.has(direction)) return null;
  const factor = readFactor(condition.threshold);
  if (factor === null || (direction === 'above' && factor < 1) || (direction !== 'above' && factor > 1)) return null;
  let upper = null;
  if (direction === 'outside') {
    upper = readFactor(condition.upper);
    if (upper === null || upper < 1 || condition.upper.kind !== condition.threshold.kind) return null;
  } else if (Object.hasOwn(condition, 'upper')) return null;
  const ref = condition.threshold.kind;
  if (direction === 'outside') {
    const below = (1 - factor) * 100, above = (upper - 1) * 100;
    const symmetric = exactPercent([above, below], (percent) => 1 - percent / 100 === factor && 1 + percent / 100 === upper);
    const belowPercent = symmetric ?? exactPercent([below], (percent) => 1 - percent / 100 === factor);
    const abovePercent = symmetric ?? exactPercent([above], (percent) => 1 + percent / 100 === upper);
    return belowPercent === null || abovePercent === null ? null : { reference: ref, direction, belowPercent, abovePercent };
  }
  const percent = exactPercent([direction === 'above' ? (factor - 1) * 100 : (1 - factor) * 100],
    (value) => (direction === 'above' ? 1 + value / 100 : 1 - value / 100) === factor);
  return percent === null ? null : { reference: ref, direction, percent };
}

export function relativeConditionSummary(value) {
  if (!makeRelativeCondition(value)) return null;
  const percent = readPercent(value.percent);
  const label = REFERENCES[value.reference];
  if (value.direction === 'outside') {
    const explicit = Object.hasOwn(value, 'belowPercent') || Object.hasOwn(value, 'abovePercent');
    const belowPercent = readPercent(explicit ? value.belowPercent : value.percent);
    const abovePercent = readPercent(explicit ? value.abovePercent : value.percent);
    return belowPercent === abovePercent ? `Outside ${label} ±${belowPercent}%`
      : `Outside ${label} −${belowPercent}% / +${abovePercent}%`;
  }
  const direction = value.direction === 'above' ? 'Above' : 'Below';
  return `${direction} ${label}${percent ? ` by more than ${percent}%` : ''}`;
}
