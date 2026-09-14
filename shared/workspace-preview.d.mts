export const MAX_WORKSPACE_TEXT_PREVIEW_BYTES: number;
export const BINARY_PREVIEW_CONTENT_TYPES: Set<string>;

export type WorkspaceFilePreviewInfo = {
  contentType: string;
  language: string;
  mimeType: string;
  previewEngine?: 'open-file-viewer';
  previewFamily?: string;
  previewCapability?: 'full' | 'basic' | 'structure';
  binary?: boolean;
};

export function getWorkspaceFilePreviewInfo(targetPath: string): WorkspaceFilePreviewInfo;
export function isBinaryPreviewContentType(contentType: string): boolean;
export function isLikelyBinaryBuffer(buffer: Uint8Array): boolean;
export function decodeWorkspaceTextBuffer(buffer: Uint8Array, truncated?: boolean): string;
