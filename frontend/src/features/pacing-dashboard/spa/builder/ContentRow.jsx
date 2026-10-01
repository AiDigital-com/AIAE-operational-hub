// One content entity in a Widget: a series, column, KPI, line or reading.
// Callers retain their own data rules; this owns the clickable summary and action slots.
import './ContentRow.css';

export default function ContentRow({
  rowRef, buttonRef, label, summary, marker, children, handle, actions, onOpen,
  open, quiet = false, nested = false, roleLabel, className = '', rowProps = {}, buttonProps = {},
}) {
  const facts = typeof summary === 'string' && summary.split(' · ')[0] === label
    ? summary.split(' · ').slice(1).join(' · ') : summary;
  return (
    <div ref={rowRef}
      className={`sp-rb-el sp-rb-el--act sp-content-row${nested ? ' sp-content-row--child' : ''}${quiet ? ' sp-rb-el--quiet' : ''}${className ? ` ${className.trim()}` : ''}`}
      {...rowProps}>
      {handle}
      <button type="button" className="sp-rb-el-b" ref={buttonRef} onClick={onOpen}
        aria-haspopup="dialog" aria-expanded={open} {...buttonProps}>
        {marker}
        {roleLabel ? <><span className="sp-content-role">{roleLabel}</span>{' '}</> : null}
        <span className="sp-rb-el-nm">{label}</span>
        {children}
        {facts ? <span className="sp-rb-el-sum">{` · ${facts}`}</span> : null}
      </button>
      {actions}
    </div>
  );
}
