import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceHubTabs } from '../src/renderer-react/components/resource-hub-view';

describe('unified resource hub tabs', () => {
  test('orders skill, expert, and connector pages consistently', () => {
    const html = renderToStaticMarkup(
      <ResourceHubTabs activeTab="connectors" onChangeTab={() => {}} />,
    );
    expect(html).toContain('aria-label="连接器分类"');
    expect(html).toContain('>技能</button>');
    expect(html).toContain('>专家</button>');
    expect(html).toContain('>连接器</button>');
    expect(html.indexOf('>技能</button>')).toBeLessThan(html.indexOf('>专家</button>'));
    expect(html.indexOf('>专家</button>')).toBeLessThan(html.indexOf('>连接器</button>'));
    expect(html).not.toContain('伙伴');
    expect(html).not.toContain('border-b');
    expect(html).toContain('py-1');
    expect(html).toContain('h-7');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  test('marks a direct skill entry as the active tab', () => {
    const html = renderToStaticMarkup(
      <ResourceHubTabs activeTab="skills" onChangeTab={() => {}} />,
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>.*?技能<\/button>/);
  });
});
