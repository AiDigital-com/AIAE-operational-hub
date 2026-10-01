export default function RecoStrip({ label, value, sub }) {
  return (
    <div className="kit-reco">
      <div className="kit-reco-l">
        <span>{label}</span>
        {sub && <span className="kit-reco-sub">{sub}</span>}
      </div>
      <span className="kit-reco-v">{value}</span>
    </div>
  );
}
