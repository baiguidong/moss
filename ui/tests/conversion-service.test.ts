import { afterEach, describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import { conversionService } from '../src/process/services/conversion-service.mjs';

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

function slideRels(imageName: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${imageName}" />
    </Relationships>`;
}

describe('conversion service', () => {
  it('resolves duplicate relationship ids within each PowerPoint slide', async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-conversion-test-'));
    cleanupPaths.push(tempDir);
    const filePath = path.join(tempDir, 'relationships.pptx');
    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', slideXml());
    zip.file('ppt/slides/slide2.xml', slideXml());
    zip.file('ppt/slides/_rels/slide1.xml.rels', slideRels('first.png'));
    zip.file('ppt/slides/_rels/slide2.xml.rels', slideRels('second.png'));
    zip.file('ppt/media/first.png', Buffer.from([1]));
    zip.file('ppt/media/second.png', Buffer.from([2]));
    await fsp.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await conversionService.pptToJson(filePath);

    expect(result.success).toBe(true);
    expect(result.data?.slides[0].content.elements).toContainEqual({ type: 'image', ref: 'first.png' });
    expect(result.data?.slides[1].content.elements).toContainEqual({ type: 'image', ref: 'second.png' });
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
