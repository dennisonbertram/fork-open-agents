"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const MAX_SECRET_BYTES = 48 * 1024;
const SECRET_NAME_HELP =
  "Names use A-Z, 0-9, underscore; can't start with a number or GITHUB_.";
const secretNameRegex = /^(?!GITHUB_)(?![0-9])[A-Z0-9_]+$/;

const secretFormSchema = z.object({
  name: z.string().regex(secretNameRegex, SECRET_NAME_HELP),
  value: z
    .string()
    .min(1, "Enter a value.")
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= MAX_SECRET_BYTES,
      "Value is too large (max 48 KB).",
    ),
});

type SecretFormValues = z.infer<typeof secretFormSchema>;

type AddSecretDialogProps = {
  owner: string;
  repo: string;
  mode: "add" | "edit";
  secretName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

function errorCopy(errorKind: string | undefined) {
  switch (errorKind) {
    case "secret_name_invalid":
      return SECRET_NAME_HELP;
    case "secret_too_large":
      return "Value is too large (max 48 KB).";
    case "github_rate_limited":
      return "GitHub is rate-limiting requests - try again in a moment.";
    case "app_no_secrets_permission":
      return "Re-authorize the GitHub App to manage Secrets.";
    default:
      return "Couldn't save the secret - try again.";
  }
}

async function parseMutationError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    errorKind?: string;
  };
  return body.errorKind;
}

export function AddSecretDialog({
  owner,
  repo,
  mode,
  secretName,
  open,
  onOpenChange,
  onSaved,
}: AddSecretDialogProps) {
  const [serverError, setServerError] = React.useState<string | null>(null);
  const form = useForm<SecretFormValues>({
    defaultValues: {
      name: secretName ?? "",
      value: "",
    },
  });
  const isEdit = mode === "edit";
  const title = isEdit
    ? `Update value of ${secretName ?? "secret"}`
    : "Add repository secret";
  const valueError = form.formState.errors.value?.message;
  const nameError = form.formState.errors.name?.message;

  React.useEffect(() => {
    if (open) {
      form.reset({ name: secretName ?? "", value: "" });
      setServerError(null);
    }
  }, [form, open, secretName]);

  async function onSubmit(values: SecretFormValues) {
    setServerError(null);
    const parsed = secretFormSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "name" || field === "value") {
          form.setError(field, { message: issue.message });
        }
      }
      return;
    }

    const name = parsed.data.name.trim();
    const encodedOwner = encodeURIComponent(owner);
    const encodedRepo = encodeURIComponent(repo);
    const response = await fetch(
      isEdit
        ? `/api/github/repos/${encodedOwner}/${encodedRepo}/secrets/${encodeURIComponent(name)}`
        : `/api/github/repos/${encodedOwner}/${encodedRepo}/secrets`,
      {
        method: isEdit ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isEdit
            ? { value: parsed.data.value }
            : { name, value: parsed.data.value },
        ),
      },
    );

    if (!response.ok) {
      const errorKind = await parseMutationError(response);
      setServerError(errorCopy(errorKind));
      return;
    }

    toast.success(`Secret ${name} saved`);
    onSaved();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Enter a value to store in GitHub Actions. Values are encrypted
            server-side before they reach GitHub.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={Boolean(nameError)}>
              <FieldLabel htmlFor="secret-name">Name</FieldLabel>
              <Input
                aria-describedby="secret-name-help secret-name-error"
                aria-invalid={Boolean(nameError)}
                autoCapitalize="characters"
                autoComplete="off"
                disabled={isEdit || form.formState.isSubmitting}
                id="secret-name"
                {...form.register("name")}
              />
              <FieldDescription id="secret-name-help">
                {SECRET_NAME_HELP}
              </FieldDescription>
              <FieldError id="secret-name-error">{nameError}</FieldError>
            </Field>
            <Field data-invalid={Boolean(valueError)}>
              <FieldLabel htmlFor="secret-value">Value</FieldLabel>
              <Input
                aria-describedby="secret-value-error"
                aria-invalid={Boolean(valueError)}
                autoComplete="off"
                disabled={form.formState.isSubmitting}
                id="secret-value"
                type="password"
                {...form.register("value")}
              />
              <FieldError id="secret-value-error">{valueError}</FieldError>
            </Field>
          </FieldGroup>
          {serverError ? (
            <p className="text-sm text-destructive">{serverError}</p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={form.formState.isSubmitting}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={form.formState.isSubmitting} type="submit">
              {form.formState.isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Save secret
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
