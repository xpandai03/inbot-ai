/**
 * Auth Callback Page
 *
 * Handles the redirect from Supabase magic link.
 * Exchanges the code for a session and redirects to dashboard.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Supabase automatically handles the token exchange from URL
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error("[auth-callback] Session error:", error);
          setError(error.message);
          return;
        }

        if (data.session) {
          console.log("[auth-callback] Session established, redirecting to dashboard");
          // Small delay to ensure state updates
          setTimeout(() => setLocation("/dashboard"), 100);
        } else {
          // No session - might be because the code was already used
          // Check if there's an error in the URL
          const params = new URLSearchParams(window.location.search);
          const hashParams = new URLSearchParams(window.location.hash.slice(1));

          const errorDescription =
            params.get("error_description") ||
            hashParams.get("error_description");

          if (errorDescription) {
            setError(errorDescription);
          } else {
            setError("Unable to establish session. Please try logging in again.");
          }
        }
      } catch (err) {
        console.error("[auth-callback] Unexpected error:", err);
        setError("An unexpected error occurred. Please try again.");
      }
    };

    handleAuthCallback();
  }, [setLocation]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
        <CardContent className="pt-6 text-center">
          {error ? (
            <div className="space-y-4">
              <div className="text-red-400 text-lg font-medium">
                Authentication Error
              </div>
              <p className="text-slate-400">{error}</p>
              <button
                onClick={() => setLocation("/")}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Return to login
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400 mx-auto" />
              <p className="text-slate-300">Completing sign in...</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
