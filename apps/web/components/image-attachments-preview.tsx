"use client";

import { X } from "lucide-react";
import type { ImageAttachment } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentGroup,
  AttachmentMedia,
} from "@/components/ui/attachment";

interface ImageAttachmentItemProps {
  image: ImageAttachment;
  onRemove: () => void;
}

function ImageAttachmentItem({ image, onRemove }: ImageAttachmentItemProps) {
  return (
    <Attachment className="size-16 overflow-visible border-0 bg-transparent p-0 shadow-none hover:bg-transparent">
      <AttachmentMedia className="size-16 rounded-lg bg-transparent">
        {/* eslint-disable-next-line @next/next/no-img-element -- Data URLs not supported by next/image */}
        <img
          src={image.dataUrl}
          alt={image.filename ?? "Attached image"}
          className="size-full rounded-lg object-cover"
        />
      </AttachmentMedia>
      <AttachmentActions className="-right-1.5 -top-1.5 absolute opacity-0 transition-opacity group-hover/attachment:opacity-100">
        <AttachmentAction
          onClick={onRemove}
          aria-label="Remove image"
          className="size-5 rounded-full bg-neutral-700 text-neutral-300 hover:bg-neutral-600 hover:text-neutral-100"
        >
          <X />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

interface ImageAttachmentsPreviewProps {
  images: ImageAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}

export function ImageAttachmentsPreview({
  images,
  onRemove,
  className,
}: ImageAttachmentsPreviewProps) {
  if (images.length === 0) return null;

  return (
    <AttachmentGroup className={cn("px-3 pb-2 pt-3", className)}>
      {images.map((image) => (
        <ImageAttachmentItem
          key={image.id}
          image={image}
          onRemove={() => onRemove(image.id)}
        />
      ))}
    </AttachmentGroup>
  );
}
