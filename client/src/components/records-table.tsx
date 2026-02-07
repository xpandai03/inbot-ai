import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Phone, MessageSquare, Trash2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import type { IntakeRecord } from "@shared/schema";

function formatSmsConsent(smsConsent: boolean | null | undefined): string {
  if (smsConsent === true) return "Yes";
  if (smsConsent === false) return "No";
  return "Not collected";
}

interface RecordsTableProps {
  records: IntakeRecord[];
  showCost?: boolean;
  isLoading?: boolean;
  isSuperAdmin?: boolean;
}

export function RecordsTable({ records, showCost = false, isLoading = false, isSuperAdmin = false }: RecordsTableProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<IntakeRecord | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/records/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete record");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Record deleted",
        description: "The intake record has been permanently deleted.",
      });
      setDeleteDialogOpen(false);
      setRecordToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (record: IntakeRecord) => {
    setRecordToDelete(record);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (recordToDelete) {
      deleteMutation.mutate(recordToDelete.id);
    }
  };

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
      // Force Eastern Time for consistency with email notifications
      return new Date(timestamp).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return timestamp;
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Common classes
  const headerBase = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-2 whitespace-nowrap";
  const cellClass = "px-2 py-2";

  return (
    <div className="rounded-lg border border-card-border bg-card/50 overflow-hidden overflow-x-auto">
      <Table className="text-sm w-full table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-card-border">
            <TableHead className={`${headerBase} w-[100px]`}>Name</TableHead>
            <TableHead className={`${headerBase} w-[95px]`}>Phone</TableHead>
            <TableHead className={`${headerBase} w-[130px]`}>Address</TableHead>
            <TableHead className={`${headerBase} w-[120px]`}>Intent</TableHead>
            <TableHead className={`${headerBase} w-[85px]`}>Dept</TableHead>
            <TableHead className={`${headerBase} w-[32px] text-center`} title="Channel">Ch</TableHead>
            <TableHead className={`${headerBase} w-[70px]`} title="SMS Consent">SMS</TableHead>
            <TableHead className={`${headerBase} w-[40px] text-right`}>Dur</TableHead>
            {showCost && (
              <TableHead className={`${headerBase} w-[50px] text-right`}>Cost</TableHead>
            )}
            <TableHead className={`${headerBase} w-[80px]`}>Time</TableHead>
            <TableHead className={`${headerBase} w-[36px]`}></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow 
              key={record.id} 
              className="border-b border-card-border/50 last:border-0 hover:bg-muted/30"
              data-testid={`row-record-${record.id}`}
            >
              <TableCell className={`${cellClass} font-medium text-foreground`}>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="truncate">
                    {isSuperAdmin ? (
                      <Link
                        href={`/records/${record.id}`}
                        className="hover:underline hover:text-primary cursor-pointer"
                      >
                        {record.name}
                      </Link>
                    ) : (
                      record.name
                    )}
                  </span>
                  {record.needsReview && (
                    <span title="Needs review">
                      <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className={`${cellClass} text-xs text-muted-foreground tabular-nums truncate`}>
                {record.phone || (record.channel === "Voice" ? "(Web)" : "-")}
              </TableCell>
              <TableCell className={`${cellClass} text-xs text-muted-foreground`} title={record.address}>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="truncate">{record.address || "-"}</span>
                  {record.addressQuality && record.addressQuality !== "complete" && (
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 py-0 shrink-0 font-normal ${
                        record.addressQuality === "missing"
                          ? "border-red-400/50 text-red-500"
                          : record.addressQuality === "approximate"
                          ? "border-amber-400/50 text-amber-500"
                          : "border-slate-400/50 text-slate-500"
                      }`}
                    >
                      {record.addressQuality}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className={`${cellClass} truncate`}>
                {record.intent === "Pending" ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal animate-pulse border-yellow-500/50 text-yellow-600">
                    ...
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                    {record.intent}
                  </Badge>
                )}
              </TableCell>
              <TableCell className={`${cellClass} text-xs text-foreground truncate`} title={record.department}>
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
              <TableCell className={`${cellClass} text-xs text-muted-foreground`} title="SMS consent">
                {formatSmsConsent(record.smsConsent)}
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
              <TableCell className={`${cellClass} text-center`}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDeleteClick(record)}
                  title="Delete record"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the intake record for{" "}
              <span className="font-medium text-foreground">{recordToDelete?.name}</span>.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
