/** The one true modal in the console: invite a counsellor.
 *
 * Radix supplies focus trap, focus restore, ESC, scroll lock and the
 * `aria-modal` wiring. The visual shell is the console's — a white sheet on
 * the same tokens, radii and type as the roster behind it, because a dialog
 * drawn in a different design system reads as another product's window that
 * has opened on top of this one.
 *
 * It carries `.console` itself. The sheet is portalled to the document body,
 * outside the shell's subtree, so it inherits none of the console's type
 * unless it says so here.
 */
import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CloseIcon } from "./icons";

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
        <RadixDialog.Overlay className="console-overlay" />
        <RadixDialog.Content
          className={cn("console console-sheet nb-scroll", className)}
        >
          <div className="console-sheet-head">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="console-sheet-title">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="console-sheet-sub">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                className="console-icon-btn"
                data-variant="ghost"
                aria-label="Close"
              >
                <CloseIcon size={17} />
              </button>
            </RadixDialog.Close>
          </div>

          <div className="console-sheet-body">{children}</div>

          {footer ? <div className="console-sheet-foot">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
