import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceHubTabs } from '../src/renderer-react/components/resource-hub-view';

describe('unified resource hub tabs', () => {
  test('places Apps after skills and experts in the plugin hub', () => {
    const html = renderToStaticMarkup(
      <ResourceHubTabs activeTab="experts" onChangeTab={() => {}} />,
    );
    expect(html).toContain('aria-label="资源分类"');
    expect(html).toContain('>常用</button>');
    expect(html).toContain('>技能</button>');
    expect(html).toContain('>专家</button>');
    expect(html).toContain('>Apps</button>');
    expect(html).not.toContain('>连接器</button>');
    expect(html.indexOf('>常用</button>')).toBeLessThan(html.indexOf('>技能</button>'));
    expect(html.indexOf('>技能</button>')).toBeLessThan(html.indexOf('>专家</button>'));
    expect(html.indexOf('>专家</button>')).toBeLessThan(html.indexOf('>Apps</button>'));
    expect(html).not.toContain('伙伴');
    expect(html).not.toContain('border-b');
    expect(html).toContain('py-1');
    expect(html).toContain('h-7');
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  test('marks direct resource entries as the active tab', () => {
    for (const [tab, label] of [['skills', '技能'], ['apps', 'Apps']] as const) {
      const html = renderToStaticMarkup(
        <ResourceHubTabs activeTab={tab} onChangeTab={() => {}} />,
      );
      expect(html).toMatch(new RegExp(`aria-selected="true"[^>]*>.*?${label}</button>`));
    }
  });

  test('supports the common installed-resources tab', () => {
    const html = renderToStaticMarkup(
      <ResourceHubTabs activeTab="common" onChangeTab={() => {}} />,
    );
    expect(html).toMatch(/aria-selected="true"[^>]*>.*?常用<\/button>/);
  });
});
