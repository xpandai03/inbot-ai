import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Settings, Plus, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DepartmentEmailTable } from "./department-email-table";
import { DepartmentEmailForm } from "./department-email-form";
import type { DepartmentEmail } from "@shared/schema";

interface DepartmentEmailSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId?: string;
}

export function DepartmentEmailSettings({
  open,
  onOpenChange,
  clientId,
}: DepartmentEmailSettingsProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editingEmail, setEditingEmail] = useState<DepartmentEmail | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch department emails
  const { data: emails = [], isLoading } = useQuery<DepartmentEmail[]>({
    queryKey: ["/api/department-emails", clientId],
    queryFn: async () => {
      const params = clientId ? `?clientId=${clientId}` : "";
      const response = await fetch(`/api/department-emails${params}`);
      if (!response.ok) {
        throw new Error("Failed to fetch department emails");
      }
      return response.json();
    },
    enabled: open,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: { department: string; email: string; ccEmail?: string }) => {
      const response = await fetch("/api/department-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create department email");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/department-emails"] });
      toast({
        title: "Email Configuration Added",
        description: "Department email routing has been configured.",
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: { email: string; ccEmail?: string };
    }) => {
      const response = await fetch(`/api/department-emails/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update department email");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/department-emails"] });
      toast({
        title: "Email Configuration Updated",
        description: "Department email settings have been saved.",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/department-emails/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete department email");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/department-emails"] });
      toast({
        title: "Email Configuration Deleted",
        description: "Department email routing has been removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete configuration",
        variant: "destructive",
      });
    },
  });

  const handleAddClick = () => {
    setEditingEmail(null);
    setFormOpen(true);
  };

  const handleEditClick = (email: DepartmentEmail) => {
    setEditingEmail(email);
    setFormOpen(true);
  };

  const handleDeleteClick = async (email: DepartmentEmail) => {
    if (email.department === "General") {
      toast({
        title: "Cannot Delete",
        description: "The General department email cannot be deleted as it serves as the fallback.",
        variant: "destructive",
      });
      return;
    }

    setDeletingId(email.id);
    try {
      await deleteMutation.mutateAsync(email.id);
    } finally {
      setDeletingId(null);
    }
  };

  const handleFormSubmit = async (data: {
    department: string;
    email: string;
    ccEmail?: string;
  }) => {
    if (editingEmail) {
      await updateMutation.mutateAsync({
        id: editingEmail.id,
        data: { email: data.email, ccEmail: data.ccEmail },
      });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const existingDepartments = emails.map((e) => e.department);
  const hasGeneralConfigured = existingDepartments.includes("General");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl bg-card border-card-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Settings className="w-5 h-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold">
                  Department Email Settings
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Configure which email addresses receive intake notifications by department
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {!hasGeneralConfigured && !isLoading && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No "General" department configured. Intakes for uncategorized departments won't receive email notifications.
                  Consider adding a General department as a fallback.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {emails.length} department{emails.length !== 1 ? "s" : ""} configured
              </p>
              <Button onClick={handleAddClick} data-testid="button-add-department">
                <Plus className="w-4 h-4 mr-2" />
                Add Department
              </Button>
            </div>

            <DepartmentEmailTable
              emails={emails}
              isLoading={isLoading}
              onEdit={handleEditClick}
              onDelete={handleDeleteClick}
              deletingId={deletingId}
            />

            <p className="text-xs text-muted-foreground">
              Changes take effect immediately for new intakes. The "General" department serves as a fallback
              when no specific department email is configured.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <DepartmentEmailForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editingEmail={editingEmail}
        existingDepartments={existingDepartments}
        onSubmit={handleFormSubmit}
      />
    </>
  );
}
