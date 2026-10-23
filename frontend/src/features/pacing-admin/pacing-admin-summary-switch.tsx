/**
 * The daily Slack summaries switch (2026-10-23): one switch for everybody. Off means Pacing sends no
 * owner and no delegate their summary after any refresh, nightly or manual; on means everything as
 * before. Admin-only like the rest of this screen - the Hub's backend refuses a non-admin itself.
 *
 * The toggle shows what Pacing has STORED, never the click: it moves when the save comes back, so a
 * failed save cannot leave it showing a state nobody is in.
 */
import { ApiError } from "../../shared/api/api-error";
import { formatError } from "../../shared/format/error";
import { Toggle } from "../../shared/ui/toggle/toggle";
import { useToast } from "../../shared/ui/toast/toast";
import { fmtDate } from "../pacing/mock/format";
import { useSlackSummarySwitch, useUpdateSlackSummarySwitch } from "./hooks";
import type { PacingSlackSummarySwitchV1 } from "./types";

const LABEL = "Daily Slack summaries";

/** The line under the label: what the current state means for people, and who set it. */
function describeSwitch(state: PacingSlackSummarySwitchV1): string {
  if (state.enabled) return "On — owners and delegates get their summary after each refresh.";
  const since = state.updatedAt ? ` since ${fmtDate(state.updatedAt)}` : "";
  const by = state.updatedBy ? ` (${state.updatedBy})` : "";
  return `Off${since}${by} — nobody gets a summary until this is switched back on.`;
}

export function SlackSummarySwitch() {
  const query = useSlackSummarySwitch();
  const update = useUpdateSlackSummarySwitch();
  const toast = useToast();

  async function handleChange(enabled: boolean) {
    // One save at a time: a second click while the first is in flight would race it.
    if (update.isPending) return;
    try {
      const saved = await update.mutateAsync(enabled);
      toast.showSuccess(saved.enabled ? "Daily Slack summaries switched on." : "Daily Slack summaries switched off.");
    } catch (error) {
      toast.showError(error instanceof ApiError ? formatError(error) : "Could not switch the daily Slack summaries.");
    }
  }

  return (
    <div className="pacing-admin__settings">
      {query.isSuccess ? (
        <Toggle
          checked={query.data.enabled}
          onChange={(enabled) => void handleChange(enabled)}
          label={LABEL}
          sub={update.isPending ? "Saving…" : describeSwitch(query.data)}
        />
      ) : (
        <div className="toggle-row">
          <div>
            <div className="toggle-row__label">{LABEL}</div>
            <div className={query.isError ? "toggle-row__sub form-error" : "toggle-row__sub"}>
              {query.isError ? formatError(query.error) : "Loading…"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
