import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import { conversionService } from '../src/process/services/conversion-service.mjs';
import { styledWorkbook } from './fixtures/styled-workbook.mjs';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => fsp.rm(target, { recursive: true, force: true })));
});

function slideXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree><p:pic><p:blipFill><a:blip r:embed="rId1" /></p:blipFill></p:pic></p:spTree></p:cSld>
    </p:sld>`;
}

function slideRels(imageName: string, target = `../media/${imageName}`) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}" />
    </Relationships>`;
}

describe('conversion service', () => {
  it.each([false, true])('resolves PowerPoint slide relationships with UTF-8 BOM: %s', async (withBom) => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-conversion-test-'));
    cleanupPaths.push(tempDir);
    const filePath = path.join(tempDir, 'relationships.pptx');
    const zip = new JSZip();
    const prefix = withBom ? '\uFEFF' : '';
    zip.file('ppt/slides/slide1.xml', prefix + slideXml());
    zip.file('ppt/slides/slide2.xml', prefix + slideXml());
    zip.file('ppt/slides/_rels/slide1.xml.rels', prefix + slideRels('first.png'));
    zip.file('ppt/slides/_rels/slide2.xml.rels', prefix + slideRels('second.png', 'media/second.png'));
    zip.file('ppt/media/first.png', Buffer.from([1]));
    zip.file('ppt/slides/media/second.png', Buffer.from([2]));
    await fsp.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await conversionService.pptToJson(filePath);

  expect(result.success).toBe(true);
  expect(result.data.model).toMatchObject({ schema: 'moss.office-model/v1', kind: 'presentation', format: 'pptx', importer: 'openxml-zip' });
    expect(result.data?.slides[0].content.elements).toContainEqual({ type: 'image', ref: 'ppt/media/first.png' });
    expect(result.data?.slides[1].content.elements).toContainEqual({ type: 'image', ref: 'ppt/slides/media/second.png' });
    expect(result.data?.raw._mediaResources['ppt/media/first.png']).toStartWith('data:image/png;base64,');
    expect(result.data?.raw._mediaResources['ppt/slides/media/second.png']).toStartWith('data:image/png;base64,');
  });

  it('rejects oversized files before fallback parsers read them into memory', async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-conversion-test-'));
    cleanupPaths.push(tempDir);
    const filePath = path.join(tempDir, 'large.docx');
    await fsp.writeFile(filePath, '');
    await fsp.truncate(filePath, 100 * 1024 * 1024 + 1);

    await expect(conversionService.readFallbackBuffer(filePath)).rejects.toThrow('too large');
  });
});

it('Office preview cache coalesces reads and invalidates after file changes or removed PDFs', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-office-cache-')); cleanupPaths.push(root);
  const source = path.join(root, 'report.docx'), output = path.join(root, 'preview.pdf');
  await fsp.writeFile(source, 'version1');
  const service = new (conversionService.constructor as any)(); let conversions = 0;
  service.performLibreOfficeToPdf = async () => { conversions++; await fsp.writeFile(output, '%PDF-preview'); return { success: true, data: output }; };
  const [first, duplicate] = await Promise.all([service.libreOfficeToPdf(source), service.libreOfficeToPdf(source)]);
  expect(first).toEqual(duplicate); expect(conversions).toBe(1);
  await fsp.writeFile(source, 'version-two'); await service.libreOfficeToPdf(source); expect(conversions).toBe(2);
  await fsp.rm(output); await service.libreOfficeToPdf(source); expect(conversions).toBe(3);
});

it('preserves spreadsheet display values, raw values and formulas including absent caches', async () => {
  const XLSX = await import('xlsx-republish');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-excel-formats-')); cleanupPaths.push(root);
  const file = path.join(root, 'formats.xlsx');
  const sheet = { A1: { t: 'n', v: 0.28, z: '0%' }, B1: { t: 'n', v: 46324, z: 'yyyy-mm-dd' }, C1: { t: 'n', v: 12345.5, z: '#,##0.00' }, D1: { t: 'n', v: 0, f: '1-1', z: '0.00' }, E1: { t: 'b', v: false }, F1: { t: 's', v: '', f: 'IF(TRUE,"",1)' }, G1: { t: 'n', f: 'SUM(A2:A3)' }, H1: { t: 'e', v: 7 }, '!ref': 'A1:H1' };
  await fsp.writeFile(file, XLSX.write({ SheetNames: ['预算'], Sheets: { '预算': sheet } }, { type: 'buffer', bookType: 'xlsx' }));
  const result = await conversionService.excelToJson(file);
  expect(result.success).toBe(true);
  expect(result.data.model).toMatchObject({ schema: 'moss.office-model/v1', kind: 'spreadsheet', format: 'xlsx', importer: 'sheetjs-openxml' });
  expect(result.data.sheets[0].data[0].slice(0, 5)).toEqual([0.28, 46324, 12345.5, 0, false]);
  expect(result.data.sheets[0].displayData[0]).toEqual(['28%', '2026-10-29', '12,345.50', '0.00', 'FALSE', '', '=SUM(A2:A3)', '#DIV/0!']);
  expect(result.data.sheets[0].cells.D1.formula).toBe('1-1');
  expect(result.data.sheets[0].cells.B1.format).toBe('yyyy-mm-dd');
});

