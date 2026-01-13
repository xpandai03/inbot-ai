import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/authContext";
import { Shield, Mail, Loader2, CheckCircle2, Phone, MessageSquare, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Landing() {
  const [, setLocation] = useLocation();
  const { user, isLoading, signInWithEmail, signInWithPassword } = useAuth();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    if (!isLoading && user) {
      setLocation("/dashboard");
    }
  }, [user, isLoading, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      toast({
        title: "Email required",
        description: "Please enter your email address.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    // If password is provided, use password login
    if (password) {
      const { error } = await signInWithPassword(email.trim(), password);
      setIsSubmitting(false);

      if (error) {
        toast({
          title: "Sign in failed",
          description: error.message || "Invalid email or password.",
          variant: "destructive",
        });
        return;
      }

      // Password login successful - redirect happens via auth state change
      toast({
        title: "Welcome back!",
        description: "Signing you in...",
      });
      return;
    }

    // Otherwise use magic link
    const { error } = await signInWithEmail(email.trim());

    setIsSubmitting(false);

    if (error) {
      toast({
        title: "Sign in failed",
        description: error.message || "Unable to send magic link. Please try again.",
        variant: "destructive",
      });
      return;
    }

    setMagicLinkSent(true);
    toast({
      title: "Check your email",
      description: "We sent you a magic link to sign in.",
    });
  };

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center gap-2 mb-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Shield className="w-6 h-6 text-blue-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            InBot AI
          </h1>
          <p className="text-slate-400 text-base max-w-sm mx-auto leading-relaxed">
            AI-powered voice and SMS intake system. Your authoritative system of record for citizen communications.
          </p>
        </div>

        {/* Channel indicators */}
        <div className="flex items-center justify-center gap-4 text-slate-500 text-sm">
          <div className="flex items-center gap-1.5">
            <Phone className="w-4 h-4" />
            <span>Voice</span>
          </div>
          <span className="text-slate-700">|</span>
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4" />
            <span>SMS</span>
          </div>
        </div>

        {/* Login Card */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="text-center">
            <CardTitle className="text-white">Sign In</CardTitle>
            <CardDescription className="text-slate-400">
              Enter your email to receive a magic link
            </CardDescription>
          </CardHeader>
          <CardContent>
            {magicLinkSent ? (
              <div className="text-center space-y-4 py-4">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-green-400" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-medium text-white">Check your email</h3>
                  <p className="text-slate-400 text-sm">
                    We sent a magic link to <span className="text-white">{email}</span>
                  </p>
                  <p className="text-slate-500 text-xs">
                    Click the link in the email to sign in. The link expires in 1 hour.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="text-slate-400 hover:text-white"
                  onClick={() => {
                    setMagicLinkSent(false);
                    setEmail("");
                  }}
                >
                  Use a different email
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300">
                    Email address
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                      disabled={isSubmitting}
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                </div>

                {showPassword && (
                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-slate-300">
                      Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                        disabled={isSubmitting}
                        autoComplete="current-password"
                      />
                    </div>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {password ? "Signing in..." : "Sending link..."}
                    </>
                  ) : (
                    password ? "Sign in" : "Send magic link"
                  )}
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setShowPassword(!showPassword);
                    if (showPassword) setPassword("");
                  }}
                  className="w-full text-sm text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? "Use magic link instead" : "Sign in with password"}
                </button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600">
          Powered by InBot AI · Secure authentication via Supabase
        </p>
      </div>
    </div>
  );
}
