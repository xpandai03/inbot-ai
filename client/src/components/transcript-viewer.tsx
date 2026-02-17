import { ScrollArea } from "@/components/ui/scroll-area";

interface ArtifactMessage {
  role: "user" | "assistant" | "bot" | "system";
  message: string;
  time?: number;
}

interface TranscriptViewerProps {
  transcript: string | null;
  recordingUrl?: string | null;
  stereoRecordingUrl?: string | null;
  artifactMessages?: ArtifactMessage[] | null;
  channel?: string;
}

export function TranscriptViewer({
  transcript,
  recordingUrl,
  stereoRecordingUrl,
  artifactMessages,
  channel,
}: TranscriptViewerProps) {
  const audioUrl = stereoRecordingUrl || recordingUrl;
  const isSms = channel === "SMS";
  const hasStructuredMessages =
    Array.isArray(artifactMessages) && artifactMessages.length > 0;

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

      {isSms && hasStructuredMessages ? (
        <ScrollArea className="h-[300px] rounded border border-card-border bg-muted/30 p-3">
          <div className="space-y-2">
            {artifactMessages!.map((msg, i) => {
              const isUser = msg.role === "user";
              const label = isUser ? "User" : "Assistant";
              return (
                <div key={i} className="text-xs leading-relaxed">
                  <span
                    className={`font-semibold ${
                      isUser
                        ? "text-blue-500 dark:text-blue-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {label}:
                  </span>{" "}
                  <span className="text-foreground">{msg.message}</span>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      ) : transcript ? (
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
