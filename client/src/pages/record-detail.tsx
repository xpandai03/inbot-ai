import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowLeft, ChevronDown, RefreshCw, Phone, MessageSquare } from "lucide-react";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { EvaluationDiff } from "@/components/evaluation-diff";
import { EvaluationHistory } from "@/components/evaluation-history";
import type { IntakeRecordDetail, EvaluationEntry } from "@shared/schema";
import { useState } from "react";

interface DetailResponse {
  record: IntakeRecordDetail;
  evaluations: EvaluationEntry[];
}

interface ReEvaluateResponse {
  evaluation: EvaluationEntry;
  diff: {
    name: { current: string; candidate: string; changed: boolean };
    address: { current: string; candidate: string; changed: boolean };
    intent: { current: string; candidate: string; changed: boolean };
    department: { current: string; candidate: string; changed: boolean };
    summary: { current: string; candidate: string; changed: boolean };
  };
}

interface ApplyResponse {
  record: IntakeRecordDetail;
  evaluation: EvaluationEntry;
}

function formatTimestamp(ts: string) {
  try {
    return new Date(ts).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return ts;
  }
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function RecordDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [candidateResult, setCandidateResult] = useState<ReEvaluateResponse | null>(null);

  const { data, isLoading, error } = useQuery<DetailResponse>({
    queryKey: [`/api/records/${id}/detail`],
    enabled: !!id,
  });

  const reEvaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/records/${id}/re-evaluate`);
      return (await res.json()) as ReEvaluateResponse;
    },
    onSuccess: (result) => {
      setCandidateResult(result);
      queryClient.invalidateQueries({ queryKey: [`/api/records/${id}/detail`] });
      toast({ title: "Re-evaluation complete", description: "Review the candidate below." });
    },
    onError: (err: Error) => {
      toast({ title: "Re-evaluation failed", description: err.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (evaluationId: string) => {
      const res = await apiRequest("POST", `/api/records/${id}/apply-evaluation`, { evaluationId });
      return (await res.json()) as ApplyResponse;
    },
    onSuccess: () => {
      setCandidateResult(null);
      queryClient.invalidateQueries({ queryKey: [`/api/records/${id}/detail`] });
      queryClient.invalidateQueries({ queryKey: ["/api/records"] });
      toast({ title: "Evaluation applied", description: "Record updated with new values." });
    },
    onError: (err: Error) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-sm text-destructive">
                {error ? String(error) : "Record not found"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const { record, evaluations } = data;
  const canReEvaluate = !!record.rawTranscript;

  // Find any pending candidate evaluation
  const pendingCandidate = candidateResult?.evaluation ||
    evaluations.find((e) => e.status === "candidate");

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-lg font-semibold text-foreground">Record Detail</h1>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {record.id.substring(0, 8)}
          </Badge>
        </div>

        {/* Record Summary */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Record Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Name</span>
                <p className="text-foreground font-medium">{record.name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Phone</span>
                <p className="text-foreground">{record.phone || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Address</span>
                <p className="text-foreground">{record.address || "-"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Channel</span>
                <p className="text-foreground flex items-center gap-1">
                  {record.channel === "Voice" ? (
                    <Phone className="w-3 h-3" />
                  ) : (
                    <MessageSquare className="w-3 h-3" />
                  )}
                  {record.channel}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Language</span>
                <p className="text-foreground">{record.language}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Duration</span>
                <p className="text-foreground">{formatDuration(record.durationSeconds)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Cost</span>
                <p className="text-foreground">${record.cost.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created</span>
                <p className="text-foreground">{formatTimestamp(record.timestamp)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Client</span>
                <p className="text-foreground">{record.clientId}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Classification */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Classification</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-center">
              <div>
                <span className="text-xs text-muted-foreground block mb-0.5">Intent</span>
                <Badge variant="secondary" className="text-xs">{record.intent}</Badge>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-0.5">Department</span>
                <Badge variant="secondary" className="text-xs">{record.department}</Badge>
              </div>
            </div>
            {record.transcriptSummary && (
              <div className="mt-3">
                <span className="text-xs text-muted-foreground">Summary</span>
                <p className="text-xs text-foreground mt-0.5">{record.transcriptSummary}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transcript */}
        <Collapsible open={transcriptOpen} onOpenChange={setTranscriptOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="pb-2 cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Transcript</CardTitle>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground transition-transform ${
                      transcriptOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <TranscriptViewer
                  transcript={record.rawTranscript ?? null}
                  recordingUrl={record.recordingUrl}
                  stereoRecordingUrl={record.stereoRecordingUrl}
                />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Re-Evaluation */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Re-Evaluation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Re-Evaluate Button */}
            <div>
              {canReEvaluate ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reEvaluateMutation.mutate()}
                  disabled={reEvaluateMutation.isPending}
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${reEvaluateMutation.isPending ? "animate-spin" : ""}`} />
                  {reEvaluateMutation.isPending ? "Re-evaluating..." : "Re-Evaluate Record"}
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button size="sm" variant="outline" disabled>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        Re-Evaluate Record
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">No transcript available for re-evaluation.</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {/* Candidate Diff */}
            {candidateResult && (
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-foreground">Candidate Evaluation</h4>
                <EvaluationDiff diff={candidateResult.diff} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => applyMutation.mutate(candidateResult.evaluation.id)}
                    disabled={applyMutation.isPending}
                  >
                    {applyMutation.isPending ? "Applying..." : "Apply This Evaluation"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCandidateResult(null)}
                    disabled={applyMutation.isPending}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            )}

            {/* Existing pending candidate (from evaluations list) */}
            {!candidateResult && pendingCandidate && pendingCandidate.status === "candidate" && (
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-foreground">Pending Candidate</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs rounded border border-card-border p-3">
                  <div><span className="text-muted-foreground">Name:</span> {pendingCandidate.candidateName || "-"}</div>
                  <div><span className="text-muted-foreground">Address:</span> {pendingCandidate.candidateAddress || "-"}</div>
                  <div><span className="text-muted-foreground">Intent:</span> {pendingCandidate.candidateIntent || "-"}</div>
                  <div><span className="text-muted-foreground">Department:</span> {pendingCandidate.candidateDepartment || "-"}</div>
                  <div className="col-span-2"><span className="text-muted-foreground">Summary:</span> {pendingCandidate.candidateSummary || "-"}</div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => applyMutation.mutate(pendingCandidate.id)}
                    disabled={applyMutation.isPending}
                  >
                    {applyMutation.isPending ? "Applying..." : "Apply This Evaluation"}
                  </Button>
                </div>
              </div>
            )}

            {/* Evaluation History */}
            {evaluations.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-foreground mb-2">Evaluation History</h4>
                <EvaluationHistory evaluations={evaluations} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
