import { Component, Suspense, lazy, type ReactNode } from "react";
import { X } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// The device dialogs are kept out of the main bundle. Their code is fetched right after the
// first render (preloadDialogs), not on the first click: that keeps the first click instant, and
// a page left open keeps working after run.bat rebuilds the UI, which replaces the files with
// newly named ones.
const loadDetail = () => import("./DeviceDetail");
const loadForm = () => import("./DeviceForm");

export const DeviceDetail = lazy(loadDetail);
export const DeviceForm = lazy(loadForm);

/** Fetch the dialog code ahead of the first click. If this fails, opening a dialog tries again. */
export function preloadDialogs(): void {
  loadDetail().catch(() => {});
  loadForm().catch(() => {});
}

interface BoundaryProps {
  children: ReactNode;
  onClose: () => void;
}

/** Shows a notice, instead of a blank page, when a dialog cannot be loaded or fails. */
export class DialogBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  close = () => {
    this.setState({ failed: false });
    this.props.onClose();
  };

  override render() {
    if (!this.state.failed) return <Suspense fallback={null}>{this.props.children}</Suspense>;
    return (
      <Alert variant="destructive" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg shadow-lg">
        <AlertDescription>
          <p>This window could not be opened. NetPulse may have been updated since this page was loaded.</p>
          <Button size="sm" className="mt-2" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </AlertDescription>
        <AlertAction>
          <Button size="icon-xs" variant="ghost" aria-label="Close alert" onClick={this.close}>
            <X aria-hidden="true" />
          </Button>
        </AlertAction>
      </Alert>
    );
  }
}
