import { useToast } from "../../../shared/ui/toast/toast";
import { orderAssetLinks } from "./asset-links";
import type { OrderedAssetLink } from "./model/asset-link";
import type { PacingCampaignLinkV1 } from "../types";
import "./documents-chips.css";

/**
 * The campaign's reference material as a row of pills under the pacing title (§16 of the migration
 * plan, US-140/141): DSP consoles on their own line first (the team's primary jump), then the IO
 * number, the Data source sheet, and every other saved link. Text-only pills - link-ness shows on
 * hover (underline + arrow), and DSP pills carry a background tint, never a side stripe.
 *
 * Every link opens in a new tab (`target="_blank" rel="noopener noreferrer"`), per US-140. The IO
 * number is not a link: NetSuite's UI is not deep-linkable by order number, so the useful action
 * is copying it - a click copies and confirms with a toast, exactly as the reference did.
 */

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export interface DocumentsChipsProps {
  links: PacingCampaignLinkV1[] | undefined;
  orderNumber: string | undefined;
  sourceUrl: string | undefined;
  /** Opens the settings drawer on the Documents tab - the "+ Add documents" pill's action. */
  onOpenDocuments: () => void;
}

export function DocumentsChips({ links, orderNumber, sourceUrl, onOpenDocuments }: DocumentsChipsProps) {
  const toast = useToast();
  const io = (orderNumber ?? "").trim();
  const source = (sourceUrl ?? "").trim();
  const ordered = orderAssetLinks(links);
  const dspLinks = ordered.filter((link) => link.kind === "dsp");
  const otherLinks = ordered.filter((link) => link.kind !== "dsp");

  async function handleCopyIo() {
    const ok = await copyText(io);
    if (ok) toast.showSuccess(`IO ${io} copied`);
    else toast.showError("Copy failed — select the number manually");
  }

  function linkChip(link: OrderedAssetLink) {
    return (
      <a
        key={link.name + link.url}
        className={`pdocs__chip pdocs__chip--link${link.kind === "dsp" ? " pdocs__chip--dsp" : ""}`}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={link.name}
      >
        {link.name}
      </a>
    );
  }

  return (
    <div className="pdocs">
      {dspLinks.length > 0 && <div className="pdocs__row">{dspLinks.map(linkChip)}</div>}
      <div className="pdocs__row">
        {io && (
          <button
            type="button"
            className="pdocs__chip pdocs__chip--io"
            onClick={() => void handleCopyIo()}
            title={`Copy IO ${io}`}
            aria-label={`Copy IO ${io}`}
          >
            <span className="pdocs__io-tag" aria-hidden="true">
              IO
            </span>
            <span className="pdocs__io-number">{io}</span>
          </button>
        )}
        {/* The Data source chip is drawn even with nothing to open (§16 owner decision): in this
            deployment nothing writes Pacing's source_spreadsheet_url column yet (the n8n
            source-manager that owned it is not among the deployed services), so `sourceUrl` is
            empty in practice today. A disabled grey chip says the slot exists and is not
            connected; the moment a later ticket starts writing the column, the non-empty URL
            flows through this same prop and the chip becomes a working link with NO code change
            here. Do not "clean up" the disabled branch as dead - it is the current production
            state. */}
        {source ? (
          <a
            className="pdocs__chip pdocs__chip--link"
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            title="Source spreadsheet"
          >
            Data source
          </a>
        ) : (
          <span className="pdocs__chip pdocs__chip--disabled" title="Source not connected yet">
            Data source
          </span>
        )}
        {otherLinks.map(linkChip)}
        {ordered.length === 0 && (
          <button
            type="button"
            className="pdocs__chip pdocs__chip--add"
            onClick={onOpenDocuments}
            title="Add document links in Settings"
          >
            + Add documents
          </button>
        )}
      </div>
    </div>
  );
}
