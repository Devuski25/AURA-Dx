/**
 * Saving a generated file from the browser.
 *
 * Every PDF button in the product did this inline:
 *
 *   const url = URL.createObjectURL(blob)
 *   const a = document.createElement("a")
 *   a.href = url
 *   a.download = name
 *   a.click()
 *   URL.revokeObjectURL(url)
 *
 * That pattern is racy. The revoke runs in the same tick as the click, and on
 * a phone -- where the PDF is large and the write takes a moment -- the blob URL
 * can be released before the browser has read it, producing a download that
 * silently produces nothing. The anchor also was never added to the document,
 * which some mobile browsers require before they honour a programmatic click.
 *
 * So: attach it, click it, then revoke on the next tick after the browser has
 * taken the reference.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Give the browser a turn to pick up the blob before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
