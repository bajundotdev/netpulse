import type { ComponentProps, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Styled native select (same look as the sort control in DeviceToolbar).
export const NATIVE_SELECT =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(NATIVE_SELECT, className)} {...props}>
      {children}
    </select>
  );
}

export const OPTION = "bg-popover text-popover-foreground";

type ShellProps = { id: string; label: string; error?: string | null; className?: string; children: ReactNode };

// Label above the control, the server's message for it below.
export function Field({ id, label, error, className, children }: ShellProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const aria = (id: string, error?: string | null) => ({
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : undefined,
});

type TextFieldProps = { id: string; label: string; error?: string | null; fieldClassName?: string } & Omit<
  ComponentProps<"input">,
  "id"
>;

export function TextField({ id, label, error, fieldClassName, ...props }: TextFieldProps) {
  return (
    <Field id={id} label={label} error={error} className={fieldClassName}>
      <Input id={id} {...aria(id, error)} {...props} />
    </Field>
  );
}

type TextAreaFieldProps = { id: string; label: string; error?: string | null } & Omit<ComponentProps<"textarea">, "id">;

export function TextAreaField({ id, label, error, ...props }: TextAreaFieldProps) {
  return (
    <Field id={id} label={label} error={error}>
      <Textarea id={id} {...aria(id, error)} {...props} />
    </Field>
  );
}

type SelectFieldProps = { id: string; label: string; error?: string | null; fieldClassName?: string } & Omit<
  ComponentProps<"select">,
  "id"
>;

export function SelectField({ id, label, error, fieldClassName, children, ...props }: SelectFieldProps) {
  return (
    <Field id={id} label={label} error={error} className={fieldClassName}>
      <NativeSelect id={id} {...aria(id, error)} {...props}>
        {children}
      </NativeSelect>
    </Field>
  );
}

// Narrows a DOM string value to one of the allowed options without a cast.
export function pick<T extends string>(options: readonly T[], value: string, fallback: T): T {
  return options.find((o) => o === value) ?? fallback;
}
