import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { MAUS_COLOR_NAMES, normalizeState, type MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";

function isPaletteColor(color: string): color is MausColor {
  return (MAUS_COLOR_NAMES as readonly string[]).includes(color);
}

export function ClusterLabel({ bot, name, color, detail, className }: { bot?: Bot; name: string; color: string; detail?: string; className?: string }) {
  const authorColor = bot?.color ?? color;
  const known = isPaletteColor(authorColor);
  return (
    <div data-bot-author={bot?.id ?? name} className={cn("mb-2 flex min-w-0 items-center gap-2 px-0.5", className)}>
      <BotAvatar
        bot={bot ?? { name, color: known ? authorColor : "blue" }}
        state={normalizeState(bot?.mascotExpression) ?? "happy"}
        size={24}
        motion="none"
        motionKey={0}
        animated={false}
        readable={known}
      />
      <span
        className={cn("truncate text-[13px] font-semibold", known ? "bot-identity" : "text-ink-secondary")}
        data-bot-color={known ? authorColor : undefined}
      >{name}</span>
      {detail && <span className="min-w-0 truncate text-[12px] text-ink-secondary">· {detail}</span>}
    </div>
  );
}
