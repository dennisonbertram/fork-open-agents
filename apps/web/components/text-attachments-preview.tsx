"use client";

import { useState } from "react";
import { FileText, X } from "lucide-react";
import type { TextAttachment } from "@/lib/text-attachment-utils";
import { formatByteSize } from "@/lib/text-attachment-utils";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";

interface TextAttachmentChipProps {
  attachment: TextAttachment;
  onRemove: () => void;
  onPreview: () => void;
}

function TextAttachmentChip({
  attachment,
  onRemove,
  onPreview,
}: TextAttachmentChipProps) {
  const meta = `${attachment.lineCount} lines · ${formatByteSize(attachment.byteSize)}`;

  return (
    <Attachment className="w-64 max-w-full pr-8 font-mono">
      <AttachmentMedia>
        <FileText />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.filename}</AttachmentTitle>
        <AttachmentDescription>{meta}</AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions className="absolute right-1.5 top-1.5">
        <AttachmentAction
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label="Remove text attachment"
        >
          <X />
        </AttachmentAction>
      </AttachmentActions>
      <AttachmentTrigger
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${attachment.filename}`}
      />
    </Attachment>
  );
}

interface TextAttachmentPreviewDialogProps {
  attachment: TextAttachment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TextAttachmentPreviewDialog({
  attachment,
  open,
  onOpenChange,
}: TextAttachmentPreviewDialogProps) {
  if (!attachment) return null;

  const meta = `${attachment.lineCount} lines · ${formatByteSize(attachment.byteSize)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-sm">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{attachment.filename}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {meta}
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Preview the attached text file content.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/40 p-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
            {attachment.content}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TextAttachmentsPreviewProps {
  attachments: TextAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}

export function TextAttachmentsPreview({
  attachments,
  onRemove,
  className,
}: TextAttachmentsPreviewProps) {
  const [previewAttachment, setPreviewAttachment] =
    useState<TextAttachment | null>(null);

  if (attachments.length === 0) return null;

  return (
    <>
      <AttachmentGroup className={cn("py-1", className)}>
        {attachments.map((attachment) => (
          <TextAttachmentChip
            key={attachment.id}
            attachment={attachment}
            onRemove={() => onRemove(attachment.id)}
            onPreview={() => setPreviewAttachment(attachment)}
          />
        ))}
      </AttachmentGroup>
      <TextAttachmentPreviewDialog
        attachment={previewAttachment}
        open={previewAttachment !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachment(null);
        }}
      />
    </>
  );
}
