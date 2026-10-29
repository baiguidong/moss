/** A native link-like button covering a card, with separate action buttons above it. */
export function ResourceCardOpenButton({ title, onOpen }: { title: string; onOpen(): void }) {
  return <button type="button" aria-label={`打开 ${title}`} onClick={onOpen}
    className="absolute inset-0 cursor-pointer rounded-lg transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />;
}
