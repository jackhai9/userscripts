export function isTrustedFrameMessage(documentRef, event) {
  if (!event?.source || !event.origin) return false;
  const frames = documentRef.querySelectorAll('iframe[src]');
  for (const frame of frames) {
    if (frame.contentWindow !== event.source) continue;
    return new URL(frame.src, documentRef.baseURI).origin === event.origin;
  }
  return false;
}
