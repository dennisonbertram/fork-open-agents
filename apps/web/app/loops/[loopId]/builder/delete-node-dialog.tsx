"use client";

/**
 * delete-node-dialog.tsx — AlertDialog confirming node deletion.
 *
 * Shows the node label and count of attached edges. The user must explicitly
 * confirm before the node and its edges are removed.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type DeleteNodeDialogProps = {
  open: boolean;
  nodeName: string;
  edgeCount: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DeleteNodeDialog({
  open,
  nodeName,
  edgeCount,
  onConfirm,
  onCancel,
}: DeleteNodeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete node?</DialogTitle>
          <DialogDescription>
            Deleting{" "}
            <strong className="font-medium text-foreground">
              {nodeName || "this node"}
            </strong>{" "}
            will also remove{" "}
            {edgeCount === 0 ? (
              "all connected edges."
            ) : (
              <>
                <strong className="font-medium text-foreground">
                  {edgeCount}
                </strong>{" "}
                attached {edgeCount === 1 ? "edge" : "edges"}.
              </>
            )}{" "}
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
