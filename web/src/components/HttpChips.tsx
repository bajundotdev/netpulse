import StatusBadge from "@/components/StatusBadge";
import {
  certChipText,
  certDaysOf,
  certWarnDaysFor,
  httpChipText,
  resultForHttp,
  type ChipTone,
} from "@/features/http";
import type { Variant } from "@/features/format";
import type { HttpCheckOut, LiveDevice } from "@/types";

const TONES: Record<ChipTone, Variant> = {
  ok: "success",
  warn: "warning",
  bad: "danger",
  pending: "secondary",
  neutral: "secondary",
};

function Chip({ text, tone, title }: { text: string; tone: ChipTone; title?: string }) {
  return (
    <StatusBadge tone={TONES[tone]} className="max-w-full font-normal" title={title || undefined}>
      <span className="truncate">{text}</span>
    </StatusBadge>
  );
}

// Chips for a device's HTTP checks: name and result, plus the certificate when the result has one.
// A website's own liveness request contributes its certificate chip too.
export default function HttpChips({ device }: { device: LiveDevice }) {
  const checks = (device.checks ?? []).filter((c): c is HttpCheckOut => c.type === "http");
  const liveness =
    device.kind === "web" ? (device.results ?? []).find((r) => r.check_id == null && r.type === "http") : undefined;
  // Every certificate chip uses the server's event threshold for its host:port.
  const livenessCert = liveness
    ? certChipText(certDaysOf(liveness), certWarnDaysFor(device.checks, device.url))
    : null;
  if (checks.length === 0 && !livenessCert) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {livenessCert && <Chip {...livenessCert} />}
      {checks.map((check) => {
        const r = resultForHttp(check, device.results);
        const chip = httpChipText(check, r);
        const cert = r ? certChipText(certDaysOf(r), certWarnDaysFor(device.checks, check.params.url)) : null;
        return (
          <span key={check.id} className="contents">
            <Chip {...chip} />
            {cert && <Chip {...cert} />}
          </span>
        );
      })}
    </div>
  );
}
