import type { ReactNode } from "react";

const segment =
  "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-full border border-transparent px-3 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-input aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-xs";

export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly (readonly [T, ReactNode])[];
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-[18px] bg-muted p-[3px]">
      {options.map(([option, text]) => (
        <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)} className={segment}>
          {text}
        </button>
      ))}
    </div>
  );
}
