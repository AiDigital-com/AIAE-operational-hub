import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatError } from "../../../shared/format/error";
import { useSavePacingCampaignLinks } from "../hooks";
import { PRESETS } from "./constants/asset-presets";
import { MAX_LINKS } from "./constants/link-limits";
import { validateCampaignLink } from "./validate-link";
import type { SettingsSectionHandle, SettingsSectionProps } from "../settings-section";
import type { PacingCampaignLinkV1 } from "../types";
import "./documents-panel.css";

/**
 * The Documents tab of the settings drawer (§16 of the migration plan, US-140/141): the campaign's
 * reference links behind the same single Save as every other section. Four labelled preset slots
 * (Asana, IO, Media Plan, Slack - exactly the reference implementation's set), custom links below
 * them, and the IO number read-only on top.
 *
 * Edits PATCH BY INDEX into one draft array, preserving the stored order and any duplicates -
 * the reference editor's deliberate behaviour (its older sibling rebuilt the array and lost both).
 * The save is a WHOLE-ARRAY replace on Pacing's side, so the draft is sent complete: rows the user
 * emptied out are dropped, everything else goes exactly as displayed.
 *
 * Validation is the one deliberate departure from the reference (which had none): US-141 requires
 * the Asana check, and the Hub renders every stored URL clickable - so the same rules the backend
 * enforces with 400 run here first, naming the offending link before a request is sent.
 */

interface LinkError {
  /** Draft index of the offending row, or -1 for a list-level problem (too many links). */
  index: number;
  message: string;
}

/** A custom (non-preset) row: the draft entry plus its index in the draft array. */
interface CustomRow extends PacingCampaignLinkV1 {
  index: number;
}

/** Splits the draft into "the first row owning each preset name" and everything else, by index -
 *  a second row that repeats a preset name stays editable as a custom row instead of vanishing. */
function splitDraft(draft: PacingCampaignLinkV1[]): { presetIndex: Record<string, number>; custom: CustomRow[] } {
  const presetIndex: Record<string, number> = {};
  const custom: CustomRow[] = [];
  draft.forEach((link, index) => {
    const isPreset = PRESETS.some((preset) => preset.key === link.name);
    if (isPreset && presetIndex[link.name] === undefined) presetIndex[link.name] = index;
    else custom.push({ ...link, index });
  });
  return { presetIndex, custom };
}

/**
 * The rows a save actually stores: names/urls trimmed, rows the user emptied dropped. A row is
 * "emptied" when its URL is blank and it is either a preset slot (clearing the field means
 * removing the link) or a row with no name either. A named custom row with a blank URL is NOT
 * dropped - it is a mistake the validator names, because silently discarding it loses typed work.
 */
function cleanedDraft(draft: PacingCampaignLinkV1[]): PacingCampaignLinkV1[] {
  return draft
    .map((link) => ({ name: link.name.trim(), url: link.url.trim() }))
    .filter((link) => {
      if (link.url) return true;
      const isPreset = PRESETS.some((preset) => preset.key === link.name);
      return !isPreset && link.name !== "";
    });
}

/** The first rule the cleaned list breaks, or null when it is fine to send. */
function firstError(cleaned: PacingCampaignLinkV1[]): LinkError | null {
  if (cleaned.length > MAX_LINKS) {
    return { index: -1, message: `A pacing can keep at most ${MAX_LINKS} links.` };
  }
  for (let index = 0; index < cleaned.length; index++) {
    const message = validateCampaignLink(cleaned[index].name, cleaned[index].url);
    if (message) return { index, message };
  }
  return null;
}

export interface PacingDocumentsSectionProps extends SettingsSectionProps {
  slug: string;
  /** The stored links, straight off the dashboard payload's `campaign.links`. */
  links: PacingCampaignLinkV1[] | undefined;
  /** The IO number, read-only here - synced from NetSuite, never edited on a pacing. */
  orderNumber: string | undefined;
  /** Re-seeded whenever this changes - the drawer bumps it on open, so a reopened panel never
   *  shows an edit abandoned in a previous session. */
  seedKey: number;
}

