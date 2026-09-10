/**
 * Status change control (§9 of the migration plan, US-128): Live, Paused, Complete or Archive. A
 * plain passthrough to Pacing's own status endpoint - no business rule here about which transitions
 * are allowed, since Pacing itself does not have one either (any status can move to any other).
 */
import { useState } from "react";
import { formatError } from "../../shared/format/error";
import { StatusBadge } from "../../shared/ui/status-badge/status-badge";
import { PACING_STATUS_STYLE } from "../pacing-overview/format";
import { useUpdatePacingStatus } from "./hooks";
import type { PacingLifecycleStatus } from "./types";

const STATUSES: PacingLifecycleStatus[] = ["Live", "Paused", "Complete", "Archive"];

export function StatusControl({ pacingId, status }: { pacingId: string; status: string }) {
  const mutation = useUpdatePacingStatus();
  const [error, setError] = useState<string | null>(null);
  const style = PACING_STATUS_STYLE[status] ?? { color: "var(--muted)" };

  async function handleChange(next: PacingLifecycleStatus) {
    if (next === status) return;
    setError(null);
    try {
      await mutation.mutateAsync({ pacingId, status: next });
    } catch (err) {
      setError(formatError(err));
    }
  }

  return (
    <div className="pplan__status-control">
      <StatusBadge label={status} color={style.color} glow={style.glow} />
      <span className="select pplan__status-select">
        <select
          aria-label="Change pacing status"
          value={status}
          disabled={mutation.isPending}
          onChange={(e) => void handleChange(e.target.value as PacingLifecycleStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </span>
      {error && <span className="form-error pplan__status-error">{error}</span>}
    </div>
  );
}