it('uses the workbook date system and keeps CSV text and zero values', async () => {
  const XLSX = await import('xlsx-republish');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-excel-dates-')); cleanupPaths.push(root);
  const file = path.join(root, 'date1904.xlsx');
  await fsp.writeFile(file, XLSX.write({ Workbook: { WBProps: { date1904: true } }, SheetNames: ['日期'], Sheets: { '日期': { A1: { t: 'n', v: 0, z: 'yyyy-mm-dd' }, '!ref': 'A1' } } }, { type: 'buffer', bookType: 'xlsx' }));
  expect((await conversionService.excelToJson(file)).data.sheets[0].displayData[0][0]).toBe('1904-01-01');
  const csv = path.join(root, 'plain.csv'); await fsp.writeFile(csv, '分类,金额\n支出,0\n');
  expect((await conversionService.excelToJson(csv)).data.sheets[0].displayData[1]).toEqual(['支出', '0']);
});

it.each([false, true])('reads spreadsheet data and embedded images with UTF-8 BOM: %s', async (withBom) => {
  const XLSX = await import('xlsx-republish');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-excel-xml-')); cleanupPaths.push(root);
  const file = path.join(root, 'sales.xlsx');
  const label = '  销售\uFEFF明细  ';
  const workbook = XLSX.write({ SheetNames: ['销售'], Sheets: { '销售': {
    A1: { t: 's', v: label }, B1: { t: 'n', f: '21*2', v: 42 }, '!ref': 'A1:B1',
  } } }, { type: 'buffer', bookType: 'xlsx' });
  const zip = await JSZip.loadAsync(workbook);
  // Real Office packages mix package-root and relative relationship targets.
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  zip.file('xl/_rels/workbook.xml.rels', rels.replace('Target="worksheets/sheet1.xml"', 'Target="/xl/worksheets/sheet1.xml"'));
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  zip.file('xl/media/image1.png', image);
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="drawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:ext cx="952500" cy="476250"/><xdr:pic><xdr:blipFill><a:blip r:embed="image"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`);
  if (withBom) for (const entry of Object.values(zip.files).filter(entry => /\.(xml|rels)$/.test(entry.name))) {
    zip.file(entry.name, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await entry.async('nodebuffer')]));
  }
  await fsp.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = await conversionService.excelToJson(file);
    expect(result.success).toBe(true);
    expect(errors).not.toHaveBeenCalled();
    expect(result.data.sheets[0].data[0]).toEqual([label, 42]);
    expect(result.data.sheets[0].cells.B1.formula).toBe('21*2');
    expect(result.data.sheets[0].images).toEqual([{ row: 2, col: 3, width: 100, height: 50, src: `data:image/png;base64,${image.toString('base64')}` }]);
  } finally { errors.mockRestore(); }
});

it('prepares BOM-prefixed worksheet XML for PDF without altering cell text', () => {
  const xml = '\uFEFF<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve">  销售\uFEFF明细  </t></is></c></row></sheetData></worksheet>';
  const result = conversionService.injectPageSetupIntoSheetXml(xml, 'landscape');
  expect(result).toContain('orientation="landscape"');
  expect(result).toContain('fitToWidth="1"');
  expect(result).toContain('  销售\uFEFF明细  ');
});

it('preserves namespaced workbook styling, theme table bands, frozen panes and conditional formats', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-excel-appearance-')); cleanupPaths.push(root);
  const file = path.join(root, 'styled.xlsx');
  await fsp.writeFile(file, await styledWorkbook());
  const result = await conversionService.excelToJson(file);
  expect(result.success).toBe(true);
  const sheet = result.data.sheets[0], appearance = sheet.appearance;
  expect(sheet.cells.C4.formula).toBe('B4*100');
  expect(sheet.merges).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }]);
  expect(appearance.styles[appearance.cellStyles.A1]).toMatchObject({ fontSize: '16pt', fontWeight: 'bold', color: '#1f4e78', verticalAlign: 'middle' });
  expect(appearance.styles[appearance.cellStyles.A3]).toMatchObject({ color: '#ffffff', backgroundColor: '#1f4e78', whiteSpace: 'pre-wrap', borderBottom: '1px solid #46b1e1' });
  expect(appearance.columns[0].width).toBe(126);
  expect(appearance.rows[0].height).toBeCloseTo(28 * 4 / 3);
  expect(appearance.rows[1].hidden).toBe(true);
  expect(appearance.showGridLines).toBe(false);
  expect(appearance.frozenRows).toBe(3);
  expect(appearance.frozenColumns).toBe(1);
  expect(appearance.tables[0]).toMatchObject({ range: { s: { r: 2, c: 0 }, e: { r: 5, c: 3 } }, rowStripes: true, stripeColor: '#c1e5f5' });
  expect(appearance.conditionalStyles.D4).toMatchObject({ fontWeight: 'bold', color: '#b91c1c', backgroundColor: '#fee2e2' });
  expect(appearance.conditionalStyles.D5.backgroundColor).toBe('#fef3c7');
  expect(appearance.conditionalStyles.D6).toBeUndefined();
  expect(appearance.dataBars.C4).toMatchObject({ color: '#60a5fa', left: 0, showValue: true });
  expect(appearance.dataBars.C4.width).toBe(10);
  expect(appearance.dataBars.C5.width).toBe(50);
  expect(appearance.dataBars.C6.width).toBe(90);
});
