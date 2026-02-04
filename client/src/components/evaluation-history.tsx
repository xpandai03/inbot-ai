import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import type { EvaluationEntry } from "@shared/schema";

interface EvaluationHistoryProps {
  evaluations: EvaluationEntry[];
}

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "-";
  try {
    return new Date(ts).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return ts;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "applied":
      return <Badge className="text-[9px] px-1.5 py-0 bg-green-600/80 text-white">applied</Badge>;
    case "candidate":
      return <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-blue-500/50 text-blue-600">candidate</Badge>;
    case "superseded":
      return <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-gray-400/50 text-gray-500">superseded</Badge>;
    default:
      return <Badge variant="outline" className="text-[9px] px-1.5 py-0">{status}</Badge>;
  }
}

function typeBadge(type: string) {
  return type === "initial" ? (
    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">initial</Badge>
  ) : (
    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 border-purple-500/30 text-purple-600 bg-purple-50">re-evaluation</Badge>
  );
}

export function EvaluationHistory({ evaluations }: EvaluationHistoryProps) {
  if (evaluations.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">No evaluation history available.</p>
    );
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      {evaluations.map((ev) => (
        <AccordionItem key={ev.id} value={ev.id}>
          <AccordionTrigger className="text-xs py-2 hover:no-underline">
            <div className="flex items-center gap-2 text-left">
              {typeBadge(ev.evaluationType)}
              {statusBadge(ev.status)}
              <span className="text-muted-foreground">{formatTimestamp(ev.createdAt)}</span>
              {ev.appliedBy && ev.appliedBy !== "system" && (
                <span className="text-muted-foreground">by {ev.appliedBy}</span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs pl-1">
              <div>
                <span className="text-muted-foreground">Name:</span>{" "}
                <span className="text-foreground">{ev.candidateName || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Address:</span>{" "}
                <span className="text-foreground">{ev.candidateAddress || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Intent:</span>{" "}
                <span className="text-foreground">{ev.candidateIntent || "-"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Department:</span>{" "}
                <span className="text-foreground">{ev.candidateDepartment || "-"}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">Summary:</span>{" "}
                <span className="text-foreground">{ev.candidateSummary || "-"}</span>
              </div>
              {ev.extractionMeta && Object.keys(ev.extractionMeta).length > 0 && (
                <div className="col-span-2 mt-1">
                  <span className="text-muted-foreground">Extraction meta:</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {Object.entries(ev.extractionMeta).map(([k, v]) => (
                      <Badge
                        key={k}
                        variant="outline"
                        className="text-[9px] px-1 py-0 font-mono"
                      >
                        {k}: {String(v)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {ev.appliedAt && (
                <div className="col-span-2 mt-1">
                  <span className="text-muted-foreground">Applied:</span>{" "}
                  <span className="text-foreground">
                    {formatTimestamp(ev.appliedAt)} by {ev.appliedBy || "system"}
                  </span>
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
