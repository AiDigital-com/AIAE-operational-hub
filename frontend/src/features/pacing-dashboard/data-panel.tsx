import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatError } from "../../shared/format/error";
import { useSavePacingDataSettings } from "./hooks";
import type { SettingsSectionHandle, SettingsSectionProps } from "./settings-section";
import type { PacingDataSettingsUpdateV1, PacingDataShape, PacingDimSource } from "./types";
import "./data-panel.css";

/**
 * Where a pacing's delivery is read from, and which optional extras are fetched with it - the Data tab
 * the retired SPA carried (`DataTab.jsx`), rebuilt on the Hub's own primitives.
 *
 * It exists because this setting is not cosmetic. `source` names the BigQuery table the delivery query
 * reads: `platform_mart` is the raw platform feed, `platform_mart_adjustments_view` is the same feed
 * with the team's manual delivery corrections applied. On a campaign that has ever been corrected the
 * two disagree - and with no screen to see or change it, a pacing created through the API silently
 * kept Pacing's `platform_mart` default while the numbers everyone quotes came from the other table.
 *
 * SAVES ONLY WHAT CHANGED. Pacing merges this namespace key by key, so sending an untouched setting is
 * indistinguishable from editing it to the value it already had - harmless for a boolean, not harmless
 * for a list. The diff below is what keeps `dim_sources` out of a save that only moved the radio, and
 * it is also this section's dirty flag: an empty patch is a section with nothing to save.
 *
 * The namespace carries more than this panel shows (a sheet binding, a delivery-tab flag, a
 * coefficient-cost flag). Those keys are safe precisely because they are never sent: a key absent from
 * the request is a key Pacing leaves alone.
 */

/** The catalogue dimension source this panel offers as a checkbox. Mirrors Pacing's own
 *  `DIM_SOURCE_CATALOG` key, which is what a stored entry's `origin.catalog` names. */
const DEVICES_SOURCE_ID = "devices";

const SOURCE_OPTIONS: Array<{ value: string; name: string; table: string; note: string }> = [
  {
    value: "platform_mart",
    name: "Raw delivery",
    table: "platform_mart",
    note: "Delivery exactly as the platforms reported it.",
  },
  {
    value: "platform_mart_adjustments_view",
    name: "With manual adjustments",
    table: "platform_mart_adjustments_view",
    note: "The same feed with the team's manual delivery corrections applied on top.",
  },
];

/** Is the built-in Devices source in this pacing's stored list? Matched on `loader` as well as `id`,
 *  the way Pacing's own reader does: a sheet-backed source that happens to be named `devices` is not
 *  the catalogue one, and ticking this box must not claim it. */
function devicesOn(dimSources: PacingDimSource[]): boolean {
  return dimSources.some((entry) => entry?.id === DEVICES_SOURCE_ID && entry?.loader === "bq_mart");
}

/**
 * The whole `dim_sources` list to store for a given state of the Devices checkbox.
 *
 * Every entry this panel does not own is carried through, in its original order. That is the whole
 * point: the field is a whole-array replace, so a list rebuilt from this one checkbox alone would
 * delete the pacing's sheet-backed sources on a click that has nothing to do with them.
 */
function dimSourcesFor(devices: boolean, existing: PacingDimSource[]): PacingDimSource[] {
  const others = existing.filter((entry) => entry?.id !== DEVICES_SOURCE_ID);
  const builtIn: PacingDimSource[] = devices
    ? [{ id: DEVICES_SOURCE_ID, loader: "bq_mart", origin: { catalog: DEVICES_SOURCE_ID } }]
    : [];
  return [...builtIn, ...others];
}

interface DataDraft {
  source: string;
  fetchCreatives: boolean;
  fetchConversions: boolean;
  devices: boolean;
}

/**
 * Reads the stored namespace into the panel's state.
 *
 * An absent namespace is a pacing that has never had these settings written, and it reads as Pacing's
 * own defaults - raw `platform_mart`, every extra off - because that is what its refresh actually
 * does. An unrecognised stored source falls back the same way Pacing's `safeDataSource` does, so the
 * radio shows the table the query will really read rather than no selection at all.
 */
function seed(data: PacingDataShape | undefined): DataDraft {
  const stored = data?.source;
  const known = SOURCE_OPTIONS.some((option) => option.value === stored);
  const dimSources = Array.isArray(data?.dim_sources) ? data.dim_sources : [];
  return {
    source: known ? (stored as string) : "platform_mart",
    fetchCreatives: data?.fetch_creatives === true,
    fetchConversions: data?.fetch_conversions === true,
    devices: devicesOn(dimSources),
  };
}

/** The request body for a draft against what was loaded: every changed field, and nothing else. */
function diff(draft: DataDraft, base: DataDraft, existing: PacingDimSource[]): PacingDataSettingsUpdateV1 {
  const body: PacingDataSettingsUpdateV1 = {};
  if (draft.source !== base.source) {
    body.source = draft.source as PacingDataSettingsUpdateV1["source"];
  }
  if (draft.fetchCreatives !== base.fetchCreatives) body.fetchCreatives = draft.fetchCreatives;
  if (draft.fetchConversions !== base.fetchConversions) body.fetchConversions = draft.fetchConversions;
  if (draft.devices !== base.devices) {
    // Wrapped, and the wrapper is the signal: sending the field at all means "replace the list", so it
    // is built only when this checkbox actually moved. An unwrapped array could not say that - see the
    // contract's own note on why `PacingDimSourcesV1` exists.
    body.dimSources = {
      entries: dimSourcesFor(draft.devices, existing) as Array<Record<string, unknown>>,
    };
  }
  return body;
}

