import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import type { DepartmentEmail } from "@shared/schema";

interface DepartmentEmailTableProps {
  emails: DepartmentEmail[];
  isLoading: boolean;
  onEdit: (email: DepartmentEmail) => void;
  onDelete: (email: DepartmentEmail) => void;
  deletingId: string | null;
}

export function DepartmentEmailTable({
  emails,
  isLoading,
  onEdit,
  onDelete,
  deletingId,
}: DepartmentEmailTableProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No email configurations found.</p>
        <p className="text-sm mt-1">Click "Add Department" to configure email routing.</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Department</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>CC</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {emails.map((email) => (
            <TableRow key={email.id}>
              <TableCell className="font-medium">
                <div className="flex items-center gap-2">
                  {email.department}
                  {email.department === "General" && (
                    <Badge variant="secondary" className="text-xs">
                      Fallback
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {email.email}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {email.ccEmail || "-"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(email)}
                    title="Edit"
                    data-testid={`button-edit-${email.department}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  {email.department !== "General" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(email)}
                      disabled={deletingId === email.id}
                      title="Delete"
                      className="text-destructive hover:text-destructive"
                      data-testid={`button-delete-${email.department}`}
                    >
                      {deletingId === email.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
