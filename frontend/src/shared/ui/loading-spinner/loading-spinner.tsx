import { cn } from "../../style/cn";
import "./loading-spinner.css";

interface LoadingSpinnerProps {
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingSpinner({ label, size = "md", className }: LoadingSpinnerProps) {
  return (
    <span
      className={cn("loading-spinner", `loading-spinner--${size}`, className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="loading-spinner__ring" />
    </span>
  );
}

export function LoadingBlock({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("loading-block", className)}>
      <LoadingSpinner label={label} size="lg" />
    </div>
  );
}

export function LoadingOverlay({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("loading-overlay", className)}>
      <LoadingSpinner label={label} size="md" />
    </div>
  );
}
