import { useEffect, useRef, useState } from "react";
import { cn } from "../../../shared/style/cn";
import { formatError } from "../../../shared/format/error";
import type { Theme } from "../../../shared/style/theme";
import { useTheme } from "../../../shared/style/theme";
import { LoadingSpinner } from "../../../shared/ui/loading-spinner/loading-spinner";
import { Modal } from "../../../shared/ui/modal/modal";
import { useToast } from "../../../shared/ui/toast/toast";
import type { PacingNotifyDestinationV1 } from "./account-api";
import { useAccount, useUpdateAccount } from "./hooks";
import { SegmentedControl } from "./segmented-control";
import "./account-settings-modal.css";

interface NotifyOption {
  value: PacingNotifyDestinationV1;
  label: string;
  hint: string;
}

interface ThemeOption {
  value: Theme;
  label: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Daily Summary delivery options, matching the retired SPA's `AccountSettings.jsx` (see the module
 * doc below for the one deliberate difference). `auto` only ever reaches a private Slack group for
 * a person whose row still carries one from the retired system; everyone else's `auto` behaves
 * exactly like `dm`, which is what its hint says rather than promising a group nobody here can set.
 */
const NOTIFY_OPTIONS: NotifyOption[] = [
  { value: "auto", label: "Auto", hint: "Sent to your private group, falling back to your DM." },
  { value: "dm", label: "DM", hint: "Always sent as a direct message." },
  { value: "off", label: "Off", hint: "The summary is not sent." },
];

interface AccountSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/** Result of the Slack group field's own Save action - rendered in the reserved-height line below it. */
interface SlackSaveResult {
  kind: "success" | "warning" | "error";
  message: string;
}

/**
 * Account Settings modal, opened from the sidebar's user block. Two sections: Appearance (theme,
 * local and instant) above Daily Summary (delivery preference plus, only while `Auto` is selected,
 * the person's own Slack group id - both server-backed). The segmented control still saves on
 * selection with no separate step, matching the retired SPA's own behavior; the Slack group id gets
 * its OWN Save action instead, because saving it means a real round trip to Slack that can take a
 * moment and can be refused - the retired system's own "select = save" pattern would leave a refusal
 * with nowhere to land.
 *
 * The field only shows for `Auto`, on purpose: it is the only destination that ever reads it - `dm`
 * and `off` never look at `slackChannelId` at all (see dash-gate's resolveTargetChannel) - so showing
 * it for those two would let someone "configure" something with no effect and no way to tell.
 * Nothing below it depends on its position, so it appearing/disappearing with the destination only
 * changes the modal's own height, the same as picking a shorter or longer hint already does.
 *
 * One deliberate difference from the reference `AccountSettings.jsx`, now closed: the reference let
 * an admin type a person's private-group id on a Team page they never saw themselves; here only the
 * person themselves can set their own.
 */
