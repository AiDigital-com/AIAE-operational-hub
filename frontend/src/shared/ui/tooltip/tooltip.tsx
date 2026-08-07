import type { ReactNode } from "react";
import { cn } from "../../style/cn";
import "./tooltip.css";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A CSS-only hover/focus tooltip. Wraps `children` and shows `content` in a small bubble above them -
 * used where a pill/tag truncates information (e.g. a "+N" overflow tag) that's worth surfacing on
 * hover without a click.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={cn("tooltip", className)}>
      {children}
      <span className="tooltip__bubble" role="tooltip">{content}</span>
    </span>
  );
}
