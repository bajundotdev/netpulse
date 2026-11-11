import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import type { Variant } from "@/features/format";
import { cn } from "@/lib/utils";

// Status colours: one place for the pill (and the card border / sparkline tones below).
export const statusBadge = cva("", {
  variants: {
    tone: {
      success: "bg-emerald-500 text-white",
      warning: "bg-amber-500 text-black",
      danger: "bg-red-500 text-white",
      secondary: "bg-zinc-500 text-white",
    } satisfies Record<Variant, string>,
  },
  defaultVariants: { tone: "secondary" },
});

export const STATUS_RING: Record<Variant, string> = {
  success: "ring-2 ring-emerald-500",
  warning: "ring-2 ring-amber-500",
  danger: "ring-2 ring-red-500",
  secondary: "ring-2 ring-zinc-400",
};

export const STATUS_TEXT: Record<Variant, string> = {
  success: "text-emerald-500",
  warning: "text-amber-500",
  danger: "text-red-500",
  secondary: "text-zinc-500",
};

type Props = Omit<ComponentProps<typeof Badge>, "variant"> & { tone: Variant };

export default function StatusBadge({ tone, className, ...props }: Props) {
  return <Badge className={cn(statusBadge({ tone }), className)} {...props} />;
}
