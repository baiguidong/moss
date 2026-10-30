import { DOMParser } from '@xmldom/xmldom';
import path from 'node:path';

export function parseOfficeXml(content) {
  // ZIP members may start with a UTF-8 BOM. It is an encoding marker, not
  // document text; xmldom otherwise rejects the following XML declaration.
  const xml = typeof content === 'string' ? content : content.toString('utf8');
  return new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'text/xml');
}

export const xmlElements = (node, name) => node ? Array.from(node.getElementsByTagNameNS('*', name)) : [];
export const xmlChildren = (node, name) => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1 && (!name || child.localName === name));
export const xmlChild = (node, name) => xmlChildren(node, name)[0];
export const officePartPath = (from, target) => path.posix.resolve('/', path.posix.dirname(from), target).slice(1);

export function officeRelationships(entries, part) {
  const entry = entries.get(path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels'));
  return new Map(entry ? xmlElements(parseOfficeXml(entry), 'Relationship').filter(node => node.getAttribute('TargetMode') !== 'External').map(node => [node.getAttribute('Id'), {
    type: node.getAttribute('Type'), path: officePartPath(part, node.getAttribute('Target')),
  }]) : []);
}
