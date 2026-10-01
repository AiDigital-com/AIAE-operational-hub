import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusOnOpen, useFocusTrap, useInertBackground, useOpenerRestore } from '../PopupCoordinator.jsx';

function Example({ kind }) {
  if (['kpi', 'atom:bigStat', 'atom:moneyStat', 'atom:kvRow'].includes(kind)) return <span className={`sp-element-example sp-element-example--${kind.split(':').at(-1)}`}>
    <small>{kind === 'kpi' ? 'Impressions' : 'Spend'}</small><b>{kind === 'kpi' ? '124,800' : kind === 'atom:moneyStat' ? '$12,480' : '12,480'}</b>
    {kind === 'kpi' && <em>↑ 8.2%</em>}
  </span>;
  if (['chart', 'atom:miniChart'].includes(kind)) return <span className="sp-element-example"><svg viewBox="0 0 160 48" aria-hidden="true"><path d="M3 43L30 28L56 33L84 13L110 22L154 3" fill="none" stroke="currentColor" strokeWidth="2" /></svg></span>;
  if (kind === 'pie') return <span className="sp-element-example"><i className="ri-donut-chart-line" /></span>;
  if (kind === 'container') return <span className="sp-element-example sp-element-example--container"><i /><i /><i /></span>;
  if (kind === 'atom:pill') return <span className="sp-element-example"><span className="sp-element-pill">On plan</span></span>;
  if (kind === 'atom:statRow') return <span className="sp-element-example sp-element-example--stats"><span><small>Impressions</small><b>124,800</b></span><span><small>Clicks</small><b>1,260</b></span></span>;
  if (kind === 'atom:flightBullet' || kind === 'recipe:flightBullet') return <span className="sp-element-example"><small>Flight</small><b>Day 24 <small>of 40</small></b><small>16 days remaining</small></span>;
  if (kind === 'atom:detailCard') return <span className="sp-element-example sp-element-example--detail"><small>Margin</small><b>26.8%</b><small>Ahead of target</small></span>;
  if (kind === 'atom:gauge') return <span className="sp-element-example"><small>+8% vs target</small><span className="sp-element-gauge"><i /></span><span className="sp-element-gauge-labels"><small>−20%</small><small>0</small><small>+20%</small></span></span>;
  if (kind === 'atom:unitBars') return <span className="sp-element-example sp-element-example--bars">{['Impressions', 'Clicks', 'Views'].map((label, index) => <span key={label}><small>{label}</small><span className={`sp-element-meter sp-element-meter--${index}`}><i /></span></span>)}</span>;
  if (['table', 'compare', 'atom:rateRows'].includes(kind)) return <span className="sp-element-example sp-element-example--table">
    {kind === 'atom:rateRows' ? <><span>CPM <b>$4.20</b></span><span>CPC <b>$0.35</b></span><span>CPV <b>$0.02</b></span></>
      : kind === 'compare' ? <><span>Delivery <b>CM360</b></span><span>124,800 <b>123,200</b></span><span>Difference <b>+1.3%</b></span></>
        : <><span>Channel <b>Value</b></span><span>Video <b>12,480</b></span><span>Audio <b>8,620</b></span></>}
  </span>;
  if (kind === 'atom:header') return <span className="sp-element-example"><b>A clear heading</b></span>;
  if (kind === 'atom:note') return <span className="sp-element-example sp-element-example--note">A little context about<br />what the numbers mean.</span>;
  if (kind === 'atom:meter') return <span className="sp-element-example"><small>72 of 100</small><span className="sp-element-meter"><i /></span></span>;
  return <span className="sp-element-example"><span className="sp-element-meter"><i /></span></span>;
}

const numberKinds = new Set(['kpi', 'atom:bigStat', 'atom:moneyStat', 'atom:kvRow']);
const groupFor = (choice) => choice.kind.startsWith('recipe:') ? 'Compositions' : numberKinds.has(choice.kind) ? 'Numbers'
  : ['chart', 'table', 'pie', 'compare', 'atom:miniChart'].includes(choice.kind) ? 'Charts & tables'
    : ['container', 'atom:header', 'atom:note'].includes(choice.kind) ? 'Arrange & text' : 'More elements';

export default function ElementPicker({ choices, destination, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const box = useRef(null);
  const input = useRef(null);
  const uid = useId();
  useInertBackground(true, [box]);
  useOpenerRestore(true);
  useFocusOnOpen(box, true, input);
  useFocusTrap(box, { active: true });
  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const visible = choices.filter((choice) => `${choice.label} ${choice.hint || ''} ${groupFor(choice)}`.toLowerCase().includes(query.trim().toLowerCase()));
  return createPortal(<div className="sp-element-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={box} className="sp-element-picker" role="dialog" aria-modal="true" data-dp-modal="1" aria-labelledby={`${uid}-title`}>
      <header><div><h2 id={`${uid}-title`}>Add element</h2><p>{destination}</p></div><button type="button" className="sp-rb-btn" aria-label="Close element picker" onClick={onClose}>×</button></header>
      <input ref={input} className="sp-inp sp-inp--sans" aria-label="Search elements" placeholder="Search elements…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="sp-element-results">
        {['Numbers', 'Charts & tables', 'Arrange & text', 'Compositions', 'More elements'].map((group) => {
          const items = visible.filter((choice) => groupFor(choice) === group);
          return items.length ? <section key={group}><h3>{group}</h3><div className={`sp-element-grid${group === 'Numbers' ? ' sp-element-grid--numbers' : ''}`}>{items.map((choice) => <button type="button" key={choice.kind}
            aria-disabled={!!choice.disabledReason} data-element-kind={choice.kind} onClick={() => { if (!choice.disabledReason) onPick(choice); }}>
            <span aria-hidden="true"><Example kind={choice.kind} /></span><b>{choice.label}</b><small>{choice.disabledReason || choice.hint || ({ kpi: 'Value with a comparison or metric switch', chart: 'Multiple series on shared axes', table: 'Rows and calculated columns', pie: 'Share by a dimension', container: 'Arrange any elements together', compare: 'Delivery against CM360' })[choice.kind]}</small>
          </button>)}</div></section> : null;
        })}
        {!visible.length && <p>No elements match “{query}”.</p>}
      </div>
    </section>
  </div>, document.body);
}
