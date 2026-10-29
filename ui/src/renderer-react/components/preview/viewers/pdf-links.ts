import { AnnotationLayer, AnnotationType, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils';
import { SimpleLinkService } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { shellIpc } from '@/ipc/shell.ipc';

const pageActions = new Set(['FirstPage', 'LastPage', 'NextPage', 'PrevPage']);
function externalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href;
  } catch {}
}

// PDF.js owns annotation geometry (including rotation, crop boxes and quads).
// Navigation stays in Moss; PDF scripts, attachments and form edits are excluded.
export class PreviewLinkService extends SimpleLinkService {
  constructor(private readonly document: PDFDocumentProxy, private readonly navigate: (page: number) => void,
    private readonly currentPage: () => number, private readonly onError: (message: string) => void) { super(); }

  override async goToDestination(destination: string | any[]) {
    try {
      const target = typeof destination === 'string' ? await this.document.getDestination(destination) : destination;
      if (!Array.isArray(target)) throw new Error('文档中的目标位置不存在');
      const reference = target[0];
      const index = Number.isInteger(reference) ? reference : await this.document.getPageIndex(reference);
      if (!Number.isInteger(index) || index < 0 || index >= this.document.numPages) throw new Error('文档中的目标页码无效');
      this.navigate(index + 1);
    } catch { this.onError('无法跳转到此文档链接的目标位置。'); }
  }

  override executeNamedAction(action: string) {
    const page = { FirstPage: 1, LastPage: this.document.numPages, NextPage: this.currentPage() + 1, PrevPage: this.currentPage() - 1 }[action];
    if (page !== undefined) this.navigate(page);
  }

  override addLinkAttributes(link: HTMLAnchorElement, value: string) {
    const url = externalUrl(value);
    if (!url) return;
    link.href = url; link.title = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.onclick = event => {
      event.preventDefault();
      // Call synchronously from the click so browser popup authorization survives.
      void shellIpc.openExternal(url).then(result => {
        if (result?.ok === false) this.onError('无法打开链接，请稍后重试。');
      }).catch(() => this.onError('无法打开链接，请检查浏览器是否拦截了新窗口。'));
      return false;
    };
  }
}

export async function renderPdfLinks(page: PDFPageProxy, viewport: PageViewport, linkService: PreviewLinkService) {
  const annotations = (await page.getAnnotations({ intent: 'display' })).filter(annotation =>
    annotation.annotationType === AnnotationType.LINK &&
    (annotation.url ? Boolean(externalUrl(annotation.url)) : annotation.dest || pageActions.has(annotation.action)));
  const div = document.createElement('div'); div.className = 'annotationLayer';
  div.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit));
  const annotationViewport = viewport.clone({ dontFlip: true });
  const layer = new AnnotationLayer({ div, page, viewport: annotationViewport, linkService,
    accessibilityManager: null, annotationCanvasMap: null, annotationEditorUIManager: null,
    structTreeLayer: null, commentManager: null, annotationStorage: null });
  await layer.render({ div, page, viewport: annotationViewport, linkService, annotations, renderForms: false, enableScripting: false });
  for (const link of div.querySelectorAll('a')) link.setAttribute('aria-label', link.title || '跳转到文档内的位置');
  return div;
}