export interface PacingDataSectionProps extends SettingsSectionProps {
  slug: string;
  /** This pacing's stored `data` namespace, straight off the dashboard payload. */
  data: PacingDataShape | undefined;
  /** Re-seeded whenever this changes - the drawer bumps it on open, so a reopened panel never
   *  shows an edit abandoned in a previous session. */
  seedKey: number;
}

export const PacingDataSection = forwardRef<SettingsSectionHandle, PacingDataSectionProps>(
  function PacingDataSection({ slug, data, seedKey, onDirtyChange }, ref) {
    const [draft, setDraft] = useState<DataDraft>(() => seed(data));
    const [base, setBase] = useState<DataDraft>(() => seed(data));
    const [extrasOpen, setExtrasOpen] = useState(false);
    const save = useSavePacingDataSettings(slug);

    const existingDimSources = useMemo(
      () => (Array.isArray(data?.dim_sources) ? data.dim_sources : []),
      [data]
    );

    // Re-hydrate from the latest server data on every open, never carrying a stale edit across a
    // close/reopen. Keyed on `seedKey`/`slug` rather than on `data`, so a background refetch
    // cannot clobber an edit in progress.
    useEffect(() => {
      const seeded = seed(data);
      setDraft(seeded);
      setBase(seeded);
      // Collapsed on every visit, as the retired tab was: the source is what this section is for,
      // and the extras are three settings nobody opens it to change.
      setExtrasOpen(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey, slug]);

    const body = useMemo(() => diff(draft, base, existingDimSources), [draft, base, existingDimSources]);
    const dirty = Object.keys(body).length > 0;

    useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

    // The freshest patch, without re-rendering the drawer on every click: the handle below closes
    // over this ref rather than over a render's `body`.
    const bodyRef = useRef(body);
    bodyRef.current = body;
    const draftRef = useRef(draft);
    draftRef.current = draft;

    useImperativeHandle(ref, () => ({
      async save() {
        const patch = bodyRef.current;
        if (!Object.keys(patch).length) return { ok: true as const };
        try {
          await save.mutateAsync(patch);
          setBase(draftRef.current);
          return { ok: true as const };
        } catch (error) {
          return { ok: false as const, message: formatError(error) };
        }
      },
      reset() {
        setDraft(base);
      },
    }));

    function set(patch: Partial<DataDraft>) {
      setDraft((prev) => ({ ...prev, ...patch }));
    }

    return (
      <>
        <section className="pdata__section">
          <h3 className="pdata__heading">BigQuery source</h3>
          <div className="pdata__options">
            {SOURCE_OPTIONS.map((option) => (
              <label key={option.value} className="pdata__option">
                <input
                  type="radio"
                  name="pacing-data-source"
                  value={option.value}
                  checked={draft.source === option.value}
                  onChange={() => set({ source: option.value })}
                />
                <span className="pdata__option-text">
                  <span className="pdata__option-name">{option.name}</span>
                  <span className="pdata__option-table">{option.table}</span>
                  <span className="pdata__hint">{option.note}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="pdata__hint pdata__hint--block">
            Applies on the next refresh. The figures on screen were built from the table this pacing
            read last time, and they stay that way until the delivery query runs again.
          </p>
        </section>

        <section className="pdata__section">
          <button
            type="button"
            className="pdata__collapse"
            aria-expanded={extrasOpen}
            onClick={() => setExtrasOpen((value) => !value)}
          >
            <svg className="pdata__chevron" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
            <span className="pdata__heading">Additional data</span>
          </button>
          {extrasOpen && (
            <div className="pdata__options">
              <label className="pdata__check">
                <input
                  type="checkbox"
                  checked={draft.fetchCreatives}
                  onChange={(event) => set({ fetchCreatives: event.target.checked })}
                />
                <span className="pdata__option-text">
                  <span className="pdata__option-name">Fetch DSP creative assets</span>
                  <span className="pdata__hint">
                    Adds Creative (asset) to breakdowns. Turning this off removes it after a refresh.
                  </span>
                </span>
              </label>
              <label className="pdata__check">
                <input
                  type="checkbox"
                  checked={draft.fetchConversions}
                  onChange={(event) => set({ fetchConversions: event.target.checked })}
                />
                <span className="pdata__option-text">
                  <span className="pdata__option-name">Fetch conversions</span>
                  <span className="pdata__hint">
                    Adds Conversion Action to breakdowns, read from the conversions table paired with
                    the source above.
                  </span>
                </span>
              </label>
              <label className="pdata__check">
                <input
                  type="checkbox"
                  checked={draft.devices}
                  onChange={(event) => set({ devices: event.target.checked })}
                />
                <span className="pdata__option-text">
                  <span className="pdata__option-name">Devices dimension</span>
                  <span className="pdata__hint">Adds Device (from DSP) as a breakdown axis.</span>
                </span>
              </label>
            </div>
          )}
        </section>
      </>
    );
  }
);
