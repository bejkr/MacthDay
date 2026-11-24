import { cn } from "@/lib/format";

type Props = {
  nickname: string;
  avatarUrl?: string | null;
  color?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  jerseyNumber?: number | null;
  dimmed?: boolean;
  className?: string;
};

const SIZE = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-xl",
  xl: "size-24 text-4xl",
};

function initials(nickname: string) {
  const parts = nickname.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : nickname.trim().slice(0, 2);
  return letters.toLocaleUpperCase("sk");
}

export function PlayerAvatar({ nickname, avatarUrl, color = "#78C95A", size = "md", jerseyNumber, dimmed, className }: Props) {
  return (
    <span className={cn("relative inline-flex shrink-0", dimmed && "opacity-50", className)}>
      {avatarUrl ? (
        // Avatary sú malé, už zmenšené JPEG-y z vlastného úložiska – optimalizátor obrázkov netreba.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn("rounded-full object-cover ring-1 ring-line-strong", SIZE[size])}
        />
      ) : (
        <span
          aria-hidden
          className={cn("display flex items-center justify-center rounded-full text-bg", SIZE[size])}
          style={{ backgroundColor: color }}
        >
          {initials(nickname)}
        </span>
      )}
      {jerseyNumber != null && (size === "lg" || size === "xl") ? (
        <span className="num absolute -right-1 -bottom-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-bg bg-elevated px-1 text-xs text-ink">
          {jerseyNumber}
        </span>
      ) : null}
    </span>
  );
}
