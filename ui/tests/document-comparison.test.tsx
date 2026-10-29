import { test, expect } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentComparisonViewer } from '../src/renderer-react/components/preview/viewers/DocumentComparisonViewer';
const side = (text: string, detail?: any) => ({ text, detail, location: { page: 2 } });
const render = (changes: any[]) => renderToStaticMarkup(<DocumentComparisonViewer content={JSON.stringify({schema:'moss.document-comparison/v1',count:changes.length,complete:true,before:{uri:'moss-presentations://works/old'},after:{uri:'moss-presentations://works/new'},changes})}/>);
test('text comparison highlights actual changed characters and escapes document markup',()=>{
 const html=render([{key:'text',label:'第 2 页',kind:'changed',before:side('增长率 25%，<script>'),after:side('增长率 28%，<script>')}]);
 expect(html).toContain('data-diff-highlight');expect(html).toMatch(/>5<\/mark>/);expect(html).toMatch(/>8<\/mark>/);expect(html).not.toContain('<script>');
});
test('table comparison shows changed cells without repeating unrelated rows',()=>{
 const html=render([{key:'table',label:'第 2 页 · Table 0',kind:'changed',before:side('指标\n25%\n未修改行',{type:'table',rows:[['指标','结果'],['增长率','25%'],['未修改行','90%']]}),after:side('指标\n28%\n未修改行',{type:'table',rows:[['指标','结果'],['增长率','28%'],['未修改行','90%']]})}]);
 expect(html).toContain('第 2 行 · 第 2 列');expect(html).toContain('25%');expect(html).toContain('28%');expect(html).not.toContain('未修改行');
});
test('malformed comparison entries show a readable error instead of crashing',()=>{
 expect(render([null])).toContain('修改对比数据不可用');expect(render([{key:'x',label:'x',before:{text:1},after:null}])).toContain('修改对比数据不可用');
});
