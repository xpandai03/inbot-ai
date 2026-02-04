import { ScrollArea } from "@/components/ui/scroll-area";

interface TranscriptViewerProps {
  transcript: string | null;
  recordingUrl?: string | null;
  stereoRecordingUrl?: string | null;
}

export function TranscriptViewer({
  transcript,
  recordingUrl,
  stereoRecordingUrl,
}: TranscriptViewerProps) {
  const audioUrl = stereoRecordingUrl || recordingUrl;

  return (
    <div className="space-y-3">
      {audioUrl && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Recording</p>
          <audio controls className="w-full h-8" preload="metadata">
            <source src={audioUrl} type="audio/wav" />
            <source src={audioUrl} type="audio/mpeg" />
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {transcript ? (
        <ScrollArea className="h-[300px] rounded border border-card-border bg-muted/30 p-3">
          <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono text-foreground">
            {transcript}
          </pre>
        </ScrollArea>
      ) : (
        <div className="rounded border border-card-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Transcript not available — this record was created before transcript storage was enabled.
          </p>
        </div>
      )}
    </div>
  );
}
