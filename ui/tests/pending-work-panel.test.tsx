import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PendingWorkPanel } from '../src/renderer-react/components/pending-work-panel';

describe('pending work panel', () => {
  test('shows grouped work and actionable count', () => {
    const html = renderToStaticMarkup(
      <PendingWorkPanel
        items={[
          { id: 'q-1', source: 'question', state: 'attention', title: '销售周报', summary: '选择发送时间', createdAt: Date.now(), dedupeKey: 'q-1' },
          { id: 'r-1', source: 'result', state: 'review', title: '客户分析', summary: '结果已生成', createdAt: Date.now(), dedupeKey: 'r-1' },
        ]}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain('待处理');
    expect(html).toContain('2 项需要你处理');
    expect(html).toContain('需要回答');
    expect(html).toContain('新结果');
    expect(html).toContain('data-pending-work-item="q-1"');
  });

  test('shows an empty state', () => {
    const html = renderToStaticMarkup(<PendingWorkPanel items={[]} onOpen={() => {}} />);
    expect(html).toContain('现在没有待处理事项');
  });
});

