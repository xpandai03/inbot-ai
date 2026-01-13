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
        <div className="p-12 flex items-center justify-center">
          <div className="space-y-3 text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Loading records...</p>
          </div>
        </div>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="rounded-lg border border-card-border bg-card/50 overflow-hidden">
        <div className="p-12 flex items-center justify-center">
          <div className="space-y-2 text-center">
            <p className="text-sm font-medium text-foreground">No records found</p>
            <p className="text-sm text-muted-foreground">
              Records will appear here when intake data is received.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const formatTimestamp = (timestamp: string) => {
    try {
      return format(parseISO(timestamp), "MMM d, yyyy h:mm a");
    } catch {
      return timestamp;
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="rounded-lg border border-card-border bg-card/50 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-card-border">
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
              Name
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
              Phone
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
              Address
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
              Intent
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
              Department
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
              Channel
            </TableHead>
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
              Duration
            </TableHead>
            {showCost && (
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
                Cost
              </TableHead>
            )}
            <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground px-6 py-4">
              Timestamp
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow 
              key={record.id} 
              className="border-b border-card-border last:border-0 hover-elevate"
              data-testid={`row-record-${record.id}`}
            >
              <TableCell className="px-6 py-4 font-medium text-foreground">
                {record.name}
              </TableCell>
              <TableCell className="px-6 py-4 text-sm text-muted-foreground tabular-nums">
                {record.phone || (record.channel === "Voice" ? "(Web Call)" : "-")}
              </TableCell>
              <TableCell className="px-6 py-4 text-muted-foreground text-sm max-w-[200px] truncate">
                {record.address}
              </TableCell>
              <TableCell className="px-6 py-4">
                <Badge variant="secondary" className="text-xs font-normal">
                  {record.intent}
                </Badge>
              </TableCell>
              <TableCell className="px-6 py-4 text-sm text-foreground">
                {record.department}
              </TableCell>
              <TableCell className="px-6 py-4">
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {record.channel === "Voice" ? (
                    <Phone className="w-3.5 h-3.5" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5" />
                  )}
                  {record.channel}
                </div>
              </TableCell>
              <TableCell className="px-6 py-4 text-sm text-muted-foreground tabular-nums">
                {formatDuration(record.durationSeconds)}
              </TableCell>
              {showCost && (
                <TableCell className="px-6 py-4 text-sm text-foreground tabular-nums">
                  ${record.cost.toFixed(2)}
                </TableCell>
              )}
              <TableCell className="px-6 py-4 text-sm text-muted-foreground">
                {formatTimestamp(record.timestamp)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
