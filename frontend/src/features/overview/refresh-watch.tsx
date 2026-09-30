import { useEffect, useState } from "react";
import { useRefreshStatus } from "../pacing-dashboard/hooks";

/**
 * Watches ONE just-triggered refresh until its build lands, then re-pulls the pacing lists so the
 * row's figures update without a reload. Renders nothing.
 *
 * Mounted per refreshed pacing and only then — the Overview must never run a status poller for rows
 * nobody refreshed. `useRefreshStatus` owns the mechanics (4s poll, 150s timeout, baseline on
 * `refreshId`); this only arms it once the first status read is in (the baseline has to be the
 * pre-build id) and reports back when the watch ends so the parent can unmount this.
 */
export function RefreshLandingWatch({ slug, onDone }: { slug: string; onDone: (slug: string) => void }) {
  const status = useRefreshStatus(slug);
  const [armed, setArmed] = useState(false);
  const { data, watching, startWatching, invalidateDashboard } = status;

  useEffect(() => {
    if (!armed && data) {
      startWatching();
      setArmed(true);
    }
    // startWatching is re-created per render but only captures stable refs/setters - arming once is
    // guarded by `armed`, so the loose identity cannot double-arm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, data]);

  useEffect(() => {
    if (armed && !watching) {
      // The watch ended: the build landed (refreshId moved) or the 150s timeout hit. Either way,
      // re-read the lists once and retire - on a timeout the data may still be old, but polling
      // forever would be worse, and the next manual refresh arms a fresh watch.
      invalidateDashboard();
      onDone(slug);
    }
    // Same identity reasoning as above; `armed && !watching` is the whole condition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, watching]);

  return null;
}
