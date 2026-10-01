// Kit brick (spec §4): card frame + title row with a badge slot.
export default function CardChrome({ title, badge, children }) {
  return (
    <div className="kit-card">
      <div className="kit-card-hd">
        <span className="kit-card-t">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}