export const PacingDocumentsSection = forwardRef<SettingsSectionHandle, PacingDocumentsSectionProps>(
  function PacingDocumentsSection({ slug, links, orderNumber, seedKey, onDirtyChange }, ref) {
    const seed = () => (links ?? []).map((link) => ({ name: link.name, url: link.url }));
    const [draft, setDraft] = useState<PacingCampaignLinkV1[]>(seed);
    const [base, setBase] = useState<PacingCampaignLinkV1[]>(seed);
    const [error, setError] = useState<LinkError | null>(null);
    const save = useSavePacingCampaignLinks(slug);

    // Re-hydrate from the latest server data on every open, never carrying a stale edit across a
    // close/reopen. Keyed on `seedKey`/`slug` rather than on `links`, so a background refetch
    // cannot clobber an edit in progress - same rule as the Data panel.
    useEffect(() => {
      const seeded = (links ?? []).map((link) => ({ name: link.name, url: link.url }));
      setDraft(seeded);
      setBase(seeded);
      setError(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seedKey, slug]);

    const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base), [draft, base]);
    useEffect(() => {
      onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);

    const draftRef = useRef(draft);
    draftRef.current = draft;
    const baseRef = useRef(base);
    baseRef.current = base;
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;

    useImperativeHandle(ref, () => ({
      async save() {
        if (!dirtyRef.current) return { ok: true as const };
        const cleaned = cleanedDraft(draftRef.current);
        const validationError = firstError(cleaned);
        if (validationError) {
          setError(validationError);
          return { ok: false as const, message: validationError.message };
        }
        try {
          await save.mutateAsync(cleaned);
          setError(null);
          setDraft(cleaned);
          setBase(cleaned);
          return { ok: true as const };
        } catch (requestError) {
          return { ok: false as const, message: formatError(requestError) };
        }
      },
      reset() {
        setDraft(baseRef.current);
        setError(null);
      },
    }));

    const { presetIndex, custom } = splitDraft(draft);

    function patch(index: number, change: Partial<PacingCampaignLinkV1>) {
      setError(null);
      setDraft((prev) => prev.map((link, i) => (i === index ? { ...link, ...change } : link)));
    }

    function remove(index: number) {
      setError(null);
      setDraft((prev) => prev.filter((_, i) => i !== index));
    }

    function setPresetUrl(key: string, url: string) {
      const index = presetIndex[key];
      if (index === undefined) {
        setError(null);
        setDraft((prev) => [...prev, { name: key, url }]);
      } else {
        patch(index, { url });
      }
    }

    function addCustom() {
      setError(null);
      setDraft((prev) => [...prev, { name: "", url: "" }]);
    }

    /** Which draft row the current error points at, translated to a custom row's position. */
    const invalid = (index: number) => error !== null && error.index !== -1 && errorDraftIndex() === index;

    /** The DRAFT index of the erroring row: the error indexes the cleaned list, which may be
     *  shorter than the draft (emptied rows are dropped), so walk the same cleaning order. */
    function errorDraftIndex(): number {
      if (error === null || error.index === -1) return -1;
      let cleanedPosition = -1;
      for (let index = 0; index < draft.length; index++) {
        const name = draft[index].name.trim();
        const url = draft[index].url.trim();
        const isPreset = PRESETS.some((preset) => preset.key === name);
        const kept = url !== "" || (!isPreset && name !== "");
        if (!kept) continue;
        cleanedPosition += 1;
        if (cleanedPosition === error.index) return index;
      }
      return -1;
    }

    return (
      <>
        {orderNumber && (
          <div className="pdocsp__io">
            <span className="pdocsp__io-label">IO number</span>
            <span className="pdocsp__io-value">{orderNumber}</span>
            <span className="pdocsp__hint">Synced from NetSuite</span>
          </div>
        )}

        <section className="pdocsp__section">
          <h3 className="pdocsp__heading">Campaign links</h3>
          <div className="pdocsp__rows">
            {PRESETS.map((preset) => {
              const index = presetIndex[preset.key];
              const url = index === undefined ? "" : draft[index].url;
              return (
                <div key={preset.key} className="pdocsp__preset-row">
                  <span className="pdocsp__preset-label">
                    <span className={`pdocsp__preset-icon pdocsp__preset-icon--${preset.iconCls}`} aria-hidden="true">
                      {preset.iconText}
                    </span>
                    {preset.key}
                  </span>
                  <input
                    className="pdocsp__url-input"
                    value={url}
                    aria-label={`${preset.key} URL`}
                    aria-invalid={index !== undefined && invalid(index) ? true : undefined}
                    onChange={(event) => setPresetUrl(preset.key, event.target.value)}
                    placeholder="Paste URL…"
                  />
                  {/* The clear button appears in a fixed-width slot, so its arrival never shifts
                      the input beside it. */}
                  <span className="pdocsp__clear-slot">
                    {url !== "" && index !== undefined && (
                      <button
                        type="button"
                        className="pdocsp__clear"
                        aria-label={`Clear ${preset.key} URL`}
                        onClick={() => remove(index)}
                      >
                        &times;
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="pdocsp__section">
          <h3 className="pdocsp__heading">Custom links</h3>
          <div className="pdocsp__rows">
            {custom.map((row, position) => (
              <div key={row.index} className="pdocsp__custom-row">
                <input
                  className="pdocsp__name-input"
                  value={row.name}
                  aria-label={`Custom link ${position + 1} name`}
                  aria-invalid={invalid(row.index) ? true : undefined}
                  onChange={(event) => patch(row.index, { name: event.target.value })}
                  placeholder="Name"
                />
                <input
                  className="pdocsp__url-input"
                  value={row.url}
                  aria-label={`Custom link ${position + 1} URL`}
                  aria-invalid={invalid(row.index) ? true : undefined}
                  onChange={(event) => patch(row.index, { url: event.target.value })}
                  placeholder="Paste URL…"
                />
                <span className="pdocsp__clear-slot">
                  <button
                    type="button"
                    className="pdocsp__clear"
                    aria-label={`Remove custom link ${position + 1}`}
                    onClick={() => remove(row.index)}
                  >
                    &times;
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button type="button" className="pdocsp__add" onClick={addCustom}>
            + Add link
          </button>
          <p className="pdocsp__hint pdocsp__hint--block">
            Name a link after its DSP ("DV360", "TTD", …) and it is shown first in the dashboard
            header. Links open in a new tab.
          </p>
        </section>

        {error && (
          <p className="form-error pdocsp__error" role="alert">
            {error.message}
          </p>
        )}
      </>
    );
  }
);
