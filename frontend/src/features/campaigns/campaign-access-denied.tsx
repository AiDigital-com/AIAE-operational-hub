import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "../../shared/style/cn";
import { CheckIcon, ChevronDownIcon, CopyIcon } from "../../shared/ui/icons/icons";
import { Tooltip } from "../../shared/ui/tooltip/tooltip";
import { useCampaignAccessContacts } from "./shares-hooks";

interface CampaignAccessDeniedProps {
  campaignId: number | undefined;
}

/** How long the tick stays on the copy button before it goes back to the copy icon. */
const COPIED_MS = 2000;

/**
 * What a person sees on a campaign outside their visibility (the Hub answers 404 for it): who can let
 * them in. The Hub ties an agency to the teams NetSuite's `mpo_team_lead` names, so a campaign run by
 * another team is invisible until somebody on that team adds the person through "Add people" - anyone on
 * it, not only the Team Lead.
 *
 * One line names the team, then the ready message itself - what to do, the campaign, the link - with a
 * copy icon in its corner, to paste into Slack; the people sit behind a toggle - a team is up to a dozen
 * names. The message shown and the message copied are the same words. Until the
 * lookup answers, or when it fails or names nobody, the general explanation stands in.
 */
export function CampaignAccessDenied({ campaignId }: CampaignAccessDeniedProps) {
  const { data, isPending, isError } = useCampaignAccessContacts(campaignId, true);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const listId = useId();
  const { pathname } = useLocation();

  useEffect(() => {
    if (copyState !== "copied") {
      return;
    }
    const timer = window.setTimeout(() => setCopyState("idle"), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const netSuiteLeads = data?.netSuiteTeamLeads ?? [];
  const contacts = data?.contacts ?? [];
  const link = `${window.location.origin}${pathname}`;
  const request = accessRequest(data?.campaignName, link);

  async function copyRequest() {
    try {
      await navigator.clipboard.writeText(request);
      setCopyState("copied");
    } catch {
      // Clipboard access can be refused (an insecure context, or a denied permission). The text is then
      // shown to copy by hand - a "Copied" that did not happen would have them paste something else.
      setCopyState("failed");
    }
  }

  return (
    <div className="campaign-ws__note campaign-ws__note--denied">
      <p className="campaign-ws__note-title">You don&rsquo;t have access to this campaign.</p>
      {isPending ? (
        <p>Looking up who can add you&hellip;</p>
      ) : isError || (contacts.length === 0 && netSuiteLeads.length === 0) ? (
        <>
          <p>It may belong to another team, or it may not be shared with you.</p>
          <p>Ask the MPO manager for this campaign to share it with you.</p>
        </>
      ) : contacts.length === 0 ? (
        <p>
          In NetSuite it is assigned to {joinNames(netSuiteLeads)}, whose team is not set up in the Hub yet. Ask an
          admin to give you access.
        </p>
      ) : (
        <>
          {data?.runningTeamFound ? (
            <p>
              In NetSuite it&rsquo;s run by {teamOf(netSuiteLeads)}. Anyone on that team can add you through{" "}
              <strong>Add people</strong>.
            </p>
          ) : (
            <p>
              {netSuiteLeads.length > 0 && <>In NetSuite it is assigned to {joinNames(netSuiteLeads)}. </>}
              {contacts.length === 1 ? "This team lead" : "Any of these team leads"} can add you through{" "}
              <strong>Add people</strong>.
            </p>
          )}
          <p className="campaign-ws__access-label">
            Send this to {sendTo(Boolean(data?.runningTeamFound), contacts.length)} in Slack:
          </p>
          <div className="campaign-ws__access-message">
            <p className="campaign-ws__access-request">
              Hi! Could you add me to{" "}
              {data?.campaignName ? (
                <>
                  the campaign &ldquo;{data.campaignName}&rdquo;
                </>
              ) : (
                "this campaign"
              )}{" "}
              through Add people in the Operational Hub? {link}
            </p>
            <Tooltip content={copyState === "copied" ? "Copied" : "Copy message"} className="campaign-ws__access-copy-wrap">
              <button
                type="button"
                className={cn("campaign-ws__access-copy", copyState === "copied" && "campaign-ws__access-copy--done")}
                aria-label={copyState === "copied" ? "Copied" : "Copy message"}
                onClick={copyRequest}
              >
                {copyState === "copied" ? (
                  <CheckIcon className="campaign-ws__access-icon" />
                ) : (
                  <CopyIcon className="campaign-ws__access-icon" />
                )}
              </button>
            </Tooltip>
          </div>
          {copyState === "failed" && (
            <p className="campaign-ws__access-fallback">Could not copy. Select the text above and copy it yourself.</p>
          )}
          <button
            type="button"
            className="button button--ghost button--sm campaign-ws__access-toggle"
            aria-expanded={peopleOpen}
            aria-controls={listId}
            onClick={() => setPeopleOpen((open) => !open)}
          >
            {peopleOpen ? "Hide people" : `Show ${contacts.length} ${contacts.length === 1 ? "person" : "people"}`}
            <ChevronDownIcon className={cn("campaign-ws__access-icon", peopleOpen && "campaign-ws__access-icon--open")} />
          </button>
          {peopleOpen && (
            <ul id={listId} className="campaign-ws__contacts">
              {contacts.map((contact) => (
                <li key={contact.hubUserId} className="campaign-ws__contact">
                  <span className="campaign-ws__contact-name">{contact.fullName}</span>
                  {contact.roleName && <span className="campaign-ws__contact-role">{contact.roleName}</span>}
                  {contact.email && <span className="campaign-ws__contact-email">{contact.email}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** The message shown and copied: what to do, for which campaign, and the link. */
function accessRequest(campaignName: string | null | undefined, link: string): string {
  const what = campaignName ? `the campaign \u201c${campaignName}\u201d` : "this campaign";
  return `Hi! Could you add me to ${what} through Add people in the Operational Hub? ${link}`;
}

/** Who the message goes to, matching the line above it. */
function sendTo(runningTeamFound: boolean, people: number): string {
  if (runningTeamFound) {
    return "someone on the team";
  }
  return people === 1 ? "them" : "one of them";
}

/** "Sam Marley's team", or "Sam Marley's and Ann Lee's teams". */
function teamOf(leads: string[]): string {
  if (leads.length === 0) {
    return "another team";
  }
  const owners = joinNames(leads.map((lead) => `${lead}’s`));
  return `${owners} ${leads.length === 1 ? "team" : "teams"}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
