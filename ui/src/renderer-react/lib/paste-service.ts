import { collectFileAttachments } from "./file-attachments";

class PasteServiceClass {
  private handlers: Map<string, (event: ClipboardEvent) => Promise<boolean>> = new Map();
  private lastFocusedComponent: string | null = null;
  private isInitialized = false;

  init() {
    if (this.isInitialized) return;
    document.addEventListener('paste', this.handleGlobalPaste);
    this.isInitialized = true;
  }

  registerHandler(componentId: string, handler: (event: ClipboardEvent) => Promise<boolean>) {
    this.handlers.set(componentId, handler);
  }

  unregisterHandler(componentId: string) {
    this.handlers.delete(componentId);
  }

  setLastFocusedComponent(componentId: string) {
    this.lastFocusedComponent = componentId;
  }

  private handleGlobalPaste = async (event: ClipboardEvent) => {
    const target = event.target as Element;
    const editableElement = target?.closest('input, textarea, [contenteditable]');
    if (editableElement instanceof HTMLInputElement || editableElement instanceof HTMLTextAreaElement) {
      return;
    }

    if (!this.lastFocusedComponent) return;
    const handler = this.handlers.get(this.lastFocusedComponent);
    if (handler) {
      const handled = await handler(event);
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };

  async handlePaste(
    event: ClipboardEvent | React.ClipboardEvent,
    onFilesAdded: (files: Array<{ name: string; path: string }>) => void,
    onTextPaste?: (text: string) => void
  ): Promise<boolean> {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length) {
      event.preventDefault(); event.stopPropagation();
      const result = await collectFileAttachments(files);
      onFilesAdded(result.attachments);
      return true;
    }
    const text = event.clipboardData?.getData('text');
    if (text && onTextPaste) {
      event.preventDefault(); onTextPaste(text); return true;
    }

    return false;
  }

  destroy() {
    if (this.isInitialized) {
      document.removeEventListener('paste', this.handleGlobalPaste);
      this.handlers.clear();
      this.lastFocusedComponent = null;
      this.isInitialized = false;
    }
  }
}

export const pasteService = new PasteServiceClass();
