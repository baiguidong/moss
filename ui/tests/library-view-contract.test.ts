import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatLibraryResourceError } from '../src/renderer-react/lib/library-ui';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('Library view interaction contract', () => {
  test('explains parser failures in customer-facing Chinese', () => {
    expect(formatLibraryResourceError({
      error: 'Invalid control character at: line 89 column 48 (char 2032)',
      extension: '.json',
      size: 6980,
    })).toBe('JSON 格式错误：第 89 行第 48 列包含未转义的换行或控制字符。');
    expect(formatLibraryResourceError({
      error: 'The document parser returned no readable text.',
      extension: '.md',
      size: 0,
    })).toBe('文件为空，没有可建立索引的文字内容。');
    expect(formatLibraryResourceError({
      error: 'The document parser returned no readable text.',
      extension: '.pptx',
      size: 1024,
    })).toContain('演示文稿可能仅包含图片');
    expect(formatLibraryResourceError({
      error: "ModuleNotFoundError: No module named 'pypdf'",
      extension: '.pdf',
      size: 1024,
    })).toContain('缺少对应的文档解析扩展');
  });

  test('uses an in-app Chinese collection editor instead of window.prompt', () => {
    const source = readFileSync(
      path.join(uiRoot, 'src', 'renderer-react', 'components', 'library-view.tsx'),
      'utf8',
    );
    const appSource = readFileSync(
      path.join(uiRoot, 'src', 'renderer-react', 'App.tsx'),
      'utf8',
    );

    expect(source).not.toContain('window.prompt');
    expect(source).not.toContain('COLLECTIONS');
    expect(source).not.toContain('Collection 名称');
    expect(source).not.toContain('当前 Collection');
    expect(source).toContain('aria-label="新建资料集"');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('await load(collection.id)');
    expect(source).toContain('aria-label="资料库扩展"');
    expect(source).toContain('installExtensions({');
    expect(source).toContain('type="checkbox"');
    expect(source).toContain('aria-label={`选择${entry.label}`}');
    expect(source).toContain('安装所选');
    expect(source).toContain('安装可选的文档解析扩展');
    expect(source).toContain('暂不安装');
    expect(source).toContain('资料库扩展正在后台安装');
    expect(source).toContain('setExtensionsOpen(false)');
    expect(source).toContain('<ScrollArea constrainContentWidth');
    expect(source).toContain('aria-label={`打开文件 ${node.name}`}');
    expect(source).not.toContain('onClick={() => void window.agentDesktop.library.openResource({ resourceId: resource.id })}>');
    expect(source).toContain('aria-label="添加资料目录"');
    expect(source).toContain('window.agentDesktop.library.selectDirectory()');
    expect(source).toContain('onPrepareDirectoryImport({');
    expect(appSource).toContain('window.agentDesktop.library.prepareDirectoryImport(payload)');
    expect(appSource).toContain('onPrepareDirectoryImport={handlePrepareLibraryDirectoryImport}');
    expect(appSource).toContain("setActiveView('chat')");
    expect(appSource).toContain('setActiveSessionId(null)');
    expect(appSource).toContain('setInput(draftPrompt)');
    expect(appSource).toContain("composerDraftsRef.current.home = { text: draftPrompt, files: [] }");
    expect(appSource).toContain('homeWorkspace={pendingNewSessionContext?.workspace}');
    expect(appSource).not.toContain('preparedSession?.sessionKind');
    expect(appSource).toContain('if (sessionId && preparedSession) setPendingNewSessionContext(null)');
    expect(source).not.toContain('analyzeSelectedDirectory');
    expect(source).not.toContain('addSelectedDirectory');
    expect(source).not.toContain('directoryScanOpen');
    expect(source).not.toContain('开始智能扫描');
    expect(source).not.toContain('目录搜索层数');
    expect(source).not.toContain('目录最多文件数');
    expect(source).not.toContain('选择全部支持的文件类型');
    expect(source).not.toContain('扫描源代码');
    expect(source).toContain('cancelCollectionIndexing(activeCollectionJobs)');
    expect(source).toContain('border-destructive/40');
    expect(source).toContain('onContextMenu={(event) => {');
    expect(source).toContain('在文件夹中显示');
    expect(source).toContain('showResourceInFolder({ resourceId: resource.id })');
    expect(source).toContain('失败原因');
    expect(source).toContain('<ResourceStatus resource={resource} indexing={indexing} />');
    expect(source).toContain('job.progress.currentResourceId');
    expect(source).toContain('aria-label="资料目录"');
    expect(source).toContain('buildLibraryResourceTree(resources)');
    expect(source).toContain('lg:grid-cols-[240px_minmax(0,1fr)]');
    expect(source).not.toContain('lg:grid-cols-[240px_minmax(0,1fr)_280px]');
    expect(source).not.toContain('changeScope');
    expect(source).not.toContain('>来源</span>');
    expect(source).toContain('检索评测与诊断');
    expect(source).toContain('diagnoseSearch({');
    expect(source).toContain('saveEvaluationCase({');
    expect(source).toContain('runEvaluation({})');
    expect(source).toContain('候选排序');
    expect(source).toContain('覆盖率过滤');
    expect(source).toContain('P95');
    expect(source).toContain('formatSearchLocation(result)');
    expect(source).toContain('加载更多');
    expect(source).toContain('offset: resources.length');
  });
});
