import { installMediaProtocol } from '../src/media-protocol.mjs';
import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { splitDocumentReference, parseCellRange } from '../src/shared/document-location.mjs';
import { createPresentationResolver } from '../src/presentation/resource-resolver.mjs';
import { createPresentationService } from '../src/presentation/presentation-service.mjs';
import { handleMarkdownLinkClick } from '../src/renderer-react/lib/markdown-links';
import { conversionService } from '../src/process/services/conversion-service.mjs';
import XLSX from 'xlsx';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function root() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-citations-')); roots.push(dir); return dir; }

test('document locations validate ranges, reject mixed navigation and preserve filename hashes', () => {
  expect(splitDocumentReference('moss-pdf://files/id#page=6&text=%E4%BB%98%E6%AC%BE')).toEqual({ reference: 'moss-pdf://files/id', location: { page: 6, text: '付款' } });
  expect(splitDocumentReference('/合同 #最终.pdf')).toEqual({ reference: '/合同 #最终.pdf' });
  expect(parseCellRange('$B$12:C14')).toEqual({ start: { row: 11, col: 1 }, end: { row: 13, col: 2 } });
  for (const fragment of ['page=0','page=-1','page=2&sheet=预算','range=B1','sheet=预算&range=XFE1','sheet=预算&range=C9:B1','page=1&page=2','text=x&bad=1']) expect(() => splitDocumentReference('/x.pdf#' + fragment)).toThrow();
});
test('provider citations resolve a canonical resource, carry locations through load and retain identity across repeated opens', async () => {
  const dir = await root(), file = path.join(dir,'中文 #100%.pdf'); await fs.writeFile(file,'PDF placeholder');
  const preview=path.join(dir,'pages.pdf');await fs.writeFile(preview,'%PDF-page-preview');
  const sourceSha256=createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const calls: string[] = [], session = { id:'a', workspace:dir, agentMode:'local' };
  const resolver = createPresentationResolver({ resolveResourceFile: async (uri: string) => { calls.push(uri); return { path:file,name:'合同.pdf',appId:'moss.pdf',creation:{sourceSha256,previewPdfPath:preview,quality:{state:'reviewed',reviewedPages:2}} }; }, readWorkspaceFile: async () => ({ path:file,contentType:'pdf',content:'',metadata:{} }) });
  const service = createPresentationService({storageRoot:path.join(dir,'state'),getSessionRecord:()=>session,...resolver,waitMs:0});
  await service.snapshot('a',{activate:true});
  const uri='moss-pdf://files/file';
  await service.present('a',{items:[{resource_uri:uri+'#page=2&text=付款'}]},{origin:'manual'});
  let snapshot=await service.snapshot('a'),resource=snapshot.resources[0];
  const loaded=await service.load('a',resource.id); expect(loaded.file.metadata.documentLocation).toEqual({page:2,text:'付款'});
  expect(loaded.file.metadata.officePreviewPdfPath).toBe(preview);
  let mediaHandler: any; installMediaProtocol({handle: (_scheme: string, handler: any) => { mediaHandler = handler; }});
  const response = await mediaHandler(new Request('moss-media://workspace/' + encodeURIComponent(dir) + '/pages.pdf'));
  expect(response.status).toBe(200);expect(await response.text()).toBe('%PDF-page-preview');
  const sibling=path.join(dir,'unrelated.pdf');await fs.writeFile(sibling,'unrelated');
  expect((await mediaHandler(new Request('moss-media://workspace/' + encodeURIComponent(dir) + '/unrelated.pdf'))).status).toBe(403);
  const sequence=resource.sequence;
  await service.present('a',{items:[{resource_uri:uri+'#page=2&text=付款'}]},{origin:'manual'});
  snapshot=await service.snapshot('a');expect(snapshot.resources).toHaveLength(1);expect(snapshot.resources[0].sequence).toBeGreaterThan(sequence);
  await service.refresh('a');expect((await service.load('a',resource.id)).file.metadata.documentLocation.page).toBe(2);
  expect(calls.every(value=>value===uri)).toBe(true);
  await fs.appendFile(file,'external Office edit');await service.refresh('a');expect((await service.load('a',resource.id)).file.metadata.creation.quality.state).toBe('stale');expect((await service.load('a',resource.id)).file.metadata.officePreviewPdfPath).toBeUndefined();
  const literal=path.join(dir,'literal#page=2');await fs.writeFile(literal,'literal');expect((await resolver.resolveItem(session,{path:literal},{origin:'manual'})).location).toBeUndefined();
});
test('native desktop App citation clicks use the owning main conversation', async () => {
  const calls:any[]=[];
  const host:any={presentation:{open:async(input:any)=>{calls.push(input);return {ok:true};}},openAppResource:async()=>{throw new Error('wrong route');},shell:{openExternal:async()=>{throw new Error('wrong route');}}};
  await handleMarkdownLinkClick({preventDefault(){}},'moss-spreadsheets://works/id#sheet=预算&range=B12',host,'session');
  expect(calls[0]).toEqual({sessionId:'session',input:{items:[{resource_uri:'moss-spreadsheets://works/id#sheet=预算&range=B12'}]}});
});
test('Excel conversion keeps leading blank rows so cited cells keep their real addresses', async () => {
  const dir=await root(),file=path.join(dir,'late.xlsx'),book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(sheet,[['付款',42000]],{origin:'B12'});XLSX.utils.book_append_sheet(book,sheet,'预算');await fs.writeFile(file,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
  const result=await conversionService.excelToJson(file);expect(result.success).toBe(true);expect(result.data.sheets[0].data[11][2]).toBe(42000);
});
