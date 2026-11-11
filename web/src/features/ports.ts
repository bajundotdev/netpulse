import type { CheckIn, CheckOut, ResultOut, TcpCheckOut } from "@/types";

export const DC_PRESET_PORTS = [53, 88, 135, 389, 445, 636, 3268, 3389];

export function parsePort(text: string): number | null {
  const s = String(text).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? n : null;
}

export const PORT_ERROR = "Enter a whole number from 1 to 65535";

// Folds the text still in the "Add TCP port" box into the port list: blank is ignored, a valid
// port is added, anything else is an error that must block saving.
export function withPendingPort(ports: number[], text: string): { ports: number[]; error: string | null } {
  if (String(text).trim() === "") return { ports, error: null };
  const port = parsePort(text);
  if (port === null) return { ports, error: PORT_ERROR };
  return { ports: mergePorts(ports, [port]), error: null };
}

export function mergePorts(existing: number[], added: number[]): number[] {
  return [...new Set([...existing, ...added])].sort((a, b) => a - b);
}

export function portsOf(checks: CheckOut[] | null | undefined): number[] {
  return mergePorts(
    [],
    (checks ?? []).flatMap((c) => (c.type === "tcp" ? [c.params.port] : [])),
  );
}

export function diffChecks(original: CheckOut[], ports: number[]): { add: number[]; remove: TcpCheckOut[] } {
  const tcp = original.filter((c): c is TcpCheckOut => c.type === "tcp");
  const have = new Set(tcp.map((c) => c.params.port));
  const want = new Set(ports);
  return {
    add: ports.filter((p) => !have.has(p)),
    remove: tcp.filter((c) => !want.has(c.params.port)),
  };
}

// Finds the latest result for a tcp check: by check_id, falling back to the tcp/<port> label.
export function resultFor(
  check: Pick<TcpCheckOut, "id" | "params">,
  results: ResultOut[] | null | undefined,
): ResultOut | null {
  const list = results ?? [];
  return (
    list.find((r) => r.check_id === check.id) ??
    list.find((r) => r.check_id == null && r.label === `tcp/${check.params.port}`) ??
    null
  );
}

// An error thrown by applyPortChanges / applySnmpChanges: `baseline` is the checks as they now
// stand on the server, so a retry diffs against the real state.
export type BaselineError = Error & { baseline?: CheckOut[] };

export function attachBaseline(err: unknown, baseline: CheckOut[]): unknown {
  if (err instanceof Error) (err as BaselineError).baseline = baseline;
  return err;
}

export interface CheckApi {
  addCheck: (deviceId: number, body: CheckIn) => Promise<CheckOut>;
  updateCheck: (id: number, body: CheckIn) => Promise<CheckOut>;
  deleteCheck: (id: number) => Promise<unknown>;
}

// Applies the port diff one call at a time. On failure the thrown error carries `baseline`.
export async function applyPortChanges(
  deviceId: number,
  baseline: CheckOut[],
  ports: number[],
  api: Pick<CheckApi, "addCheck" | "deleteCheck">,
): Promise<CheckOut[]> {
  let working = [...baseline];
  const { add, remove } = diffChecks(working, ports);
  try {
    for (const port of add) {
      const created = await api.addCheck(deviceId, { type: "tcp", params: { port }, enabled: true });
      working = [...working, created];
    }
    for (const check of remove) {
      await api.deleteCheck(check.id);
      working = working.filter((c) => c.id !== check.id);
    }
  } catch (err) {
    throw attachBaseline(err, working);
  }
  return working;
}
