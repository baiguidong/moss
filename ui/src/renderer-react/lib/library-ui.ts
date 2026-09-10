import type { LibraryResource } from '@/types';

export function formatLibraryResourceError(
  resource: Pick<LibraryResource, 'error' | 'extension' | 'size'>,
) {
  const value = String(resource.error || '').trim();
  if (!value) return '';
  const invalidControl = value.match(/Invalid control character at: line (\d+) column (\d+)/i);
  if (invalidControl) {
    return `JSON 格式错误：第 ${invalidControl[1]} 行第 ${invalidControl[2]} 列包含未转义的换行或控制字符。`;
  }
  if (/returned no readable text|contains no indexable text/i.test(value)) {
    if (resource.size === 0) return '文件为空，没有可建立索引的文字内容。';
    if (resource.extension === '.pptx') {
      return '未读取到文字内容；演示文稿可能仅包含图片，或当前解析扩展无法处理该文件。';
    }
    if (resource.extension === '.html' || resource.extension === '.htm') {
      return '未读取到正文；网页文件可能只包含脚本、框架或空页面。';
    }
    return '未读取到可建立索引的文字内容；文件可能为空、仅包含图片或格式无法解析。';
  }
  if (/No module named|ModuleNotFoundError/i.test(value)) {
    return '缺少对应的文档解析扩展，请在资料库“扩展”中安装后重试。';
  }
  return value;
}
