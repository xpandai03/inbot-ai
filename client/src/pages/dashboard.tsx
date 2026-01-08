import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { RecordsTable } from "@/components/records-table";
import { BroadcastModal } from "@/components/broadcast-modal";
import { useRole } from "@/lib/roleContext";
import type { IntakeRecord, DashboardStats, Client } from "@shared/schema";
import {
  Shield,
  Users,
  LogOut,
  Download,
  MessageSquare,
  FileText,
  Clock,
  DollarSign,
  TrendingUp,
} from "lucide-react";

export default function Dashboard() {
  const { role, logout } = useRole();
  const [, setLocation] = useLocation();
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [markupPercentage, setMarkupPercentage] = useState([25]);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const isSuperAdmin = role === "superadmin";

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: isSuperAdmin,
  });

  const { data: records = [], isLoading } = useQuery<IntakeRecord[]>({
    queryKey: ["/api/records", selectedClient],
    queryFn: async () => {
      const params = isSuperAdmin && selectedClient !== "all" 
        ? `?clientId=${selectedClient}` 
        : "";
      const response = await fetch(`/api/records${params}`);
      if (!response.ok) throw new Error("Failed to fetch records");
      return response.json();
    },
  });

  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ["/api/stats", selectedClient],
    queryFn: async () => {
      const params = isSuperAdmin && selectedClient !== "all" 
        ? `?clientId=${selectedClient}` 
        : "";
      const response = await fetch(`/api/stats${params}`);
      if (!response.ok) throw new Error("Failed to fetch stats");
      return response.json();
    },
    enabled: isSuperAdmin,
  });

  const calculatedRevenue = useMemo(() => {
    if (!stats) return 0;
    const markupMultiplier = 1 + markupPercentage[0] / 100;
    return stats.totalCost * markupMultiplier;
  }, [stats, markupPercentage]);

  if (!role) {
    setLocation("/");
    return null;
  }

  const departments = [...new Set(records.map((r) => r.department))];
  
  const filteredRecords = records.filter((record) => {
    if (departmentFilter !== "all" && record.department !== departmentFilter) {
      return false;
    }
    return true;
  });

  const handleLogout = () => {
    logout();
    setLocation("/");
  };

  const handleDownloadCSV = () => {
    const headers = ["Name", "Phone", "Address", "Intent", "Department", "Channel", "Language", "Duration", "Timestamp", "Summary"];
    const csvContent = [
      headers.join(","),
      ...filteredRecords.map((r) =>
        [
          `"${r.name}"`,
          r.phone,
          `"${r.address}"`,
          r.intent,
          r.department,
          r.channel,
          r.language,
          r.durationSeconds,
          r.timestamp,
          `"${r.transcriptSummary}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `intake-records-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const clientOptions = [
    { id: "all", name: "All Clients" },
    ...clients,
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold text-foreground">VAPI Intake</span>
          </div>

          <div className="flex items-center gap-3">
            <Badge
              variant={isSuperAdmin ? "default" : "secondary"}
              className="px-3 py-1 text-xs font-medium"
              data-testid="badge-role"
            >
              {isSuperAdmin ? (
                <>
                  <Shield className="w-3 h-3 mr-1.5" />
                  Super Admin
                </>
              ) : (
                <>
                  <Users className="w-3 h-3 mr-1.5" />
                  Client
                </>
              )}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-foreground" data-testid="text-dashboard-title">
            {isSuperAdmin ? "Platform Overview" : "Intake Dashboard"}
          </h1>
          <p className="text-muted-foreground">
            {isSuperAdmin
              ? "Manage clients, view costs, and control platform settings"
              : "View and manage your intake records"}
          </p>
        </div>

        {isSuperAdmin && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Records"
                value={stats?.totalRecords ?? 0}
                subtitle="All time"
                icon={FileText}
                testId="stat-total-records"
              />
              <StatCard
                title="Minutes Today"
                value={stats?.totalMinutesToday ?? 0}
                subtitle="Voice call duration"
                icon={Clock}
                testId="stat-minutes-today"
              />
              <StatCard
                title="Total Cost"
                value={`$${(stats?.totalCost ?? 0).toFixed(2)}`}
                subtitle="Platform costs"
                icon={DollarSign}
                testId="stat-total-cost"
              />
              <StatCard
                title="Revenue"
                value={`$${calculatedRevenue.toFixed(2)}`}
                subtitle={`At ${markupPercentage[0]}% markup`}
                icon={TrendingUp}
                testId="stat-revenue"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="p-5 bg-card/80 backdrop-blur-sm border-card-border">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Client Filter
                </Label>
                <Select value={selectedClient} onValueChange={setSelectedClient}>
                  <SelectTrigger className="mt-2" data-testid="select-client">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clientOptions.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Card>

              <Card className="p-5 bg-card/80 backdrop-blur-sm border-card-border lg:col-span-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Cost Markup
                    </Label>
                    <p className="text-2xl font-semibold text-foreground tabular-nums">
                      {markupPercentage[0]}%
                    </p>
                  </div>
                  <div className="flex-1 max-w-xs">
                    <Slider
                      value={markupPercentage}
                      onValueChange={setMarkupPercentage}
                      min={0}
                      max={100}
                      step={5}
                      className="mt-4"
                      data-testid="slider-markup"
                    />
                  </div>
                </div>
              </Card>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-department">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {departmentFilter !== "all" && (
              <Badge variant="secondary" className="text-xs">
                {filteredRecords.length} records
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setBroadcastOpen(true)}
              data-testid="button-broadcast"
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Send Broadcast SMS
            </Button>
            <Button
              variant="secondary"
              onClick={handleDownloadCSV}
              data-testid="button-download"
            >
              <Download className="w-4 h-4 mr-2" />
              Download CSV
            </Button>
          </div>
        </div>

        <RecordsTable
          records={filteredRecords}
          showCost={isSuperAdmin}
          isLoading={isLoading}
        />

        <BroadcastModal
          open={broadcastOpen}
          onOpenChange={setBroadcastOpen}
          recipientCount={filteredRecords.length}
        />
      </main>
    </div>
  );
}
