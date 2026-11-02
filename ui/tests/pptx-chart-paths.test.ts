import { expect, test } from 'bun:test';
import JSZip from 'jszip';
import { parseZip, parseZipLazyMedia } from '@aiden0z/pptx-renderer';

// OPC relationships point at full part paths. Different producers may store a
// chart beside its slide, and two directories may contain the same basename.
for (const parse of [parseZip, parseZipLazyMedia]) {
  test(`${parse.name}: standard and nested chart parts retain distinct paths and companion resources`, async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
    const roots = ['ppt/charts', 'ppt/slides/charts', 'ppt/custom/nested/charts'];
    for (const [index, root] of roots.entries()) {
      zip.file(`${root}/chart1.xml`, `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="${index}"/></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`);
      zip.file(`${root}/_rels/chart1.xml.rels`, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="style" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style1.xml"/></Relationships>');
      zip.file(`${root}/style1.xml`, '<cs:chartStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" id="102"/>');
      zip.file(`${root}/colors1.xml`, '<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" id="10"/>');
    }
    zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>');
    const parsed = await parse(await zip.generateAsync({ type: 'arraybuffer' }));
    expect([...parsed.charts.keys()].sort()).toEqual(roots.map(root => `${root}/chart1.xml`).sort());
    expect(parsed.slides.size).toBe(1);
    for (const [index, root] of roots.entries()) {
      expect(parsed.charts.get(`${root}/chart1.xml`)).toContain(`val="${index}"`);
      expect(parsed.chartRels?.get(`${root}/_rels/chart1.xml.rels`)).toContain('Target="style1.xml"');
      expect(parsed.chartStyles.get(`${root}/style1.xml`)).toContain('chartStyle');
      expect(parsed.chartColors.get(`${root}/colors1.xml`)).toContain('colorStyle');
    }
  });
}
