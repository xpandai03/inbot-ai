import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mail, AlertTriangle, Loader2 } from "lucide-react";
import { KNOWN_DEPARTMENTS, type DepartmentEmail } from "@shared/schema";

interface DepartmentEmailFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingEmail: DepartmentEmail | null;
  existingDepartments: string[];
  onSubmit: (data: { department: string; email: string; ccEmail?: string }) => Promise<void>;
}

export function DepartmentEmailForm({
  open,
  onOpenChange,
  editingEmail,
  existingDepartments,
  onSubmit,
}: DepartmentEmailFormProps) {
  const [department, setDepartment] = useState("");
  const [customDepartment, setCustomDepartment] = useState("");
  const [email, setEmail] = useState("");
  const [ccEmail, setCcEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!editingEmail;
  const isCustomDepartment = department === "__custom__";

  // Reset form when dialog opens/closes or editing email changes
  useEffect(() => {
    if (open) {
      if (editingEmail) {
        setDepartment(editingEmail.department);
        setEmail(editingEmail.email);
        setCcEmail(editingEmail.ccEmail || "");
        setCustomDepartment("");
      } else {
        setDepartment("");
        setCustomDepartment("");
        setEmail("");
        setCcEmail("");
      }
      setError(null);
    }
  }, [open, editingEmail]);

  // Get available departments (exclude already configured ones when adding)
  const availableDepartments = isEditing
    ? KNOWN_DEPARTMENTS
    : KNOWN_DEPARTMENTS.filter((d) => !existingDepartments.includes(d));

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalDepartment = isCustomDepartment ? customDepartment.trim() : department;
    const trimmedEmail = email.trim();
    const trimmedCcEmail = ccEmail.trim();

    // Validation
    if (!finalDepartment) {
      setError("Please select or enter a department");
      return;
    }

    if (!trimmedEmail) {
      setError("Email address is required");
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setError("Please enter a valid email address");
      return;
    }

    if (trimmedCcEmail && !validateEmail(trimmedCcEmail)) {
      setError("Please enter a valid CC email address");
      return;
    }

    // Check for duplicate when adding
    if (!isEditing && existingDepartments.includes(finalDepartment)) {
      setError(`Department "${finalDepartment}" already has an email configuration`);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        department: finalDepartment,
        email: trimmedEmail,
        ccEmail: trimmedCcEmail || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save email configuration");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-card-border">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">
                {isEditing ? "Edit Email Configuration" : "Add Department Email"}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {isEditing
                  ? `Update email settings for ${editingEmail.department}`
                  : "Configure email routing for a department"}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {!isEditing && (
              <div className="space-y-2">
                <Label htmlFor="department" className="text-sm font-medium">
                  Department
                </Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger data-testid="select-department-form">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableDepartments.map((dept) => (
                      <SelectItem key={dept} value={dept}>
                        {dept}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__">Custom Department...</SelectItem>
                  </SelectContent>
                </Select>

                {isCustomDepartment && (
                  <div className="space-y-2 mt-2">
                    <Input
                      id="customDepartment"
                      placeholder="Enter custom department name"
                      value={customDepartment}
                      onChange={(e) => setCustomDepartment(e.target.value)}
                      data-testid="input-custom-department"
                    />
                    <p className="text-xs text-amber-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Ensure this matches the classification output exactly
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email Address *
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="department@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ccEmail" className="text-sm font-medium">
                CC Email (Optional)
              </Label>
              <Input
                id="ccEmail"
                type="email"
                placeholder="cc@example.com"
                value={ccEmail}
                onChange={(e) => setCcEmail(e.target.value)}
                data-testid="input-cc-email"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              data-testid="button-cancel-form"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} data-testid="button-save-form">
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : isEditing ? (
                "Update"
              ) : (
                "Add Department"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
