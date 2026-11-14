import { List, LayoutGrid } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SORT_OPTIONS } from "@/features/deviceView";
import type { SortKey, View } from "@/types";

type Props = {
  total: number;
  shown: number;
  query: string;
  onQuery: (query: string) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  view: View;
  onView: (view: View) => void;
};

export default function DeviceToolbar({ total, shown, query, onQuery, sort, onSort, view, onView }: Props) {
  const noun = total === 1 ? "device" : "devices";
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <Input
        type="search"
        className="max-w-sm min-w-48 flex-1"
        aria-label="Search devices"
        placeholder="Search name, IP, port, status"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />
      <select
        aria-label="Sort devices"
        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        value={sort}
        onChange={(e) => onSort(e.target.value as SortKey)}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key} className="bg-popover text-popover-foreground">
            {o.label}
          </option>
        ))}
      </select>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        value={view}
        onValueChange={(v) => v && onView(v as View)}
        aria-label="View"
      >
        <ToggleGroupItem value="list" aria-label="List view">
          <List aria-hidden="true" />
        </ToggleGroupItem>
        <ToggleGroupItem value="cards" aria-label="Card view">
          <LayoutGrid aria-hidden="true" />
        </ToggleGroupItem>
      </ToggleGroup>
      <span className="ml-auto text-sm text-muted-foreground">
        {shown === total ? `${total} ${noun}` : `Showing ${shown} of ${total}`}
      </span>
    </div>
  );
}
