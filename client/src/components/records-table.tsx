import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Phone, MessageSquare } from "lucide-react";
import type { IntakeRecord } from "@shared/schema";
import { format, parseISO } from "date-fns";

interface RecordsTableProps {
  records: IntakeRecord[];
  showCost?: boolean;
  isLoading?: boolean;
}

export function RecordsTable({ records, showCost = false, isLoading = false }: RecordsTableProps) {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-card-border bg-card/50 overflow-hidden">
        <div className="p-8 flex items-center justify-center">
          <div className="space-y-2 text-center">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-muted-foreground">Loading records...</p>
          </div>
        </div>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-card-border bg-card/50 overflow-hidden">
        <div className="p-8 flex items-center justify-center">
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-foreground">No records found</p>
            <p className="text-xs text-muted-foreground">
              Records will appear here when intake data is received.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const formatTimestamp = (timestamp: string) => {
    try {
      return format(parseISO(timestamp), "M/d h:mm a");
    } catch {
      return timestamp;
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Common header class for consistency
  const headerClass = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2 whitespace-nowrap";
  const cellClass = "px-2 py-2";

  return (
    <div className="rounded-lg border border-card-border bg-card/50 overflow-hidden">
      <Table className="text-sm">
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-card-border">
            <TableHead className={headerClass}>Name</TableHead>
            <TableHead className={headerClass}>Phone</TableHead>
            <TableHead className={headerClass}>Address</TableHead>
            <TableHead className={headerClass}>Intent</TableHead>
            <TableHead className={headerClass}>Dept</TableHead>
            <TableHead className={`${headerClass} text-center`} title="Channel">Ch</TableHead>
            <TableHead className={`${headerClass} text-right`}>Dur</TableHead>
            {showCost && (
              <TableHead className={`${headerClass} text-right`}>Cost</TableHead>
            )}
            <TableHead className={headerClass}>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow 
              key={record.id} 
              className="border-b border-card-border/50 last:border-0 hover:bg-muted/30"
              data-testid={`row-record-${record.id}`}
            >
              <TableCell className={`${cellClass} font-medium text-foreground max-w-[120px] truncate`}>
                {record.name}
              </TableCell>
              <TableCell className={`${cellClass} text-xs text-muted-foreground tabular-nums`}>
                {record.phone || (record.channel === "Voice" ? "(Web)" : "-")}
              </TableCell>
              <TableCell className={`${cellClass} text-xs text-muted-foreground max-w-[140px] truncate`} title={record.address}>
                {record.address}
              </TableCell>
              <TableCell className={cellClass}>
                {record.intent === "Pending" ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal animate-pulse border-yellow-500/50 text-yellow-600">
                    ...
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal whitespace-nowrap">
                    {record.intent}
                  </Badge>
                )}
              </TableCell>
              <TableCell className={`${cellClass} text-xs text-foreground max-w-[100px] truncate`} title={record.department}>
                {record.department === "Pending" ? (
                  <span className="text-muted-foreground italic">...</span>
                ) : (
                  record.department
                )}
              </TableCell>
              <TableCell className={`${cellClass} text-center`} title={record.channel}>
                {record.channel === "Voice" ? (
                  <Phone className="w-3.5 h-3.5 text-muted-foreground mx-auto" />
                ) : (
                  <MessageSquare className="w-3.5 h-3.5 text-muted-foreground mx-auto" />
                )}
              </TableCell>
              <TableCell className={`${cellClass} text-xs text-muted-foreground tabular-nums text-right`}>
                {formatDuration(record.durationSeconds)}
              </TableCell>
              {showCost && (
                <TableCell className={`${cellClass} text-xs text-foreground tabular-nums text-right`}>
                  ${record.cost.toFixed(2)}
                </TableCell>
              )}
              <TableCell className={`${cellClass} text-xs text-muted-foreground whitespace-nowrap`}>
                {formatTimestamp(record.timestamp)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
