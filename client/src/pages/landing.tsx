import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRole } from "@/lib/roleContext";
import { Shield, Users, Phone, MessageSquare } from "lucide-react";

export default function Landing() {
  const [, setLocation] = useLocation();
  const { setRole } = useRole();

  const handleLogin = (role: "client" | "superadmin") => {
    setRole(role);
    setLocation("/dashboard");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full space-y-12">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground" data-testid="text-title">
            VAPI Secure Intake
          </h1>
          <p className="text-muted-foreground text-base max-w-md mx-auto leading-relaxed">AI-powered voice and SMS intake system. Your authoritative system of record for citizen and patient communications. Personalized demo for Julio :)</p>
        </div>

        <div className="flex items-center justify-center gap-3 text-muted-foreground text-sm">
          <div className="flex items-center gap-1.5">
            <Phone className="w-4 h-4" />
            <span>Voice</span>
          </div>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4" />
            <span>SMS</span>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-6 space-y-4 bg-card/80 backdrop-blur-sm border-card-border">
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
              <Users className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h2 className="font-medium text-foreground">Client Portal</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                View your intake records, filter by department, and manage communications.
              </p>
            </div>
            <Button 
              className="w-full" 
              variant="secondary"
              onClick={() => handleLogin("client")}
              data-testid="button-login-client"
            >
              Login as Client
            </Button>
          </Card>

          <Card className="p-6 space-y-4 bg-card/80 backdrop-blur-sm border-card-border">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-1">
              <h2 className="font-medium text-foreground">Super Admin</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Full platform access with cost tracking, client management, and markup controls.
              </p>
            </div>
            <Button 
              className="w-full"
              onClick={() => handleLogin("superadmin")}
              data-testid="button-login-admin"
            >
              Login as Super Admin
            </Button>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Demo Environment · Data is simulated for demonstration purposes
        </p>
      </div>
    </div>
  );
}
