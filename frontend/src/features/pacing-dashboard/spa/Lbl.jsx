// workspace/src/pages/Dashboard/components/Settings/Lbl.jsx
//
// The one field-label primitive. Stacked labels are single-line by contract
// (drawer spec §3.2 — a wrapped label pushes its control below its row-mates
// and breaks the row-height acceptance), so every one of them ellipsizes, and
// the title is what makes a clipped label readable again.

export default function Lbl({ children, title, className }) {
  // `<Lbl>USD per {cur}</Lbl>` compiles to an ARRAY of children, so a bare
  // `typeof children === 'string'` test would silently drop the title on every
  // interpolated label — the ones most likely to overflow a 148px track.
  const flat = Array.isArray(children) ? children : [children];
  const auto = flat.every((c) => typeof c === 'string' || typeof c === 'number')
    ? flat.join('')
    : undefined;
  return (
    <span className={className ? `sp-lbl ${className}` : 'sp-lbl'} title={title || auto}>{children}</span>
  );
}
