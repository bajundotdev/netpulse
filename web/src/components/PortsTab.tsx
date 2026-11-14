import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/Field";
import { Input } from "@/components/ui/input";
import { DC_PRESET_PORTS, mergePorts, withPendingPort } from "@/features/ports";

type Props = {
  ports: number[];
  onChange: (ports: number[]) => void;
  text: string;
  onTextChange: (text: string) => void;
  error: string | null;
  onErrorChange: (error: string | null) => void;
};

// `text`/`error` live in DeviceForm so Save can pick up a port that was typed but not added.
export default function PortsTab({ ports, onChange, text, onTextChange, error, onErrorChange }: Props) {
  const add = () => {
    const next = withPendingPort(ports, text);
    onErrorChange(next.error);
    if (next.error || next.ports === ports) return;
    onTextChange("");
    onChange(next.ports);
  };

  return (
    <div className="grid gap-3">
      <Field id="device-port-add" label="Add TCP port" error={error}>
        <div className="flex gap-2">
          <Input
            id="device-port-add"
            inputMode="numeric"
            value={text}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "device-port-add-error" : undefined}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={add}>
            Add
          </Button>
        </div>
      </Field>
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(mergePorts(ports, DC_PRESET_PORTS))}>
          Domain Controller preset
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {ports.length === 0 && <span className="text-sm text-muted-foreground">No ports monitored.</span>}
        {ports.map((p) => (
          <Badge key={p} variant="secondary" className="h-6 gap-1 pr-1 font-mono text-sm">
            {p}
            <button
              type="button"
              aria-label={`Remove port ${p}`}
              className="rounded-full p-0.5 hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              onClick={() => onChange(ports.filter((x) => x !== p))}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </Badge>
        ))}
      </div>
    </div>
  );
}
