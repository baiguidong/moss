import electron from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { conversionService } from '../services/conversion-service.mjs';

const { ipcMain } = electron;

const MAMMOTH_EXTENSIONS = new Set(['.docx', '.docm', '.dotx']);
const EXCEL_EXTENSIONS = new Set(['.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv']);
const PPT_XML_EXTENSIONS = new Set(['.pptx', '.pptm', '.ppsx']);
const LIBREOFFICE_EXTENSIONS = new Set([
  '.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf', '.odt',
  '.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.odp',
  '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods',
]);

function ensureExtension(filePath, allowed) {
  return allowed.has(path.extname(filePath).toLowerCase());
}

function unsupportedResult(to, message) {
  return { to, result: { success: false, error: message } };
}

export function registerDocumentIpcHandlers() {
  ipcMain.handle('document.convert', async (_event, { filePath, to }) => {
    switch (to) {
      case 'markdown':
        if (!ensureExtension(filePath, MAMMOTH_EXTENSIONS)) return unsupportedResult(to, 'Only OOXML Word documents can be converted to markdown without LibreOffice');
        return { to, result: await conversionService.wordToMarkdown(filePath) };
      case 'word-html':
        if (!ensureExtension(filePath, MAMMOTH_EXTENSIONS)) return unsupportedResult(to, 'Only OOXML Word documents can be converted to HTML without LibreOffice');
        return { to, result: await conversionService.wordToHtml(filePath) };
      case 'excel-json':
        if (!ensureExtension(filePath, EXCEL_EXTENSIONS)) return unsupportedResult(to, 'Only Excel files can be converted to JSON');
        return { to, result: await conversionService.excelToJson(filePath) };
      case 'ppt-json':
        if (!ensureExtension(filePath, PPT_XML_EXTENSIONS)) return unsupportedResult(to, 'Only OOXML PowerPoint files can be converted to JSON without LibreOffice');
        return { to, result: await conversionService.pptToJson(filePath) };
      case 'pptx-arraybuffer':
        if (!ensureExtension(filePath, PPT_XML_EXTENSIONS)) return unsupportedResult(to, 'Only OOXML PowerPoint files can be read as ArrayBuffer');
        try {
          const buffer = await fs.readFile(filePath);
          return {
            to,
            result: {
              success: true,
              data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
            },
          };
        } catch (error) {
          return { to, result: { success: false, error: error instanceof Error ? error.message : 'Failed to read file' } };
        }
      case 'libreoffice-pdf':
        if (!ensureExtension(filePath, LIBREOFFICE_EXTENSIONS)) return unsupportedResult(to, 'Only Office documents can be converted to PDF via LibreOffice');
        return { to, result: await conversionService.libreOfficeToPdf(filePath) };
      default:
        return unsupportedResult(to, `Unsupported target format: ${to}`);
    }
  });

  ipcMain.handle('document.libreoffice.is-available', async () => {
    return await conversionService.isLibreOfficeAvailable();
  });
}
