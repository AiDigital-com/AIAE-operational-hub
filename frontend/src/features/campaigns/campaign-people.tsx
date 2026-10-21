import { useEffect, useRef, useState } from "react";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { SearchIcon } from "../../shared/ui/icons/icons";
import { Tooltip } from "../../shared/ui/tooltip/tooltip";
import type { CampaignShareV1 } from "./shares-api";
import { useCampaignShares, useCreateShare, useDeleteShare, useShareCandidates } from "./shares-hooks";
import "./campaign-people.css";

/**
 * The people a campaign is shared with, in the top-right of the campaign hero (2026-10-20).
 *
 * Closed: a stack of initials and, for someone who may share, an "Add people" button. Open: a search
 * box over everyone in the Hub who is not on the campaign yet, and the list of who is, each with a
 * Remove. Who may share is the backend's answer (`canShare`): a person who sees the campaign only
 * because it was shared with them gets the stack and nothing else, and Client Services likewise.
 *
 * Nothing here decides access. A refusal comes back as a sentence and is shown as written.
 */

const SEARCH_DEBOUNCE_MS = 200;
const STACK_LIMIT = 4;

/** Two letters for the avatar: first letters of the first two words of the name, or of the email. */
export function initials(share: Pick<CampaignShareV1, "fullName" | "email">): string {
  const source = (share.fullName || share.email || "").trim();
  if (!source) return "?";
  const words = source.split(/[\s.@_-]+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => word[0]);
  return letters.join("").toUpperCase();
}

/** The line under a name: role and team, or the email when the person holds no role. */
export function roleLine(person: Pick<CampaignShareV1, "email" | "roleName" | "teamName">): string {
  const parts = [person.roleName, person.teamName].filter(Boolean);
  return parts.length ? parts.join(" · ") : (person.email ?? "");
}

/**
 * The whole of a person, for the hover bubble over a row whose text is cut short: name, role and
 * team, email, and who added them. Everything the row shows, untruncated, plus what it hides.
 */
function PersonDetails({ person }: { person: Partial<CampaignShareV1> }) {
  const lines = [
    person.fullName,
    [person.roleName, person.teamName].filter(Boolean).join(" · ") || null,
    person.email,
    person.grantedByName ? `Added by ${person.grantedByName}` : null,
  ].filter(Boolean) as string[];
  return (
    <span className="cpeople__details">
      {lines.map((line, index) => (
        <span key={index} className={cn("cpeople__details-line", index === 0 && "cpeople__details-line--name")}>
          {line}
        </span>
      ))}
    </span>
  );
}

/** A row's two text lines, with the full text in a bubble on hover - the row is narrow and cuts both. */
function PersonText({ person }: { person: Partial<CampaignShareV1> }) {
  return (
    <Tooltip className="cpeople__text" content={<PersonDetails person={person} />}>
      <span className="cpeople__option-text">
        <span className="cpeople__option-name">{person.fullName || person.email}</span>
        <span className="cpeople__option-email">{roleLine(person)}</span>
      </span>
    </Tooltip>
  );
}

export function CampaignPeople({ campaignId }: { campaignId: number }) {
  const shares = useCampaignShares(campaignId);
  const create = useCreateShare(campaignId);
  const remove = useDeleteShare(campaignId);
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS).trim();
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const canShare = shares.data?.canShare ?? false;
  const people = shares.data?.shares ?? [];
  const candidates = useShareCandidates(campaignId, search, open && canShare);

  // Close on a click anywhere else or on Escape - a popover that only closes from its own button
  // ends up left open under the next thing the person does.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && canShare) searchRef.current?.focus();
  }, [open, canShare]);

  function toggle() {
    setError(null);
    setOpen((current) => !current);
  }

  async function add(hubUserId: number) {
    setError(null);
    try {
      await create.mutateAsync(hubUserId);
      setSearchInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not share the campaign");
    }
  }

  async function drop(hubUserId: number) {
    setError(null);
    try {
      await remove.mutateAsync(hubUserId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove access");
    }
  }

  // Not loaded, or not visible at all: the hero shows nothing rather than an empty control. A
  // refusal here means the campaign itself is out of reach, which the page already says.
  if (!shares.data) return null;
  if (!canShare && people.length === 0) return null;

  const stack = people.slice(0, STACK_LIMIT);
  const overflow = people.length - stack.length;
  const busy = create.isPending || remove.isPending;

  return (
    <div className="cpeople" ref={rootRef}>
      <div className="cpeople__bar">
        {people.length > 0 && (
          <button
            type="button"
            className="cpeople__stack"
            onClick={toggle}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={`${people.length} ${people.length === 1 ? "person" : "people"} added to this campaign`}
            title={people.map((p) => p.fullName || p.email).join(", ")}
          >
            {stack.map((p) => (
              <span key={p.hubUserId} className="cpeople__avatar" aria-hidden="true">
                {initials(p)}
              </span>
            ))}
            {overflow > 0 && (
              <span className="cpeople__avatar cpeople__avatar--more" aria-hidden="true">
                +{overflow}
              </span>
            )}
          </button>
        )}
        {canShare && (
          <button
            type="button"
            className="button button--ghost button--sm cpeople__add"
            onClick={toggle}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            Add people
          </button>
        )}
      </div>

      {open && (
        <div className="cpeople__pop" role="dialog" aria-label="People on this campaign">
          {canShare && (
            <>
              <label className="cpeople__search">
                <SearchIcon />
                <input
                  ref={searchRef}
                  className="cpeople__search-input"
                  type="search"
                  placeholder="Add a person by name or email…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  aria-label="Add a person"
                />
              </label>
              <ul className="cpeople__list cpeople__list--candidates">
                {(candidates.data ?? []).map((c) => (
                  <li key={c.hubUserId}>
                    <button
                      type="button"
                      className="cpeople__option"
                      onClick={() => void add(c.hubUserId)}
                      disabled={busy}
                    >
                      <span className="cpeople__avatar cpeople__avatar--sm" aria-hidden="true">
                        {initials(c)}
                      </span>
                      <PersonText person={c} />
                    </button>
                  </li>
                ))}
                {candidates.data && candidates.data.length === 0 && (
                  <li className="cpeople__note">{search ? "Nobody matches that." : "Everyone is on this campaign already."}</li>
                )}
              </ul>
            </>
          )}

          <p className="cpeople__heading">On this campaign</p>
          {people.length === 0 ? (
            <p className="cpeople__note">Nobody has been added yet. People on the owning team see it anyway.</p>
          ) : (
            <ul className="cpeople__list">
              {people.map((p) => (
                <li key={p.hubUserId} className="cpeople__row">
                  <span className="cpeople__avatar cpeople__avatar--sm" aria-hidden="true">
                    {initials(p)}
                  </span>
                  <PersonText person={p} />
                  {canShare && (
                    <button
                      type="button"
                      className={cn("button button--ghost button--sm cpeople__remove")}
                      onClick={() => void drop(p.hubUserId)}
                      disabled={busy}
                      aria-label={`Remove ${p.fullName || p.email}`}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="cpeople__error">{error}</p>}
        </div>
      )}
    </div>
  );
}
