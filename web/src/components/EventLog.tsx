import { useState } from "react";
import { X } from "lucide-react";
import { ackEvent, clearEvents } from "@/api/client";
import { NativeSelect, OPTION } from "@/components/Field";
import StatusBadge from "@/components/StatusBadge";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { formatEventTime, severityVariant } from "@/features/format";
import { cn } from "@/lib/utils";
import { useMonitor } from "@/state/MonitorContext";

export default function EventLog() {
  const { state, dispatch } = useMonitor();
  const [deviceFilter, setDeviceFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const events = state.events.filter(
    (e) =>
      (deviceFilter === "" || String(e.device_id) === deviceFilter) &&
      (severityFilter === "" || e.severity === severityFilter),
  );

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  const onAck = async (id: number) => {
    try {
      await ackEvent(id);
      dispatch({ type: "EVENT_ACKED", id });
    } catch (err) {
      fail(err);
    }
  };

  const onClear = async () => {
    if (!window.confirm("Clear the whole event log? This cannot be undone.")) return;
    try {
      await clearEvents();
      dispatch({ type: "EVENTS_CLEARED" });
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-wrap items-center gap-2 border-b py-3">
        <strong className="mr-auto">Event log</strong>
        <NativeSelect
          className="w-auto"
          aria-label="Filter by device"
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value)}
        >
          <option value="" className={OPTION}>
            All devices
          </option>
          {state.order.map((id) => (
            <option key={id} value={id} className={OPTION}>
              {state.devices[id]?.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-auto"
          aria-label="Filter by severity"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="" className={OPTION}>
            All severities
          </option>
          <option value="info" className={OPTION}>
            Info
          </option>
          <option value="warning" className={OPTION}>
            Warning
          </option>
          <option value="critical" className={OPTION}>
            Critical
          </option>
        </NativeSelect>
        <Button size="sm" variant="destructive" onClick={onClear} disabled={state.events.length === 0}>
          Clear
        </Button>
      </CardHeader>
      {error && (
        <Alert variant="destructive" className="m-2 w-auto">
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button size="icon-xs" variant="ghost" aria-label="Close alert" onClick={() => setError(null)}>
              <X aria-hidden="true" />
            </Button>
          </AlertAction>
        </Alert>
      )}
      <div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {events.length === 0 && (
              <tr>
                <td className="p-3 text-muted-foreground">No events.</td>
              </tr>
            )}
            {events.map((e) => (
              <tr
                key={e.id}
                className={cn("border-b last:border-0 hover:bg-muted/50", e.acknowledged && "text-muted-foreground")}
              >
                <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{formatEventTime(e.ts)}</td>
                <td className="py-1.5 pr-2">
                  <StatusBadge tone={severityVariant(e.severity)}>{e.severity}</StatusBadge>
                </td>
                <td className="py-1.5 pr-2">{e.message}</td>
                <td className="py-1.5 pr-3 text-right">
                  {!e.acknowledged && (
                    <Button size="xs" variant="outline" onClick={() => void onAck(e.id)}>
                      Ack
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
