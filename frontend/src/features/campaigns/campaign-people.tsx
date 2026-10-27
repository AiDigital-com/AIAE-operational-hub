import { useEffect, useRef, useState } from "react";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { cn } from "../../shared/style/cn";
import { ChevronDownIcon, SearchIcon } from "../../shared/ui/icons/icons";
import { Modal } from "../../shared/ui/modal/modal";
import { Tooltip } from "../../shared/ui/tooltip/tooltip";
import { listShareOwnedPacings } from "./shares-api";
import type { CampaignSharePacingV1, CampaignShareV1 } from "./shares-api";
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
 *
 * Under the share list (2026-10-27), read-only and folded by default: who sees the campaign anyway,
 * through a team that owns its agency (`teamAccess`) - the way a shared document lists who has
 * access. No Remove there; team membership is changed in team management, not on a campaign. The
 * search shows suggestions only once something is typed, and they take the popover's place.
 *
 * Removing someone who owns pacings on the campaign (2026-10-23) first shows what that means: each of
 * their pacings here moves whole to the remover - every campaign it spans included - before they go.
 * Only on confirm does the delete carry `transferPacings`; the backend refuses the plain delete.
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

/** Whether a share came from owning a pacing on the campaign rather than from "Add people". */
export function isViaPacing(share: Pick<CampaignShareV1, "source">): boolean {
  return share.source === "pacing_created";
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
    isViaPacing(person)
      ? "Added automatically - owns a pacing on this campaign"
      : person.grantedByName ? `Added by ${person.grantedByName}` : null,
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
        <span className="cpeople__option-name">
          {person.fullName || person.email}
          {isViaPacing(person) && <span className="cpeople__badge">via pacing</span>}
        </span>
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
  // Set while the "they own pacings here" confirmation is up; the popover stays open under it.
  const [removal, setRemoval] = useState<{ person: CampaignShareV1; pacings: CampaignSharePacingV1[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const canShare = shares.data?.canShare ?? false;
  const people = shares.data?.shares ?? [];
  const team = shares.data?.teamAccess ?? [];
  // Suggestions only while typing, the way a shared document's dialog works: an empty box leaves the
  // popover to who already has access.
  const searching = canShare && searchInput.trim().length > 0;
  const candidates = useShareCandidates(campaignId, search, open && canShare && search.length > 0);
  const [teamOpen, setTeamOpen] = useState(false);

  // Close on a click anywhere else or on Escape - a popover that only closes from its own button
  // ends up left open under the next thing the person does.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      // The confirmation is portaled to the body, so a click inside it is "outside" the popover.
      if (removal) return;
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
  }, [open, removal]);

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

  // Removing somebody first asks the backend what they own here. Nothing owned: remove at once.
  // Something owned: show it and ask, since confirming hands every one of those pacings to the remover.
  async function drop(person: CampaignShareV1) {
    setError(null);
    setChecking(true);
    try {
      const pacings = await listShareOwnedPacings(campaignId, person.hubUserId);
      if (pacings.length === 0) {
        await remove.mutateAsync({ hubUserId: person.hubUserId, transferPacings: false });
      } else {
        setRemoval({ person, pacings });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove access");
    } finally {
      setChecking(false);
    }
  }

  async function confirmRemoval() {
    if (!removal) return;
    setError(null);
    try {
      await remove.mutateAsync({ hubUserId: removal.person.hubUserId, transferPacings: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove access");
    } finally {
      setRemoval(null);
    }
  }

  // Not loaded, or not visible at all: the hero shows nothing rather than an empty control. A
  // refusal here means the campaign itself is out of reach, which the page already says.
  if (!shares.data) return null;
  if (!canShare && people.length === 0) return null;

  const stack = people.slice(0, STACK_LIMIT);
  const overflow = people.length - stack.length;
  const busy = create.isPending || remove.isPending || checking;

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
          )}

          {searching ? (
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
                <li className="cpeople__note">Nobody matches that.</li>
              )}
            </ul>
          ) : (
            <div className="cpeople__body">
              <p className="cpeople__heading">Added to Campaign</p>
              {people.length === 0 ? (
                <p className="cpeople__note">Nobody has been added yet.</p>
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
                          onClick={() => void drop(p)}
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

              {team.length > 0 && (
                <>
                  <button
                    type="button"
                    className="cpeople__team-toggle"
                    onClick={() => setTeamOpen((current) => !current)}
                    aria-expanded={teamOpen}
                  >
                    <span className="cpeople__team-label">Team access</span>
                    <span className="cpeople__team-count">
                      {team.length} {team.length === 1 ? "person" : "people"}
                    </span>
                    <ChevronDownIcon className={cn("cpeople__team-chevron", teamOpen && "cpeople__team-chevron--open")} />
                  </button>
                  {teamOpen && (
                    <ul className="cpeople__list cpeople__list--team" aria-label="Team access">
                      {team.map((p) => (
                        <li key={p.hubUserId} className="cpeople__row">
                          <span className="cpeople__avatar cpeople__avatar--sm" aria-hidden="true">
                            {initials(p)}
                          </span>
                          <PersonText person={p} />
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <p className="cpeople__note cpeople__note--foot">Admins can see every campaign.</p>
            </div>
          )}
          {error && <p className="cpeople__error">{error}</p>}
        </div>
      )}

      {removal && (
        <RemovalConfirmation
          removal={removal}
          busy={remove.isPending}
          onCancel={() => setRemoval(null)}
          onConfirm={() => void confirmRemoval()}
        />
      )}
    </div>
  );
}

/** A campaign's label in the confirmation: its name, or its id when Pacing only knows that. */
function campaignLabel(campaign: CampaignSharePacingV1["campaigns"][number]): string {
  return campaign.name || `Campaign ${campaign.id}`;
}

/**
 * "They own pacings here" - the dialog before a removal that moves work. Every pacing is listed with
 * every campaign it covers, so the remover sees when one reaches beyond this campaign: the transfer
 * is of the whole pacing, never of a slice.
 */
function RemovalConfirmation({
  removal,
  busy,
  onCancel,
  onConfirm,
}: {
  removal: { person: CampaignShareV1; pacings: CampaignSharePacingV1[] };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = removal.person.fullName || removal.person.email || "this person";
  const count = removal.pacings.length;
  return (
    <Modal
      open
      onClose={onCancel}
      title={`Remove ${name}?`}
      subtitle={`${name} owns ${count} pacing${count === 1 ? "" : "s"} on this campaign. Each one is transferred whole to you - including every other campaign it covers - and only then is their access removed.`}
      className="cpeople-confirm"
    >
      <ul className="cpeople-confirm__list">
        {removal.pacings.map((pacing) => (
          <li key={pacing.pacingId} className="cpeople-confirm__pacing">
            <span className="cpeople-confirm__pacing-name">{pacing.pacingName || pacing.dashSlug || pacing.pacingId}</span>
            <span className="cpeople-confirm__pacing-campaigns">
              {pacing.campaigns.length > 1 ? `Spans ${pacing.campaigns.length} campaigns: ` : "Covers: "}
              {pacing.campaigns.map(campaignLabel).join(", ") || "no campaign on record"}
            </span>
          </li>
        ))}
      </ul>
      <div className="cpeople-confirm__actions">
        <button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button button--primary" onClick={onConfirm} disabled={busy}>
          Transfer to me and remove
        </button>
      </div>
    </Modal>
  );
}
