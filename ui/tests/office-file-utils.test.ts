import { describe, expect, it } from 'bun:test';

import { browserOfficeCapability, fileExtension, officeParserFileName } from '../src/renderer-react/components/preview/viewers/office-file-utils';

describe('Office preview filename handling', () => {
  it('recognizes modern Office files when local names contain URL delimiters', () => {
    expect(fileExtension('/tmp/混排 长文档 #100% & 签核.docx')).toBe('docx');
    expect(browserOfficeCapability('/tmp/混排 长文档 #100% & 签核.docx')).toBe('full');
    expect(browserOfficeCapability('C:\\work\\复杂 幻灯片 #2.pptx')).toBe('full');
  });

  it('keeps the extension while making the parser filename URL-safe', () => {
    expect(officeParserFileName('/tmp/混排 长文档 #100% & 签核.docx')).toBe('混排 长文档 _100_ _ 签核.docx');
    expect(officeParserFileName('/tmp/report.docx?download=1')).toBe('report.docx');
    expect(officeParserFileName('/tmp/no-extension #100% & ?.data')).toBe('no-extension _100_ _ _.data');
  });

  it('does not change ordinary Office names', () => {
    expect(officeParserFileName('/workspace/report.docx')).toBe('report.docx');
    expect(browserOfficeCapability('/workspace/slides.pptx?cache=2')).toBe('full');
  });
});
