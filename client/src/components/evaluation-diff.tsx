import { Badge } from "@/components/ui/badge";

interface DiffField {
  current: string;
  candidate: string;
  changed: boolean;
}

interface DiffResult {
  name: DiffField;
  address: DiffField;
  intent: DiffField;
  department: DiffField;
  summary: DiffField;
}

interface EvaluationDiffProps {
  diff: DiffResult;
}

const FIELD_LABELS: Record<keyof DiffResult, string> = {
  name: "Name",
  address: "Address",
  intent: "Intent",
  department: "Department",
  summary: "Summary",
};

export function EvaluationDiff({ diff }: EvaluationDiffProps) {
  const fields = Object.entries(diff) as [keyof DiffResult, DiffField][];
  const changedCount = fields.filter(([, f]) => f.changed).length;

  if (changedCount === 0) {
    return (
      <div className="rounded border border-card-border bg-muted/30 p-4 text-center">
        <p className="text-sm text-muted-foreground">No changes detected. The re-evaluation produced the same values.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {changedCount} field{changedCount > 1 ? "s" : ""} changed
      </p>
      <div className="rounded border border-card-border divide-y divide-card-border">
        {fields.map(([key, field]) => (
          <div
            key={key}
            className={`grid grid-cols-[100px_1fr_1fr] gap-2 px-3 py-2 text-xs ${
              field.changed ? "bg-yellow-500/5" : ""
            }`}
          >
            <div className="font-medium text-muted-foreground flex items-start gap-1">
              {FIELD_LABELS[key]}
              {field.changed && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 border-yellow-500/50 text-yellow-600"
                >
                  changed
                </Badge>
              )}
            </div>
            <div className={`${field.changed ? "line-through text-muted-foreground" : "text-foreground"} break-words`}>
              {field.current || "(empty)"}
            </div>
            <div className={`${field.changed ? "text-foreground font-medium" : "text-muted-foreground"} break-words`}>
              {field.candidate || "(empty)"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