export function AccountSettingsModal({ open, onClose }: AccountSettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const account = useAccount(open);
  const destinationSave = useUpdateAccount();
  const channelSave = useUpdateAccount();
  const toast = useToast();
  const [selected, setSelected] = useState<PacingNotifyDestinationV1 | null>(null);
  const [channelInput, setChannelInput] = useState("");
  const [channelResult, setChannelResult] = useState<SlackSaveResult | null>(null);
  // Whether channelInput has been seeded from the server for THIS opening yet - see the seeding
  // effect below for why this can't just be "account.data changed".
  const seededRef = useRef(false);

  // Clears everything the moment the modal closes, so a reopened modal never shows a pick, a
  // typed-but-unsaved group id, or a previous session's save result left over from before.
  useEffect(() => {
    if (open) return;
    setSelected(null);
    setChannelInput("");
    setChannelResult(null);
    seededRef.current = false;
  }, [open]);

  // Seeds channelInput from the server value exactly ONCE per opening, the first moment it is
  // available after `open` flips true (account.data may still be the previous session's stale
  // value, or briefly absent, right when this component appears - useAccount only starts fetching
  // once `open` is true). This is deliberately NOT keyed on every `account.data` change: both
  // saveChannel and pick() write a fresh account object into the query cache on success
  // (queryClient.setQueryData), and re-seeding on THAT change would immediately overwrite
  // channelInput's own optimistic post-save value and, worse, wipe channelResult's just-set
  // message - the save stomping its own result. `selected` needs no equivalent seed: it starts
  // null on open and `current` below already falls back to account.data live, since nothing is
  // ever typed into a segmented control the way text is typed into channelInput.
  useEffect(() => {
    if (!open || seededRef.current || !account.data) return;
    seededRef.current = true;
    setChannelInput(account.data.slackChannelId ?? "");
  }, [open, account.data]);

  const current = selected ?? account.data?.notifyDestination ?? null;
  const savedChannelId = account.data?.slackChannelId ?? "";

  async function pick(value: PacingNotifyDestinationV1) {
    if (value === current || destinationSave.isPending) return;
    const previous = current;
    setSelected(value); // optimistic - the segmented control reflects the pick immediately
    try {
      // Round-trips the SERVER's own slackChannelId, never whatever may be sitting unsaved in
      // channelInput - this save must never push a draft the person has not asked to save.
      await destinationSave.mutateAsync({ notifyDestination: value, slackChannelId: savedChannelId });
    } catch (error) {
      // Never leave the UI claiming a preference that did not persist.
      setSelected(previous);
      toast.showError(formatError(error));
    }
  }

  async function saveChannel() {
    const trimmed = channelInput.trim();
    if (trimmed === savedChannelId || channelSave.isPending) return;
    setChannelResult(null);
    try {
      // "auto" literally, not `current`: this action only exists while the Auto segment is
      // selected (see the field's own conditional render below), so that is always the value to
      // round-trip.
      const result = await channelSave.mutateAsync({ notifyDestination: "auto", slackChannelId: trimmed });
      setChannelInput(result.slackChannelId);
      setChannelResult(
        result.slackWarning
          ? { kind: "warning", message: result.slackWarning }
          : { kind: "success", message: trimmed ? "Saved." : "Cleared - your summary will go to your DM." }
      );
    } catch (error) {
      setChannelResult({ kind: "error", message: formatError(error) });
    }
  }

  const activeHint = NOTIFY_OPTIONS.find((option) => option.value === current)?.hint ?? "";
  const disabled = account.isPending || destinationSave.isPending;
  const channelUnchanged = channelInput.trim() === savedChannelId;

  return (
    <Modal open={open} onClose={onClose} title="Account Settings" className="acct-settings">
      <section className="acct-settings__section">
        <h4 className="acct-settings__heading">Appearance</h4>
        <div className="acct-settings__seg-row">
          <SegmentedControl ariaLabel="Theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
        </div>
      </section>

      <section className="acct-settings__section">
        <h4 className="acct-settings__heading">Daily Summary</h4>
        <div className="acct-settings__seg-row">
          <SegmentedControl
            ariaLabel="Daily Summary delivery"
            options={NOTIFY_OPTIONS}
            value={current}
            disabled={disabled}
            onChange={pick}
          />
          <span className={cn("acct-settings__saving", destinationSave.isPending && "acct-settings__saving--visible")}>
            <LoadingSpinner size="sm" label={destinationSave.isPending ? "Saving" : undefined} />
          </span>
        </div>
        <p className="acct-settings__hint">{activeHint}</p>

        {current === "auto" && (
          <div className="acct-settings__slack">
            <label className="acct-settings__slack-label" htmlFor="acct-settings-slack-channel">
              Your Slack group
            </label>
            <input
              id="acct-settings-slack-channel"
              type="text"
              value={channelInput}
              onChange={(event) => setChannelInput(event.target.value)}
              placeholder="e.g. G0123456789"
              disabled={account.isPending || channelSave.isPending}
              autoComplete="off"
            />
            <p className="acct-settings__slack-hint">
              From the group&rsquo;s &ldquo;Copy link&rdquo; in Slack &ndash; the C&hellip;/G&hellip; at the end of that
              URL. Leave empty to just use your DM.
            </p>
            <div className="acct-settings__slack-actions">
              <button
                type="button"
                className="button button--sm"
                onClick={saveChannel}
                disabled={channelUnchanged || channelSave.isPending}
              >
                {channelSave.isPending ? "Saving…" : "Save"}
              </button>
            </div>
            <p
              className={cn(
                "acct-settings__slack-result",
                channelResult && `acct-settings__slack-result--${channelResult.kind}`
              )}
            >
              {channelResult?.message ?? ""}
            </p>
          </div>
        )}
      </section>
    </Modal>
  );
}
