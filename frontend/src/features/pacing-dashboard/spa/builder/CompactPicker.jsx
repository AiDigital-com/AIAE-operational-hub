import Popover from '../Popover.jsx';
import './CompactPicker.css';

// A short, already judged list of commands. Large metric/dimension catalogs keep
// Spotlight's search; fixed control/source/link menus need no second screen.
export default function CompactPicker({ open, anchorRef, title, items, onPick, onClose }) {
  const choices = items.filter((item) => item.id);
  const move = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('[role="option"]')];
    const current = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  };
  return <Popover open={open} anchorRef={anchorRef} title={title} width={360} onClose={onClose}>
    <div className="sp-compact-picker" role="listbox" aria-label={title} onKeyDown={move}>
      {choices.map((item) => <button type="button" role="option" aria-selected={false}
        aria-disabled={item.disabled || undefined} data-picker-id={item.id} key={item.id}
        onClick={() => { if (!item.disabled) onPick(item); }}>
        <span className="sp-compact-picker-label">{item.label}</span>
        {(item.reason || item.note) && <span className="sp-compact-picker-note">{item.disabled ? item.reason || item.note : item.note}</span>}
      </button>)}
    </div>
  </Popover>;
}
