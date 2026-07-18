// Client-side printing. A web page has no direct socket to the OS printer —
// the only route is to load the document into a frame and invoke the browser's
// own print dialog, which then offers whatever printers the machine has. Both
// helpers below do that via a hidden iframe and clean it up afterward.

function printFrame(src: string, revoke?: () => void) {
  if (typeof document === "undefined") return;
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = src;

  const cleanup = () => {
    // Give the print dialog time to read the frame before we tear it down.
    setTimeout(() => {
      iframe.remove();
      revoke?.();
    }, 60_000);
  };

  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) throw new Error("no print window");
      win.focus();
      win.print();
    } catch {
      // Pop-up/print blocked — fall back to opening in a new tab so the user
      // can still print manually. Never a dead end.
      window.open(src, "_blank", "noopener");
    } finally {
      cleanup();
    }
  };

  document.body.appendChild(iframe);
}

// Print a generated PDF blob (the invoice).
export function printBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  printFrame(url, () => URL.revokeObjectURL(url));
}

// Print a served PDF by URL (the SMSA AWB label at /api/orders/:uid/label).
export function printUrl(url: string) {
  printFrame(url);
}

// Download a generated PDF blob under a filename.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
