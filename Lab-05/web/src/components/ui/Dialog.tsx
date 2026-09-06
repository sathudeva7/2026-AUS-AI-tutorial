/** The one true modal in the console: invite a counsellor.
 *
 * Radix supplies focus trap, focus restore, ESC, scroll lock and the
 * `aria-modal` wiring. The visual shell is the prototype's — a 760px sheet
 * pinned near the top of the viewport with its own scroll, over a dimmed
 * neutral-900 backdrop.
 */
import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./index";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Sticky action bar. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-40"
          style={{
            background:
              "color-mix(in srgb, var(--color-neutral-900) 50%, transparent)",
          }}
        />
        <RadixDialog.Content
          className={cn(
            "nb-scroll fixed left-1/2 top-8 z-50 flex max-h-[calc(100vh-4rem)] w-[760px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-y-auto rounded-lg shadow-lg",
            className,
          )}
          style={{ background: "var(--color-neutral-100)" }}
        >
          <div
            className="px-7 pb-4 pt-6"
            style={{ borderBottom: "1px solid var(--color-divider)" }}
          >
            <div className="flex items-start gap-3">
              <div>
                <RadixDialog.Title className="m-0 font-heading text-[26px] leading-tight">
                  {title}
                </RadixDialog.Title>
                {description ? (
                  <RadixDialog.Description
                    className="mb-0 mt-2 max-w-[62ch] text-[13px]"
                    style={{ color: "var(--color-neutral-700)" }}
                  >
                    {description}
                  </RadixDialog.Description>
                ) : null}
              </div>
              <RadixDialog.Close asChild>
                <Button
                  variant="ghost"
                  aria-label="Close"
                  className="ml-auto px-3 py-1.5 text-base"
                >
                  ×
                </Button>
              </RadixDialog.Close>
            </div>
          </div>

          <div className="flex flex-col gap-6 px-7 pb-2 pt-6">{children}</div>

          {footer ? (
            <div
              className="sticky bottom-0 flex items-center gap-2 px-7 py-4"
              style={{
                background: "var(--color-neutral-100)",
                borderTop: "1px solid var(--color-divider)",
              }}
            >
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
