import { Box, Globe, Network, Printer, Server, ServerCog, type LucideIcon } from "lucide-react";
import type { DeviceKind } from "@/types";

const ICONS: Record<DeviceKind, LucideIcon> = {
  dc: ServerCog,
  server: Server,
  switch: Network,
  printer: Printer,
  other: Box,
  web: Globe,
};

export default function KindIcon({ kind }: { kind: DeviceKind }) {
  const Icon = ICONS[kind] ?? Box;
  return (
    <span
      className="inline-flex size-8 shrink-0 items-center justify-center rounded border text-muted-foreground"
      aria-hidden="true"
    >
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}
