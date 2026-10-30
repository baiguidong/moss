import JSZip from 'jszip';
import * as XLSX from 'xlsx-republish';

// Small, synthetic OOXML workbook covering the formatting that plain value
// readers lose. Prefix every element and include BOMs like Office writers do.
export async function styledWorkbook() {
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const xml = content => '\uFEFF<?xml version="1.0" encoding="UTF-8"?>' + content;
  const prefixed = content => xml(content.replace(/<(\/?)([A-Za-z][\w]*)(?=[\s/>])/g, '<$1x:$2').replace(`xmlns="${ns}"`, `xmlns:x="${ns}"`));
  const zip = await JSZip.loadAsync(XLSX.write({ SheetNames: ['销售'], Sheets: { '销售': { A1: { t: 's', v: '销售数据' }, '!ref': 'A1:D6' } } }, { type: 'buffer', bookType: 'xlsx' }));
  zip.file('xl/workbook.xml', prefixed(`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="销售" sheetId="1" r:id="sheet"/></sheets></workbook>`));
  zip.file('xl/_rels/workbook.xml.rels', xml(`<r:Relationships xmlns:r="http://schemas.openxmlformats.org/package/2006/relationships"><r:Relationship Id="sheet" Type="${rel}/worksheet" Target="/xl/worksheets/sheet1.xml"/><r:Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/><r:Relationship Id="theme" Type="${rel}/theme" Target="theme/theme1.xml"/></r:Relationships>`));
  zip.file('xl/theme/theme1.xml', xml('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:accent1><a:srgbClr val="156082"/></a:accent1></a:clrScheme></a:themeElements></a:theme>'));
  zip.file('xl/styles.xml', prefixed(`<styleSheet xmlns="${ns}">
    <fonts count="3"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FF1F4E78"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/></font></fonts>
    <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill></fills>
    <borders count="2"><border/><border><bottom style="thin"><color theme="4" tint="0.4"/></bottom></border></borders>
    <cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
    <cellXfs count="3"><xf fontId="0" fillId="0" borderId="0"/><xf fontId="1" fillId="0" borderId="0"><alignment horizontal="left" vertical="center"/></xf><xf fontId="2" fillId="2" borderId="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
    <dxfs count="2"><dxf><font><b/><color rgb="FFB91C1C"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill></dxf><dxf><font><color rgb="FF92400E"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill></dxf></dxfs>
  </styleSheet>`));
  zip.file('xl/worksheets/sheet1.xml', prefixed(`<worksheet xmlns="${ns}" xmlns:r="${rel}">
    <dimension ref="A1:D6"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="1" ySplit="3" state="frozen" topLeftCell="B4"/></sheetView></sheetViews>
    <sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="18"/><col min="2" max="3" width="13"/><col min="4" max="4" width="11"/></cols>
    <sheetData><row r="1" ht="28" customHeight="1"><c r="A1" t="inlineStr" s="1"><is><t>销售数据</t></is></c></row><row r="2" hidden="1"/>
    <row r="3" ht="30" customHeight="1">${['订单', '数量', '金额', '状态'].map((text, i) => `<c r="${String.fromCharCode(65 + i)}3" t="inlineStr" s="2"><is><t>${text}</t></is></c>`).join('')}</row>
    ${['已取消', '处理中', '已完成'].map((status, i) => `<row r="${i + 4}" ht="20" customHeight="1"><c r="A${i + 4}" t="inlineStr"><is><t>SO-000${i + 1}</t></is></c><c r="B${i + 4}"><v>${i + 1}</v></c><c r="C${i + 4}"><f>B${i + 4}*100</f><v>${(i + 1) * 100}</v></c><c r="D${i + 4}" t="inlineStr"><is><t>${status}</t></is></c></row>`).join('')}</sheetData>
    <mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>
    <conditionalFormatting sqref="C4:C6"><cfRule type="dataBar" priority="1"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF60A5FA"/></dataBar></cfRule></conditionalFormatting>
    <conditionalFormatting sqref="D4:D6"><cfRule type="containsText" text="已取消" dxfId="0" priority="2"/><cfRule type="containsText" text="处理中" dxfId="1" priority="3"/></conditionalFormatting>
    <tableParts count="1"><tablePart r:id="table"/></tableParts>
  </worksheet>`));
  zip.file('xl/worksheets/_rels/sheet1.xml.rels', xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="table" Type="${rel}/table" Target="../tables/table1.xml"/></Relationships>`));
  zip.file('xl/tables/table1.xml', prefixed(`<table xmlns="${ns}" id="1" name="Sales" displayName="Sales" ref="A3:D6" totalsRowShown="0"><tableColumns count="4">${['订单', '数量', '金额', '状态'].map((name, i) => `<tableColumn id="${i + 1}" name="${name}"/>`).join('')}</tableColumns><tableStyleInfo name="TableStyleMedium2" showRowStripes="1"/></table>`));
  return zip.generateAsync({ type: 'nodebuffer' });
}
