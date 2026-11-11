import { useState } from "react";

// Radix only restores focus to a DialogTrigger. These dialogs are opened by app state, so remember
// whatever had focus when the dialog mounted and hand it back on close.
export function useReturnFocus(): (event: Event) => void {
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  return (event) => {
    event.preventDefault();
    if (opener?.isConnected) opener.focus();
  };
}
