import { Badge } from "@/components/ui/badge";
import type { Scope } from "@/lib/api";

export function ScopeBadges({ scopes }: { scopes: readonly Scope[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {scopes.map((scope) => (
        <Badge key={scope} variant="outline" translate="no" className="font-mono">
          {scope}
        </Badge>
      ))}
    </span>
  );
}
