import { useState } from "react";
import { X } from "lucide-react";
import { deleteDevice, testDevice, updateDevice } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KIND_LABELS, formatResultValue, statusVariant } from "@/features/format";
import { useMonitor } from "@/state/MonitorContext";
import type { LiveDevice, ResultOut } from "@/types";

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const detail = (err as { detail?: unknown }).detail;
    return typeof detail === "string" ? detail : err.message;
  }
  return String(err);
}

function ResultsTable({ results }: { results: ResultOut[] | null | undefined }) {
  if (!results || results.length === 0) return <p className="text-sm text-muted-foreground">No results yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-1 pr-2 font-medium">Check</th>
          <th className="py-1 pr-2 font-medium">Result</th>
          <th className="py-1 pr-2 text-right font-medium">Latency</th>
          <th className="py-1 font-medium">Detail</th>
        </tr>
      </thead>
      <tbody>
        {results.map((r, i) => (
          <tr key={`${r.check_id ?? r.type}-${i}`} className="border-b last:border-0">
            <td className="py-1 pr-2">{r.label}</td>
            <td className="py-1 pr-2">
              <StatusBadge tone={r.ok ? "success" : "danger"}>{r.ok ? "OK" : "FAIL"}</StatusBadge>
            </td>
            <td className="py-1 pr-2 text-right font-mono">
              {r.latency_ms == null ? "-" : `${Math.round(r.latency_ms)} ms`}
            </td>
            <td className="py-1">{r.reason ?? formatResultValue(r.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Props = {
  device: LiveDevice;
  onClose: () => void;
  onEdit: (device: LiveDevice) => void;
};

export default function DeviceDetail({ device, onClose, onEdit }: Props) {
  const { dispatch, reload } = useMonitor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<ResultOut[] | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const togglePause = () =>
    run(async () => {
      await updateDevice(device.id, { enabled: !device.enabled });
      await reload();
    });

  const onTest = () =>
    run(async () => {
      setTested(await testDevice(device.id));
    });

  const onDelete = () => {
    if (!window.confirm(`Delete ${device.name}? Its checks are removed too.`)) return;
    void run(async () => {
      await deleteDevice(device.id);
      dispatch({ type: "DEVICE_REMOVED", id: device.id });
      onClose();
      await reload();
    });
  };

  const facts: [string, React.ReactNode, string?][] = [
    ["Host", device.host, "font-mono"],
    ["Kind", KIND_LABELS[device.kind] ?? device.kind],
    [
      "Liveness",
      `${device.liveness === "tcp" ? `TCP port ${device.liveness_port}` : "Ping"}, every ${device.interval_s}s, down after ${device.fail_threshold} failures, ${device.timeout_ms} ms timeout`,
    ],
  ];
  if (device.notes) facts.push(["Notes", device.notes]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined} onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {device.name}
            <StatusBadge tone={statusVariant(device.status)}>{device.status}</StatusBadge>
          </DialogTitle>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button size="icon-xs" variant="ghost" aria-label="Close alert" onClick={() => setError(null)}>
                <X aria-hidden="true" />
              </Button>
            </AlertAction>
          </Alert>
        )}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {facts.map(([term, value, cls]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className={cls}>{value}</dd>
            </div>
          ))}
        </dl>
        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Latest results</h3>
          <ResultsTable results={device.results} />
        </section>
        {tested && (
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Test now</h3>
            <ResultsTable results={tested} />
          </section>
        )}
        <DialogFooter className="sm:justify-between">
          <Button variant="destructive" onClick={onDelete} disabled={busy}>
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onEdit(device)} disabled={busy}>
              Edit
            </Button>
            <Button variant="outline" onClick={togglePause} disabled={busy}>
              {device.enabled ? "Pause" : "Resume"}
            </Button>
            <Button onClick={onTest} disabled={busy}>
              {busy ? "Working..." : "Test now"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
