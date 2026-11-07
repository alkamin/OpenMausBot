// Adapted from T3 Code, Copyright (c) 2026 T3 Tools Inc., MIT licensed.
import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import { ChevronRight, Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CalloutKind } from "@/lib/response-components";

const CALLOUTS = {
  NOTE: { Icon: Info, color: "text-accent border-accent/50", label: "chat.callout.note" },
  TIP: { Icon: Lightbulb, color: "text-success border-success/50", label: "chat.callout.tip" },
  IMPORTANT: { Icon: MessageSquareWarning, color: "text-purple-500 border-purple-500/70", label: "chat.callout.important" },
  WARNING: { Icon: TriangleAlert, color: "text-warning border-warning/50", label: "chat.callout.warning" },
  CAUTION: { Icon: OctagonAlert, color: "text-danger border-danger/50", label: "chat.callout.caution" },
} as const;

export function ResponseCallout({ kind, children, direction }: { kind: CalloutKind; children: ReactNode; direction: "ltr" | "rtl" }) {
  const { Icon, color, label } = CALLOUTS[kind];
  return (
    <aside role="note" dir={direction} data-response-callout={kind} className={cn("my-1 min-w-0 border-s-2 ps-3", color)}>
      <p className="flex items-center gap-1.5 font-medium"><Icon aria-hidden="true" size={14} className="shrink-0" />{t(label)}</p>
      <div className="space-y-2 text-ink">{children}</div>
    </aside>
  );
}

export function ResponseDetails({ children, open = false }: Pick<ComponentProps<"details">, "children" | "open">) {
  const nodes = Children.toArray(children);
  const summaryIndex = nodes.findIndex((node) => isValidElement(node) && node.type === "summary");
  const summary = nodes[summaryIndex];
  return (
    <details open={open} data-response-details className="my-2 min-w-0 border-y border-hairline/60 [&[open]>summary>svg]:rotate-90">
      <summary className="flex min-h-11 w-full cursor-pointer list-none items-center gap-2 py-2 text-start text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ink-secondary" />
        <span dir="auto">{isValidElement<{ children?: ReactNode }>(summary) ? summary.props.children : t("chat.responseDetails")}</span>
      </summary>
      <div className="pb-3 ps-6 text-ink/90">{nodes.filter((_, index) => index !== summaryIndex)}</div>
    </details>
  );
}
