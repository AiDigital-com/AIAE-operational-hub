// workspace/src/pages/Dashboard/components/Settings/Widgets/Switch.jsx
//
// The ONE on/off control of the per-pacing gallery (widget-library spec §6.1).
// Presentational only — it knows nothing about the store, the router or where its
// value is saved, because it serves both write paths: an immediate display.enabled
// save (hooks/useEnabledSwitch.js) and a plain drawer-draft change (hero / Finance
// / charts).
//
// Its own module because BlockLibrary and WidgetGallery both render it and
// BlockLibrary already imports WidgetGallery — exporting it from there would make
// the pair circular. That happens to work only because function declarations
// hoist, and it is exactly the kind of trap that breaks the day someone converts
// it to `const Switch = …`.
//
// role="switch" so it announces its state; a pill track with a moving knob. Never
// a side rail (project ban on vertical stripes).
export default function Switch({ on, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="blib-sw"
      disabled={disabled}
      // The control carries no visible text, so the hover title is where the
      // meaning of the two positions is spelled out (the same wording Layout
      // mode's Off/On chip uses — one vocabulary for one preference).
      title={on
        ? 'Shown on the dashboard. Click to turn off.'
        : 'Not shown on the dashboard. Click to turn on.'}
      onClick={() => onChange(!on)}
    />
  );
}
