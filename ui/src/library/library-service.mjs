import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LIBRARY_RESOURCE_SCHEME, parseLibraryResourceUri } from './library-resource-uri.mjs';

import {
  DEFAULT_LIBRARY_DIRECTORY_SCAN,
  SUPPORTED_LIBRARY_EXTENSIONS,
} from './library-config.mjs';

export {
  DEFAULT_LIBRARY_DIRECTORY_SCAN,
  SUPPORTED_LIBRARY_EXTENSIONS,
} from './library-config.mjs';

export { LIBRARY_RESOURCE_SCHEME, parseLibraryResourceUri } from './library-resource-uri.mjs';
export const LIBRARY_SCHEMA_VERSION = 6;

const SUPPORTED_EXTENSION_SET = new Set(SUPPORTED_LIBRARY_EXTENSIONS);
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git', '.hg', '.moss', '.svn', 'build', 'coverage', 'dist', 'node_modules',
  'target', '__pycache__',
]);
const IGNORED_FILE_NAMES = new Set([
  'credentials', 'id_dsa', 'id_ed25519', 'id_rsa', 'known_hosts', 'netrc',
]);
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_FILES = 10_000;
const DEFAULT_CHUNK_SIZE = 1_200;
const DEFAULT_CHUNK_OVERLAP = 160;
const DEFAULT_SEARCH_CONTEXT_CHARS = 3_600;
const DEFAULT_SEARCH_TOTAL_CONTEXT_CHARS = 18_000;
const MAX_PARSE_CACHE_ENTRIES = 500;
const MAX_PARSE_CACHE_ENTRY_BYTES = 5 * 1024 * 1024;
const MAX_PARSE_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_LIBRARY_METRICS = 1_000;
const DEFAULT_WATCH_DEBOUNCE_MS = 750;
const DEFAULT_WATCH_FALLBACK_MS = 60_000;
const MAX_JOB_ATTEMPTS = 3;
const SEARCH_FTS_COLUMNS = ['title_terms', 'path_terms', 'heading_terms', 'body_terms', 'resource_id'];
const MANAGED_LIBRARY_CATEGORY_LABELS = new Map([
  ['work', '工作与项目'],
  ['study', '学习与研究'],
  ['finance', '财务与票据'],
  ['records', '个人档案'],
  ['life', '生活资料'],
  ['creative', '创作与收藏'],
  ['reference', '参考资料'],
  ['other', '其他资料'],
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function now() {
  return Date.now();
}

function safeName(value, fallback = 'resource') {
  return text(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || fallback;
}

function safeRelativePath(value) {
  const normalized = text(value).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || path.posix.isAbsolute(normalized)) return '';
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return '';
  return parts.map((part) => safeName(part, 'resource')).join('/');
}

function normalizeCollectionName(value) {
  const normalized = text(value).replace(/\s+/g, ' ').slice(0, 80);
  if (!normalized) throw new Error('资料集名称不能为空。');
  return normalized;
}

function normalizeLibraryScope(value, fallback = { kind: 'personal' }) {
  if (value?.kind === 'project' && text(value.projectId)) {
    return { kind: 'project', projectId: text(value.projectId) };
  }
  if (value?.kind === 'personal') return { kind: 'personal' };
  return fallback;
}

function providerCapabilities(providerKind) {
  if (providerKind === 'project-assets') return ['list', 'search', 'read', 'watch', 'version'];
  if (providerKind === 'task-artifacts') return ['list', 'search', 'read', 'write', 'delete', 'version'];
  if (providerKind === 'managed-files') return ['list', 'search', 'read', 'write', 'delete', 'version'];
  return ['list', 'search', 'read', 'watch', 'version'];
}

function isPathInside(root, candidate, { allowRoot = true } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (allowRoot && relative === '')
    || (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function indexingCancelledError() {
  const error = new Error('Library indexing was cancelled.');
  error.code = 'INDEX_CANCELLED';
  return error;
}

function throwIfIndexingCancelled(signal) {
  if (signal?.aborted) throw indexingCancelledError();
}

async function sha256File(filePath, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(indexingCancelledError());
      return;
    }
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => stream.destroy(indexingCancelledError());
    signal?.addEventListener('abort', onAbort, { once: true });
    stream.on('error', (error) => {
      cleanup();
      reject(error);
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      cleanup();
      resolve(hash.digest('hex'));
    });
  });
}

function extensionMimeType(extension) {
  return ({
    '.csv': 'text/csv',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.htm': 'text/html',
    '.html': 'text/html',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.pdf': 'application/pdf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xml': 'application/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
  })[extension] || 'text/plain';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function appendAccessScope(clauses, params, alias, input = {}) {
  const projectOnlyId = text(input.projectOnlyId);
  if (projectOnlyId) {
    clauses.push(`${alias}.scope_kind = 'project' AND ${alias}.scope_id = ?`);
    params.push(projectOnlyId);
    return;
  }
  const projectId = text(input.projectId);
  if (projectId) {
    clauses.push(`(${alias}.scope_kind = 'personal' OR (${alias}.scope_kind = 'project' AND ${alias}.scope_id = ?))`);
    params.push(projectId);
    return;
  }
  if (input.personalOnly === true) clauses.push(`${alias}.scope_kind = 'personal'`);
}

function globPattern(value) {
  const pattern = text(value).replaceAll('\\', '/');
  if (!pattern) return null;
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`, 'i');
}

function normalizeExtensions(values) {
  return unique((Array.isArray(values) ? values : [])
    .flatMap((value) => String(value || '').split(','))
    .map((value) => text(value).toLowerCase())
    .map((value) => value && (value.startsWith('.') ? value : `.${value}`))
    .filter((value) => SUPPORTED_EXTENSION_SET.has(value)));
}

export function tokenizeLibraryText(value) {
  const normalized = String(value || '').normalize('NFKC').toLocaleLowerCase('en-US');
  const tokens = [];
  try {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    for (const segment of segmenter.segment(normalized)) {
      if (segment.isWordLike && /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(segment.segment)) {
        tokens.push(segment.segment);
      }
    }
  } catch {}
  for (const match of normalized.matchAll(/[a-z0-9_]+|[\u3400-\u4dbf\u4e00-\u9fff]+/gu)) {
    const token = match[0];
    if (/^[a-z0-9_]+$/.test(token)) {
      tokens.push(token);
      continue;
    }
    const characters = [...token];
    tokens.push(...characters);
    for (let index = 0; index < characters.length - 1; index += 1) {
      tokens.push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return unique(tokens).join(' ');
}

export function buildLibraryFtsQuery(value, mode = 'all') {
  const tokens = tokenizeLibraryText(value).split(/\s+/).filter(Boolean).slice(0, 32);
  const operator = mode === 'any' ? ' OR ' : ' AND ';
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(operator);
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
}

function searchMatchedFields(row, queryTokens) {
  const fields = [
    ['title', row.title],
    ['path', row.relative_path],
    ['heading', row.heading],
    ['body', row.content],
  ];
  return fields.filter(([, value]) => {
    const tokens = new Set(tokenizeLibraryText(value).split(/\s+/).filter(Boolean));
    return queryTokens.some((token) => tokens.has(token));
  }).map(([field]) => field);
}

function searchTokenCoverage(row, queryTokens) {
  const fieldTokens = new Set(tokenizeLibraryText([
    row.title, row.relative_path, row.heading, row.content,
  ].filter(Boolean).join('\n')).split(/\s+/).filter(Boolean));
  const terms = unique(queryTokens);
  if (terms.length === 0) return 0;
  return terms.filter((token) => fieldTokens.has(token)).length / terms.length;
}

function mergeOverlappingText(parts) {
  let merged = '';
  for (const rawPart of parts) {
    const part = String(rawPart || '').trim();
    if (!part) continue;
    if (!merged) {
      merged = part;
      continue;
    }
    let overlap = Math.min(512, merged.length, part.length);
    while (overlap >= 16 && merged.slice(-overlap) !== part.slice(0, overlap)) overlap -= 1;
    merged = overlap >= 16 ? `${merged}${part.slice(overlap)}` : `${merged}\n\n${part}`;
  }
  return merged;
}

function trimAroundMatch(value, maximumLength, query = '', queryTerms = []) {
  const content = String(value || '');
  const limit = Math.max(1, Number(maximumLength) || 1);
  if (content.length <= limit) return content;
  const normalized = content.normalize('NFKC').toLocaleLowerCase('en-US');
  const candidates = [normalizeSearchText(query), ...(Array.isArray(queryTerms) ? queryTerms : [])]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let matchIndex = -1;
  let matchLength = 0;
  for (const candidate of candidates) {
    matchIndex = normalized.indexOf(candidate);
    if (matchIndex >= 0) {
      matchLength = candidate.length;
      break;
    }
  }
  if (matchIndex < 0) matchIndex = Math.floor(content.length / 2);
  const midpoint = matchIndex + Math.floor(matchLength / 2);
  let start = Math.max(0, midpoint - Math.floor(limit / 2));
  start = Math.min(start, content.length - limit);
  return content.slice(start, start + limit).trim();
}

function trimPreservingAnchor(value, anchor, maximumLength, query, queryTerms) {
  const content = String(value || '');
  const limit = Math.max(1, Number(maximumLength) || 1);
  if (content.length <= limit) return content;
  const anchorText = String(anchor || '');
  if (!anchorText || anchorText.length >= limit) {
    return trimAroundMatch(anchorText || content, limit, query, queryTerms);
  }
  const anchorIndex = content.indexOf(anchorText);
  if (anchorIndex < 0) return trimAroundMatch(content, limit, query, queryTerms);
  const remaining = limit - anchorText.length;
  let start = Math.max(0, anchorIndex - Math.floor(remaining / 2));
  let end = Math.min(content.length, anchorIndex + anchorText.length + Math.ceil(remaining / 2));
  if (end - start < limit) start = Math.max(0, end - limit);
  if (end - start < limit) end = Math.min(content.length, start + limit);
  return content.slice(start, end).trim();
}

function inferLocationKind(extension, page, startLine) {
  if (extension === '.pptx' && page) return 'slide';
  if (extension === '.xlsx' && page) return 'sheet';
  if (extension === '.pdf' && page) return 'page';
  if (extension === '.docx' && startLine) return 'paragraph';
  if (startLine) return 'line';
  return null;
}

export function evaluateLibraryRetrievalCases(cases, resultSets, durations = []) {
  const values = Array.isArray(cases) ? cases : [];
  if (values.length === 0) {
    return {
      cases: 0, positiveCases: 0, negativeCases: 0, hitAt1: 0, hitAt5: 0,
      mrr: 0, negativeAccuracy: 0, noResultRate: 0, latencyP50Ms: 0, latencyP95Ms: 0,
    };
  }
  let hitsAt1 = 0;
  let hitsAt5 = 0;
  let reciprocalRanks = 0;
  let noResults = 0;
  let positiveCases = 0;
  let negativeCases = 0;
  let correctNegatives = 0;
  values.forEach((entry, index) => {
    const expected = new Set(Array.isArray(entry.expectedResourceIds) ? entry.expectedResourceIds : []);
    const results = Array.isArray(resultSets?.[index]) ? resultSets[index] : [];
    if (results.length === 0) noResults += 1;
    if (expected.size === 0) {
      negativeCases += 1;
      if (results.length === 0) correctNegatives += 1;
      return;
    }
    positiveCases += 1;
    const rank = results.findIndex((result) => expected.has(result.resourceId));
    if (rank === 0) hitsAt1 += 1;
    if (rank >= 0 && rank < 5) hitsAt5 += 1;
    if (rank >= 0) reciprocalRanks += 1 / (rank + 1);
  });
  const sortedDurations = durations.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  const percentile = (ratio) => sortedDurations.length === 0
    ? 0
    : sortedDurations[Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * ratio) - 1)];
  return {
    cases: values.length,
    positiveCases,
    negativeCases,
    hitAt1: positiveCases ? hitsAt1 / positiveCases : 0,
    hitAt5: positiveCases ? hitsAt5 / positiveCases : 0,
    mrr: positiveCases ? reciprocalRanks / positiveCases : 0,
    negativeAccuracy: negativeCases ? correctNegatives / negativeCases : 0,
    noResultRate: noResults / values.length,
    latencyP50Ms: percentile(0.5),
    latencyP95Ms: percentile(0.95),
  };
}

export async function runLibraryRetrievalEvaluation(cases, search) {
  const resultSets = [];
  const durations = [];
  for (const entry of Array.isArray(cases) ? cases : []) {
    const startedAt = performance.now();
    resultSets.push(await search(entry));
    durations.push(performance.now() - startedAt);
  }
  return evaluateLibraryRetrievalCases(cases, resultSets, durations);
}

export function createLibraryResourceUri(resourceId, revision, displayName = '') {
  const id = text(resourceId);
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid Library resource id.');
  const params = new URLSearchParams();
  if (text(revision)) params.set('revision', text(revision));
  if (text(displayName)) params.set('name', text(displayName).slice(0, 180));
  return `moss-library://resource/${id}${params.size ? `?${params}` : ''}`;
}

export function createLibraryScopeUri(kind, id, displayName = '') {
  if (!['collection', 'source'].includes(kind)) throw new Error('Invalid Library scope kind.');
  const resourceId = text(id);
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(resourceId)) throw new Error('Invalid Library scope id.');
  const params = new URLSearchParams();
  if (text(displayName)) params.set('name', text(displayName).slice(0, 180));
  return `moss-library://${kind}/${resourceId}${params.size ? `?${params}` : ''}`;
}

function splitLongText(value, size, overlap) {
  const textValue = String(value || '').trim();
  if (!textValue) return [];
  if (textValue.length <= size) return [{ content: textValue, start: 0, end: textValue.length }];
  const chunks = [];
  let cursor = 0;
  while (cursor < textValue.length) {
    let end = Math.min(textValue.length, cursor + size);
    if (end < textValue.length) {
      const boundary = Math.max(
        textValue.lastIndexOf('\n', end),
        textValue.lastIndexOf('。', end),
        textValue.lastIndexOf('. ', end),
        textValue.lastIndexOf(' ', end),
      );
      if (boundary > cursor + Math.floor(size * 0.55)) end = boundary + 1;
    }
    const rawPart = textValue.slice(cursor, end);
    const leading = rawPart.length - rawPart.trimStart().length;
    const content = rawPart.trim();
    if (content) {
      chunks.push({
        content,
        start: cursor + leading,
        end: cursor + leading + content.length,
      });
    }
    if (end >= textValue.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }
  return chunks;
}

export function chunkLibraryBlocks(blocks, options = {}) {
  const size = Number(options.size) || DEFAULT_CHUNK_SIZE;
  const overlap = Math.min(Number(options.overlap) || DEFAULT_CHUNK_OVERLAP, Math.floor(size / 3));
  const result = [];
  for (const [blockIndex, block] of (Array.isArray(blocks) ? blocks : []).entries()) {
    const content = text(block?.text);
    if (!content) continue;
    for (const part of splitLongText(content, size, overlap)) {
      const declaredStartLine = Number(block?.startLine);
      const baseStartLine = Number.isInteger(declaredStartLine) && declaredStartLine > 0
        ? declaredStartLine
        : null;
      const startLine = baseStartLine === null
        ? null
        : baseStartLine + (content.slice(0, part.start).match(/\n/g)?.length || 0);
      const endLine = startLine === null
        ? null
        : startLine + (part.content.match(/\n/g)?.length || 0);
      result.push({
        content: part.content,
        heading: text(block?.heading) || null,
        page: block?.page !== null && block?.page !== undefined && Number.isFinite(Number(block.page))
          ? Number(block.page)
          : null,
        blockIndex,
        startLine,
        endLine,
        locationKind: text(block?.locationKind) || null,
      });
    }
  }
  return result;
}

export function resolveLibraryParserPath({ isPackaged, resourcesPath, uiRoot }) {
  return isPackaged
    ? path.join(resourcesPath, 'library', 'library_parser.py')
    : path.join(uiRoot, 'resources', 'library', 'library_parser.py');
}

export async function parseLibraryDocumentWithPython({
  filePath,
  parserPath,
  pythonPath = process.env.MOSS_PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3'),
  pythonModulePaths = [],
  timeoutMs = 90_000,
  signal,
}) {
  const modulePath = [
    ...(Array.isArray(pythonModulePaths) ? pythonModulePaths : []),
  ].filter(Boolean).join(path.delimiter);
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [parserPath, 'ingest-resource', '--path', filePath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONNOUSERSITE: '1',
        PYTHONUTF8: '1',
        PYTHONPATH: modulePath,
      },
    });
    let stdout = '';
    let stderr = '';
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const error = new Error(`Library parser timed out for ${path.basename(filePath)}.`);
      error.code = 'PARSER_TIMEOUT';
      reject(error);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 32 * 1024 * 1024) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 1024 * 1024) child.kill('SIGKILL');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        const error = new Error(`Library parsing was cancelled for ${path.basename(filePath)}.`);
        error.code = 'PARSER_CANCELLED';
        reject(error);
        return;
      }
      if (code !== 0) {
        let parserError = null;
        try {
          parserError = parseJson(stderr.trim().split('\n').at(-1), {}).error || null;
        } catch {}
        const error = new Error(
          text(parserError?.message) || stderr.trim() || `Library parser exited with code ${code}.`,
        );
        error.code = text(parserError?.code) || 'PARSER_FAILED';
        reject(error);
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.schemaVersion !== 1 || parsed.operation !== 'ingest-resource' || parsed.ok !== true) {
          throw new Error('Parser response does not match worker protocol version 1.');
        }
        if (!Array.isArray(parsed.payload?.blocks)) throw new Error('Parser response has no blocks.');
        resolve(parsed.payload);
      } catch (error) {
        reject(new Error(`Invalid Library parser response: ${error.message}`));
      }
    });
  });
}

async function listLocalFiles(rootPath, options = {}) {
  const signal = options.signal;
  throwIfIndexingCancelled(signal);
  const maxFiles = Math.min(
    DEFAULT_MAX_SOURCE_FILES,
    Math.max(1, Number(options.maxFiles) || DEFAULT_LIBRARY_DIRECTORY_SCAN.maxFiles),
  );
  const maxFileBytes = Math.max(1, Number(options.maxFileBytes) || DEFAULT_MAX_FILE_BYTES);
  const recursive = options.recursive !== false;
  const maxDepth = Number.isInteger(options.maxDepth) && options.maxDepth >= 0
    ? options.maxDepth
    : DEFAULT_LIBRARY_DIRECTORY_SCAN.maxDepth;
  const includePatterns = (Array.isArray(options.include) ? options.include : []).map(globPattern).filter(Boolean);
  const excludePatterns = (Array.isArray(options.exclude) ? options.exclude : []).map(globPattern).filter(Boolean);
  const configuredExtensions = normalizeExtensions(options.extensions);
  const extensionSet = new Set(
    configuredExtensions.length > 0 ? configuredExtensions : SUPPORTED_LIBRARY_EXTENSIONS,
  );
  const excludedRoots = (Array.isArray(options.excludedRoots) ? options.excludedRoots : [])
    .map((value) => path.resolve(value));
  const rootLinkStat = await fsp.lstat(rootPath);
  throwIfIndexingCancelled(signal);
  if (rootLinkStat.isSymbolicLink()) throw new Error('Library source roots cannot be symbolic links.');
  const rootStat = await fsp.stat(rootPath);
  throwIfIndexingCancelled(signal);
  if (rootStat.isFile()) {
    const relativePath = path.basename(rootPath);
    const extension = path.extname(rootPath).toLowerCase();
    if (!SUPPORTED_EXTENSION_SET.has(extension)
      || !extensionSet.has(extension)
      || rootStat.size > maxFileBytes
      || (includePatterns.length > 0 && !includePatterns.some((pattern) => pattern.test(relativePath)))
      || excludePatterns.some((pattern) => pattern.test(relativePath))) return [];
    return [{
      path: rootPath,
      stat: rootStat,
      relativePath,
      indexable: true,
      unsupportedReason: '',
    }];
  }
  if (!rootStat.isDirectory()) throw new Error('Library source is not a file or directory.');

  const files = [];
  const queue = [{ directory: rootPath, depth: 0 }];
  while (queue.length > 0 && files.length < maxFiles) {
    throwIfIndexingCancelled(signal);
    const { directory, depth } = queue.shift();
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    throwIfIndexingCancelled(signal);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      throwIfIndexingCancelled(signal);
      if (entry.name.startsWith('.') || IGNORED_FILE_NAMES.has(entry.name.toLowerCase())) continue;
      const entryPath = path.join(directory, entry.name);
      if (excludedRoots.some((excludedRoot) => isPathInside(excludedRoot, entryPath))) continue;
      if (entry.isDirectory()) {
        if (recursive && !IGNORED_DIRECTORY_NAMES.has(entry.name)
          && (maxDepth === null || depth < maxDepth)) {
          queue.push({ directory: entryPath, depth: depth + 1 });
        }
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !SUPPORTED_EXTENSION_SET.has(extension) || !extensionSet.has(extension)) continue;
      const relativePath = path.relative(rootPath, entryPath).replaceAll(path.sep, '/');
      if (includePatterns.length > 0 && !includePatterns.some((pattern) => pattern.test(relativePath))) continue;
      if (excludePatterns.some((pattern) => pattern.test(relativePath))) continue;
      const stat = await fsp.stat(entryPath);
      throwIfIndexingCancelled(signal);
      if (stat.size > maxFileBytes) continue;
      files.push({
        path: entryPath,
        stat,
        relativePath,
        indexable: true,
        unsupportedReason: '',
      });
      if (files.length >= maxFiles) break;
    }
  }
  return files;
}

function initializeSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS library_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_collections (
      id TEXT PRIMARY KEY,
      scope_kind TEXT NOT NULL DEFAULT 'personal',
      scope_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_sources (
      id TEXT PRIMARY KEY,
      provider_kind TEXT NOT NULL,
      scope_kind TEXT NOT NULL DEFAULT 'personal',
      scope_id TEXT,
      locator TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'idle',
      error TEXT NOT NULL DEFAULT '',
      revision TEXT,
      indexed_revision TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER,
      UNIQUE(provider_kind, locator)
    );

    CREATE TABLE IF NOT EXISTS library_collection_sources (
      collection_id TEXT NOT NULL REFERENCES library_collections(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES library_sources(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(collection_id, source_id)
    );

    CREATE TABLE IF NOT EXISTS library_resources (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES library_sources(id) ON DELETE CASCADE,
      provider_resource_id TEXT NOT NULL,
      uri TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      locator TEXT NOT NULL,
      relative_path TEXT NOT NULL DEFAULT '',
      extension TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'discovered',
      error TEXT NOT NULL DEFAULT '',
      revision TEXT,
      indexed_revision TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER,
      UNIQUE(source_id, provider_resource_id)
    );

    CREATE INDEX IF NOT EXISTS library_resources_source_status
      ON library_resources(source_id, status);

    CREATE TABLE IF NOT EXISTS library_jobs (
      id TEXT PRIMARY KEY,
      source_id TEXT REFERENCES library_sources(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      progress_json TEXT NOT NULL DEFAULT '{}',
      error TEXT NOT NULL DEFAULT '',
      error_code TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );

    CREATE UNIQUE INDEX IF NOT EXISTS library_jobs_one_active_source
      ON library_jobs(source_id)
      WHERE status IN ('queued', 'running');

    CREATE TABLE IF NOT EXISTS library_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id TEXT NOT NULL REFERENCES library_resources(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      block_index INTEGER NOT NULL DEFAULT 0,
      heading TEXT,
      page INTEGER,
      start_line INTEGER,
      end_line INTEGER,
      content TEXT NOT NULL,
      indexed_content TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      UNIQUE(resource_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS library_chunks_resource
      ON library_chunks(resource_id, chunk_index);

    CREATE TABLE IF NOT EXISTS library_parse_cache (
      cache_key TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      parser_signature TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS library_parse_cache_last_used
      ON library_parse_cache(last_used_at);

    CREATE TABLE IF NOT EXISTS library_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      duration_ms REAL NOT NULL DEFAULT 0,
      result_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS library_metrics_kind_created
      ON library_metrics(kind, created_at);

    CREATE TABLE IF NOT EXISTS library_evaluation_cases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      expected_resource_id TEXT,
      expected_heading TEXT,
      collection_id TEXT,
      source_id TEXT,
      scope_kind TEXT NOT NULL DEFAULT 'personal',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS library_evaluation_cases_updated
      ON library_evaluation_cases(updated_at DESC);

    CREATE TABLE IF NOT EXISTS library_evaluation_runs (
      id TEXT PRIMARY KEY,
      summary_json TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS library_evaluation_runs_created
      ON library_evaluation_runs(created_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS library_chunks_fts USING fts5(
      title_terms,
      path_terms,
      heading_terms,
      body_terms,
      resource_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  const ensureColumn = (table, column, definition) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some((entry) => entry.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };
  ensureColumn('library_collections', 'scope_kind', "TEXT NOT NULL DEFAULT 'personal'");
  ensureColumn('library_collections', 'scope_id', 'TEXT');
  ensureColumn('library_collections', 'config_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('library_sources', 'scope_kind', "TEXT NOT NULL DEFAULT 'personal'");
  ensureColumn('library_sources', 'scope_id', 'TEXT');
  ensureColumn('library_sources', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('library_jobs', 'error_code', 'TEXT');
  ensureColumn('library_jobs', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('library_chunks', 'block_index', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('library_chunks', 'start_line', 'INTEGER');
  ensureColumn('library_chunks', 'end_line', 'INTEGER');
  ensureColumn('library_chunks', 'location_kind', 'TEXT');
  const ftsColumns = db.prepare('PRAGMA table_info(library_chunks_fts)').all()
    .map((entry) => entry.name);
  if (SEARCH_FTS_COLUMNS.some((column, index) => ftsColumns[index] !== column)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        DROP TABLE IF EXISTS library_chunks_fts;
        CREATE VIRTUAL TABLE library_chunks_fts USING fts5(
          title_terms,
          path_terms,
          heading_terms,
          body_terms,
          resource_id UNINDEXED,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `);
      const rows = db.prepare(`
        SELECT c.id, c.resource_id, c.heading, c.content, r.title, r.relative_path
        FROM library_chunks c
        JOIN library_resources r ON r.id = c.resource_id
        ORDER BY c.id
      `).all();
      const insert = db.prepare(`
        INSERT INTO library_chunks_fts(
          rowid, title_terms, path_terms, heading_terms, body_terms, resource_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const row of rows) {
        insert.run(
          row.id,
          tokenizeLibraryText(row.title),
          tokenizeLibraryText(row.relative_path),
          tokenizeLibraryText(row.heading),
          tokenizeLibraryText(row.content),
          row.resource_id,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  db.prepare(`
    INSERT INTO library_meta(key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(LIBRARY_SCHEMA_VERSION));
}

function collectionFromRow(row) {
  return row ? {
    id: row.id,
    uri: createLibraryScopeUri('collection', row.id, row.name),
    name: row.name,
    description: row.description || '',
    config: parseJson(row.config_json, {}),
    scope: row.scope_kind === 'project'
      ? { kind: 'project', projectId: row.scope_id }
      : { kind: 'personal' },
    sourceCount: Number(row.source_count) || 0,
    resourceCount: Number(row.resource_count) || 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  } : null;
}

function sourceFromRow(row) {
  return row ? {
    id: row.id,
    uri: createLibraryScopeUri('source', row.id, row.name),
    providerKind: row.provider_kind,
    capabilities: providerCapabilities(row.provider_kind),
    scope: row.scope_kind === 'project'
      ? { kind: 'project', projectId: row.scope_id }
      : { kind: 'personal' },
    name: row.name,
    location: row.provider_kind === 'local-path'
      ? path.basename(row.locator)
      : row.provider_kind === 'project-assets' ? '项目资产' : '资料库托管目录',
    config: parseJson(row.config_json, {}),
    enabled: Boolean(row.enabled),
    status: row.status,
    error: row.error || '',
    revision: row.revision || null,
    indexedRevision: row.indexed_revision || null,
    resourceCount: Number(row.resource_count) || 0,
    readyCount: Number(row.ready_count) || 0,
    errorCount: Number(row.error_count) || 0,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    indexedAt: row.indexed_at ? Number(row.indexed_at) : null,
  } : null;
}

function resourceFromRow(row) {
  const metadata = row ? parseJson(row.metadata_json, {}) : {};
  return row ? {
    id: row.id,
    sourceId: row.source_id,
    provider: row.provider_kind || '',
    capabilities: providerCapabilities(row.provider_kind),
    uri: row.uri,
    title: row.title,
    name: row.title,
    parentId: null,
    kind: 'file',
    displayPath: row.relative_path || path.basename(row.locator),
    relativePath: row.relative_path || path.basename(row.locator),
    extension: row.extension,
    mimeType: row.mime_type,
    size: Number(row.size) || 0,
    status: row.status,
    error: row.error || '',
    indexStatus: row.status === 'failed' ? 'error' : row.status === 'discovered' ? 'unindexed' : row.status,
    indexError: row.error || null,
    revision: row.revision || null,
    indexedRevision: row.indexed_revision || null,
    contentHash: row.content_hash || null,
    sourceSessionId: metadata.sourceSessionId || null,
    provenance: Array.isArray(metadata.provenance) ? metadata.provenance : [],
    metadata,
    sourceName: row.source_name || '',
    providerKind: row.provider_kind || '',
    scope: row.scope_kind === 'project'
      ? { kind: 'project', projectId: row.scope_id }
      : { kind: 'personal' },
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    indexedAt: row.indexed_at ? Number(row.indexed_at) : null,
  } : null;
}

function jobFromRow(row) {
  return row ? {
    id: row.id,
    sourceId: row.source_id || null,
    kind: row.kind,
    status: row.status,
    progress: parseJson(row.progress_json, {}),
    error: row.error || '',
    errorCode: row.error_code || null,
    attemptCount: Number(row.attempt_count) || 0,
    createdAt: Number(row.created_at),
    startedAt: row.started_at ? Number(row.started_at) : null,
    completedAt: row.completed_at ? Number(row.completed_at) : null,
  } : null;
}

function sourceSelect() {
  return `
    SELECT s.*,
      SUM(CASE WHEN r.status <> 'missing' THEN 1 ELSE 0 END) AS resource_count,
      SUM(CASE WHEN r.status IN ('ready', 'stale') THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE
        WHEN r.status = 'failed' OR (r.status = 'stale' AND r.error <> '') THEN 1
        ELSE 0 END) AS error_count
    FROM library_sources s
    LEFT JOIN library_resources r ON r.source_id = s.id
  `;
}

export function createLibraryService(options) {
  const requestedLibraryRoot = path.resolve(options.libraryRoot);
  fs.mkdirSync(requestedLibraryRoot, { recursive: true });
  const libraryRoot = fs.realpathSync(requestedLibraryRoot);
  const dbPath = path.resolve(options.dbPath || path.join(libraryRoot, 'library.db'));
  const legacyDbPath = path.resolve(options.legacyDbPath || path.join(path.dirname(libraryRoot), 'local-kb', 'local-kb.db'));
  const parserPath = path.resolve(options.parserPath);
  const getPythonModulePaths = options.getPythonModulePaths || (() => []);
  const customParseDocument = typeof options.parseDocument === 'function';
  const parseDocument = options.parseDocument || ((filePath, context = {}) => {
    if (options.requireManagedRuntime === true && !text(options.pythonPath)) {
      const error = new Error('The managed Library parser runtime is unavailable.');
      error.code = 'RUNTIME_UNAVAILABLE';
      throw error;
    }
    return parseLibraryDocumentWithPython({
      filePath,
      parserPath,
      pythonPath: options.pythonPath,
      pythonModulePaths: getPythonModulePaths() || [],
      signal: context.signal,
    });
  });
  const getProjectAssets = options.getProjectAssets || (async () => []);
  const getProject = options.getProject || (() => null);
  const getSessionRecord = options.getSessionRecord || (() => null);
  const commitProjectAsset = options.commitProjectAsset || null;
  const getSessionResourceManifestPath = options.getSessionResourceManifestPath || null;
  const getEngineStatus = options.getEngineStatus || (() => ({ installed: true, resourceAvailable: true }));
  const featureFlags = {
    core: options.featureFlags?.core !== false,
    projectAssets: options.featureFlags?.projectAssets !== false,
    composerResources: options.featureFlags?.composerResources !== false,
    migration: options.featureFlags?.migration !== false,
  };
  const watchSources = options.watchSources === true;
  const watchDebounceMs = Math.max(50, Number(options.watchDebounceMs) || DEFAULT_WATCH_DEBOUNCE_MS);
  const watchFallbackMs = Math.max(1_000, Number(options.watchFallbackMs) || DEFAULT_WATCH_FALLBACK_MS);
  const onChanged = typeof options.onChanged === 'function' ? options.onChanged : () => {};
  const log = typeof options.log === 'function' ? options.log : () => {};
  const parseCacheEnabled = options.parseCache !== false
    && (!customParseDocument || Boolean(text(options.parserCacheVersion)));

  const db = new DatabaseSync(dbPath);
  try {
    fs.chmodSync(libraryRoot, 0o700);
    fs.chmodSync(dbPath, 0o600);
  } catch {}
  initializeSchema(db);
  const recoveredAt = now();
  const recoverableJobs = db.prepare(`
    SELECT j.id, j.source_id, j.kind, j.progress_json, j.attempt_count,
      EXISTS (
        SELECT 1 FROM library_jobs previous
        WHERE previous.source_id = j.source_id AND previous.id != j.id
          AND previous.status IN ('completed', 'failed', 'cancelled')
      ) AS has_terminal_history
    FROM library_jobs j
    WHERE j.status IN ('queued', 'running') AND j.source_id IS NOT NULL
    ORDER BY j.created_at
  `).all();
  if (featureFlags.core) {
    for (const job of recoverableJobs) {
      if (job.kind !== 'refresh' || !Number(job.has_terminal_history)) continue;
      db.prepare(`
        UPDATE library_jobs SET status = 'cancelled', cancel_requested = 1,
          error = '已完成来源不会在应用重启后自动再次索引。',
          error_code = 'RESTART_REFRESH_CANCELLED', completed_at = ?
        WHERE id = ?
      `).run(recoveredAt, job.id);
    }
    db.prepare(`
      UPDATE library_jobs SET status = 'failed',
        error = 'Retry limit reached after repeated application restarts.',
        error_code = 'RETRY_LIMIT', completed_at = ?
      WHERE status IN ('queued', 'running') AND attempt_count >= ?
    `).run(recoveredAt, MAX_JOB_ATTEMPTS);
    db.prepare(`
      UPDATE library_jobs SET status = 'queued',
        error = 'Resuming after application restart.', error_code = 'APP_RESTART',
        attempt_count = attempt_count + 1, cancel_requested = 0,
        started_at = NULL, completed_at = NULL
      WHERE status IN ('queued', 'running') AND attempt_count < ?
    `).run(MAX_JOB_ATTEMPTS);
    db.prepare(`
      UPDATE library_sources SET status = CASE WHEN indexed_revision IS NULL THEN 'idle' ELSE 'stale' END,
        error = 'Indexing will resume after application restart.', updated_at = ?
      WHERE status = 'indexing'
    `).run(recoveredAt);
    for (const job of recoverableJobs) {
      if (job.kind !== 'refresh' || !Number(job.has_terminal_history)) continue;
      db.prepare(`
        UPDATE library_sources SET status = CASE
          WHEN indexed_revision IS NULL THEN 'idle'
          WHEN indexed_revision = revision THEN 'ready'
          ELSE 'stale' END,
          error = '', updated_at = ?
        WHERE id = ?
      `).run(recoveredAt, job.source_id);
    }
  } else {
    db.prepare(`
      UPDATE library_jobs SET status = 'failed', error = 'Library indexing is disabled.',
        error_code = 'FEATURE_DISABLED', completed_at = ?
      WHERE status IN ('queued', 'running')
    `).run(recoveredAt);
    db.prepare(`
      UPDATE library_sources SET status = CASE WHEN indexed_revision IS NULL THEN 'idle' ELSE 'stale' END,
        error = 'Library indexing is disabled.', updated_at = ?
      WHERE status = 'indexing'
    `).run(recoveredAt);
  }
  if (featureFlags.core) {
    const settledSources = db.prepare(`
      SELECT id FROM library_sources s
      WHERE NOT EXISTS (
        SELECT 1 FROM library_jobs j
        WHERE j.source_id = s.id AND j.status IN ('queued', 'running')
      )
    `).all();
    for (const source of settledSources) restoreSourceStatus(source.id);
  }
  let queue = Promise.resolve();
  let closed = false;
  const sourceWatchers = new Map();
  const fallbackSourceIds = new Set();
  const watcherTimers = new Map();
  const pendingRefreshes = new Set();
  const jobControllers = new Map();
  let fallbackTimer = null;

  function emit(reason, payload = {}) {
    try {
      onChanged({ reason, ...payload });
    } catch {}
  }

  function transaction(callback) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function parserSignature() {
    const statSignature = (target) => {
      try {
        const stat = fs.statSync(target);
        return `${path.resolve(target)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
      } catch {
        return `${path.resolve(target)}:missing`;
      }
    };
    const modulePaths = getPythonModulePaths();
    const parts = customParseDocument
      ? [`custom:${text(options.parserCacheVersion)}`]
      : [
          statSignature(parserPath),
          ...(Array.isArray(modulePaths) ? modulePaths : []).map(statSignature).sort(),
        ];
    return createHash('sha256').update(parts.join('\n')).digest('hex');
  }

  function recordMetric(kind, durationMs = 0, resultCount = 0, metadata = {}) {
    db.prepare(`
      INSERT INTO library_metrics(kind, duration_ms, result_count, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(kind, Number(durationMs) || 0, Number(resultCount) || 0, json(metadata), now());
    db.prepare(`
      DELETE FROM library_metrics WHERE id IN (
        SELECT id FROM library_metrics ORDER BY id DESC LIMIT -1 OFFSET ?
      )
    `).run(MAX_LIBRARY_METRICS);
  }

  function pruneParseCache() {
    db.prepare(`
      DELETE FROM library_parse_cache WHERE cache_key IN (
        SELECT cache_key FROM library_parse_cache
        ORDER BY last_used_at DESC LIMIT -1 OFFSET ?
      )
    `).run(MAX_PARSE_CACHE_ENTRIES);
    let totalBytes = Number(db.prepare(
      'SELECT COALESCE(SUM(byte_count), 0) AS total FROM library_parse_cache',
    ).get()?.total) || 0;
    while (totalBytes > MAX_PARSE_CACHE_BYTES) {
      const oldest = db.prepare(`
        SELECT cache_key, byte_count FROM library_parse_cache
        ORDER BY last_used_at, cache_key LIMIT 25
      `).all();
      if (oldest.length === 0) break;
      const remove = db.prepare('DELETE FROM library_parse_cache WHERE cache_key = ?');
      for (const entry of oldest) {
        remove.run(entry.cache_key);
        totalBytes -= Number(entry.byte_count) || 0;
        if (totalBytes <= MAX_PARSE_CACHE_BYTES) break;
      }
    }
  }

  function pruneUnreferencedParseCache() {
    db.prepare(`
      DELETE FROM library_parse_cache
      WHERE NOT EXISTS (
        SELECT 1 FROM library_resources r
        WHERE r.content_hash = library_parse_cache.content_hash
          AND r.status <> 'missing'
      )
    `).run();
  }

  async function parseResourceDocument(resource, context = {}) {
    const signature = parserSignature();
    const cacheKey = createHash('sha256')
      .update(`${resource.content_hash}\n${signature}`)
      .digest('hex');
    if (parseCacheEnabled && context.bypassCache !== true) {
      const cached = db.prepare(
        'SELECT payload_json FROM library_parse_cache WHERE cache_key = ?',
      ).get(cacheKey);
      const payload = parseJson(cached?.payload_json, null);
      if (payload && Array.isArray(payload.blocks)) {
        db.prepare(`
          UPDATE library_parse_cache SET hit_count = hit_count + 1, last_used_at = ?
          WHERE cache_key = ?
        `).run(now(), cacheKey);
        recordMetric('parse-cache-hit', 0, 1, { parser: text(payload.parser) || 'unknown' });
        return {
          ...payload,
          title: payload.titleFromContent === true
            ? payload.title
            : path.basename(resource.locator, path.extname(resource.locator)),
        };
      }
    }
    const startedAt = performance.now();
    try {
      const parsed = await parseDocument(resource.locator, context);
      const durationMs = performance.now() - startedAt;
      recordMetric('parse', durationMs, Array.isArray(parsed?.blocks) ? parsed.blocks.length : 0, {
        parser: text(parsed?.parser) || 'unknown',
        cacheable: parseCacheEnabled,
      });
      if (parseCacheEnabled) {
        const payloadJson = json(parsed);
        const byteCount = Buffer.byteLength(payloadJson);
        if (byteCount <= MAX_PARSE_CACHE_ENTRY_BYTES) {
          db.prepare(`
            INSERT INTO library_parse_cache(
              cache_key, content_hash, parser_signature, payload_json, byte_count,
              hit_count, created_at, last_used_at
            ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
              payload_json = excluded.payload_json,
              byte_count = excluded.byte_count,
              last_used_at = excluded.last_used_at
          `).run(
            cacheKey, resource.content_hash, signature, payloadJson, byteCount, now(), now(),
          );
          pruneParseCache();
        }
      }
      return parsed;
    } catch (error) {
      recordMetric('parse-error', performance.now() - startedAt, 0, {
        code: text(error?.code) || 'PARSER_FAILED',
      });
      throw error;
    }
  }

  function getMetrics() {
    ensureOpen();
    const metricRows = db.prepare(`
      SELECT kind, duration_ms, result_count, metadata_json, created_at
      FROM library_metrics ORDER BY id DESC LIMIT ?
    `).all(MAX_LIBRARY_METRICS);
    const metricGroups = new Map();
    for (const row of metricRows) {
      const group = metricGroups.get(row.kind) || [];
      group.push(row);
      metricGroups.set(row.kind, group);
    }
    const percentile = (values, ratio) => {
      if (values.length === 0) return 0;
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    };
    const operations = [...metricGroups.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, rows]) => {
        const durations = rows.map((entry) => Number(entry.duration_ms) || 0);
        return {
          kind,
          count: rows.length,
          averageDurationMs: durations.reduce((sum, value) => sum + value, 0) / rows.length,
          maximumDurationMs: Math.max(...durations),
          p50DurationMs: percentile(durations, 0.5),
          p95DurationMs: percentile(durations, 0.95),
          resultCount: rows.reduce((sum, entry) => sum + (Number(entry.result_count) || 0), 0),
          noResultCount: kind === 'search'
            ? rows.filter((entry) => Number(entry.result_count) === 0).length
            : 0,
        };
      });
    const cache = db.prepare(`
      SELECT COUNT(*) AS entries, COALESCE(SUM(byte_count), 0) AS bytes,
        COALESCE(SUM(hit_count), 0) AS hits FROM library_parse_cache
    `).get();
    return {
      operations,
      parseCache: {
        entries: Number(cache?.entries) || 0,
        bytes: Number(cache?.bytes) || 0,
        hits: Number(cache?.hits) || 0,
        maxEntries: MAX_PARSE_CACHE_ENTRIES,
        maxBytes: MAX_PARSE_CACHE_BYTES,
      },
    };
  }

  function ensureOpen() {
    if (closed) throw new Error('Library service is closed.');
  }

  function stopSourceWatcher(sourceId) {
    const timer = watcherTimers.get(sourceId);
    if (timer) clearTimeout(timer);
    watcherTimers.delete(sourceId);
    const watcher = sourceWatchers.get(sourceId);
    try {
      watcher?.close();
    } catch {}
    sourceWatchers.delete(sourceId);
    fallbackSourceIds.delete(sourceId);
    pendingRefreshes.delete(sourceId);
  }

  function queueWatchedRefresh(sourceId) {
    if (closed) return;
    const existing = watcherTimers.get(sourceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      watcherTimers.delete(sourceId);
      if (closed) return;
      try {
        refreshSource({ sourceId, coalesced: true, retryFailed: false });
      } catch (error) {
        log('warn', 'library', 'Unable to queue watched Library refresh', {
          sourceId,
          error: error.message || String(error),
        });
      }
    }, watchDebounceMs);
    timer.unref?.();
    watcherTimers.set(sourceId, timer);
  }

  function installSourceWatcher(source) {
    if (!watchSources || source?.provider_kind !== 'local-path' || !source.enabled) return;
    stopSourceWatcher(source.id);
    try {
      const stat = fs.statSync(source.locator);
      const recursive = stat.isDirectory() && (process.platform === 'darwin' || process.platform === 'win32');
      const watcher = fs.watch(source.locator, { recursive }, () => queueWatchedRefresh(source.id));
      if (stat.isDirectory() && !recursive) fallbackSourceIds.add(source.id);
      watcher.on('error', (error) => {
        log('warn', 'library', 'Library source watcher failed; periodic refresh remains active', {
          sourceId: source.id,
          error: error.message || String(error),
        });
        stopSourceWatcher(source.id);
        fallbackSourceIds.add(source.id);
      });
      sourceWatchers.set(source.id, watcher);
    } catch (error) {
      fallbackSourceIds.add(source.id);
      log('warn', 'library', 'Unable to watch Library source; periodic refresh remains active', {
        sourceId: source.id,
        error: error.message || String(error),
      });
    }
  }

  function ensureDefaultCollection() {
    const current = db.prepare('SELECT value FROM library_meta WHERE key = ?').get('default_collection_id');
    if (current?.value && db.prepare('SELECT id FROM library_collections WHERE id = ?').get(current.value)) {
      return current.value;
    }
    const existing = db.prepare('SELECT id FROM library_collections ORDER BY created_at LIMIT 1').get();
    const collectionId = existing?.id || randomUUID();
    if (!existing) {
      const timestamp = now();
      db.prepare(`
        INSERT INTO library_collections(id, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(collectionId, '个人资料', '', timestamp, timestamp);
    }
    db.prepare(`
      INSERT INTO library_meta(key, value) VALUES ('default_collection_id', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(collectionId);
    return collectionId;
  }

  ensureDefaultCollection();

  function listCollections(input = {}) {
    ensureOpen();
    const clauses = [];
    const params = [];
    appendAccessScope(clauses, params, 'c', input);
    return db.prepare(`
      SELECT c.*,
        COUNT(DISTINCT cs.source_id) AS source_count,
        COUNT(DISTINCT r.id) AS resource_count
      FROM library_collections c
      LEFT JOIN library_collection_sources cs ON cs.collection_id = c.id
      LEFT JOIN library_resources r ON r.source_id = cs.source_id AND r.status <> 'missing'
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      GROUP BY c.id
      ORDER BY c.updated_at DESC, c.name COLLATE NOCASE
    `).all(...params).map(collectionFromRow);
  }

  function createCollection(input = {}) {
    ensureOpen();
    const timestamp = now();
    const scope = normalizeLibraryScope(input.scope);
    const normalizedName = normalizeCollectionName(input.name);
    const duplicate = db.prepare(`
      SELECT id FROM library_collections
      WHERE scope_kind = ? AND IFNULL(scope_id, '') = ? AND name = ? COLLATE NOCASE
      LIMIT 1
    `).get(scope.kind, scope.kind === 'project' ? scope.projectId : '', normalizedName);
    if (duplicate) throw new Error('当前范围内已存在同名资料集。');
    const record = {
      id: randomUUID(),
      name: normalizedName,
      description: text(input.description).slice(0, 500),
      config: input.config && typeof input.config === 'object' ? input.config : {},
      scope,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.prepare(`
        INSERT INTO library_collections(
          id, scope_kind, scope_id, name, description, config_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        scope.kind,
        scope.kind === 'project' ? scope.projectId : null,
        record.name,
        record.description,
        json(record.config),
        timestamp,
        timestamp,
      );
    emit('collection-created', { collectionId: record.id });
    return { ...record, sourceCount: 0, resourceCount: 0 };
  }

  function updateCollection(input = {}) {
    ensureOpen();
    const id = text(input.id);
    const existing = db.prepare('SELECT * FROM library_collections WHERE id = ?').get(id);
    if (!existing) throw new Error('资料集不存在。');
    const name = input.name === undefined ? existing.name : normalizeCollectionName(input.name);
    const description = input.description === undefined
      ? existing.description
      : text(input.description).slice(0, 500);
    const config = input.config === undefined
      ? parseJson(existing.config_json, {})
      : input.config && typeof input.config === 'object' ? input.config : {};
    const duplicate = db.prepare(`
      SELECT id FROM library_collections
      WHERE id <> ? AND scope_kind = ? AND IFNULL(scope_id, '') = IFNULL(?, '')
        AND name = ? COLLATE NOCASE LIMIT 1
    `).get(id, existing.scope_kind, existing.scope_id, name);
    if (duplicate) throw new Error('当前范围内已存在同名资料集。');
    db.prepare(`
      UPDATE library_collections SET name = ?, description = ?, config_json = ?, updated_at = ? WHERE id = ?
    `).run(name, description, json(config), now(), id);
    emit('collection-updated', { collectionId: id });
    return collectionFromRow(db.prepare('SELECT * FROM library_collections WHERE id = ?').get(id));
  }

  function deleteChunksForSource(sourceId) {
    const ids = db.prepare(`
      SELECT c.id FROM library_chunks c
      JOIN library_resources r ON r.id = c.resource_id
      WHERE r.source_id = ?
    `).all(sourceId).map((row) => row.id);
    const removeFts = db.prepare('DELETE FROM library_chunks_fts WHERE rowid = ?');
    for (const id of ids) removeFts.run(id);
  }

  function removeManagedSourceFiles(source) {
    if (!['task-artifacts', 'managed-files'].includes(source?.provider_kind)) return;
    const artifactsRoot = source.provider_kind === 'managed-files'
      ? path.join(libraryRoot, 'managed', 'personal')
      : path.join(libraryRoot, 'artifacts');
    if (!isPathInside(artifactsRoot, source.locator, { allowRoot: false })) return;
    fs.rmSync(source.locator, { recursive: true, force: true });
  }

  function deleteJobsForSource(sourceId) {
    const jobs = db.prepare('SELECT id FROM library_jobs WHERE source_id = ?').all(sourceId);
    for (const job of jobs) jobControllers.get(job.id)?.abort();
    db.prepare('DELETE FROM library_jobs WHERE source_id = ?').run(sourceId);
  }

  function deleteCollection(input = {}) {
    ensureOpen();
    const id = text(input.id);
    const existing = db.prepare('SELECT id FROM library_collections WHERE id = ?').get(id);
    if (!existing) return { ok: true };
    const sourcesToCheck = db.prepare(`
      SELECT s.* FROM library_sources s
      JOIN library_collection_sources cs ON cs.source_id = s.id
      WHERE cs.collection_id = ?
    `).all(id);
    const removedSources = [];
    transaction(() => {
      db.prepare('DELETE FROM library_collections WHERE id = ?').run(id);
      for (const source of sourcesToCheck) {
        const attached = db.prepare(`
          SELECT 1 FROM library_collection_sources WHERE source_id = ? LIMIT 1
        `).get(source.id);
        if (!attached) {
          deleteJobsForSource(source.id);
          deleteChunksForSource(source.id);
          db.prepare('DELETE FROM library_sources WHERE id = ?').run(source.id);
          removedSources.push(source);
        }
      }
    });
    for (const source of removedSources) {
      stopSourceWatcher(source.id);
      removeManagedSourceFiles(source);
    }
    pruneUnreferencedParseCache();
    ensureDefaultCollection();
    emit('collection-deleted', { collectionId: id });
    return { ok: true };
  }

  function attachSource(collectionId, sourceId) {
    const collection = db.prepare('SELECT id FROM library_collections WHERE id = ?').get(collectionId);
    if (!collection) throw new Error('资料集不存在。');
    db.prepare(`
      INSERT OR IGNORE INTO library_collection_sources(collection_id, source_id, created_at)
      VALUES (?, ?, ?)
    `).run(collectionId, sourceId, now());
    db.prepare('UPDATE library_collections SET updated_at = ? WHERE id = ?').run(now(), collectionId);
  }

  function getSourceRow(sourceId) {
    const row = db.prepare('SELECT * FROM library_sources WHERE id = ?').get(text(sourceId));
    if (!row) throw new Error('Library source not found.');
    return row;
  }

  function listSources(input = {}) {
    ensureOpen();
    const collectionId = text(input.collectionId);
    const clauses = [];
    const params = [];
    if (collectionId) {
      clauses.push(`EXISTS (
        SELECT 1 FROM library_collection_sources cs
        WHERE cs.source_id = s.id AND cs.collection_id = ?
      )`);
      params.push(collectionId);
    }
    appendAccessScope(clauses, params, 's', input);
    if (input.scopeKind === 'personal') {
      clauses.push("s.scope_kind = 'personal' AND s.provider_kind <> 'task-artifacts'");
    } else if (input.scopeKind === 'projects') {
      clauses.push("s.scope_kind = 'project'");
    } else if (input.scopeKind === 'task-artifacts') {
      clauses.push("s.provider_kind = 'task-artifacts'");
    }
    return db.prepare(`
      ${sourceSelect()}
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
      GROUP BY s.id
      ORDER BY s.updated_at DESC, s.name COLLATE NOCASE
    `).all(...params).map(sourceFromRow);
  }

  async function upsertSource({ collectionId, providerKind, locator, name, config = {}, scope: rawScope }) {
    ensureOpen();
    const targetCollectionId = text(collectionId) || ensureDefaultCollection();
    const existing = db.prepare(`
      SELECT * FROM library_sources WHERE provider_kind = ? AND locator = ?
    `).get(providerKind, locator);
    const sourceId = existing?.id || randomUUID();
    const scope = normalizeLibraryScope(rawScope);
    const timestamp = now();
    if (existing) {
      db.prepare(`
        UPDATE library_sources SET
          scope_kind = ?, scope_id = ?, name = ?, config_json = ?, enabled = 1, updated_at = ?
        WHERE id = ?
      `).run(
        scope.kind,
        scope.kind === 'project' ? scope.projectId : null,
        name,
        json({ ...parseJson(existing.config_json, {}), ...config }),
        timestamp,
        sourceId,
      );
    } else {
      db.prepare(`
        INSERT INTO library_sources(
          id, provider_kind, scope_kind, scope_id, locator, name, config_json,
          enabled, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'idle', ?, ?)
      `).run(
        sourceId,
        providerKind,
        scope.kind,
        scope.kind === 'project' ? scope.projectId : null,
        locator,
        name,
        json(config),
        timestamp,
        timestamp,
      );
    }
    attachSource(targetCollectionId, sourceId);
    emit('source-added', { sourceId, collectionId: targetCollectionId });
    return sourceFromRow(db.prepare(`${sourceSelect()} WHERE s.id = ? GROUP BY s.id`).get(sourceId));
  }

  async function addLocalSource(input = {}) {
    const rawPath = text(input.path);
    if (!rawPath) throw new Error('A file or directory is required.');
    const locator = await fsp.realpath(path.resolve(rawPath));
    const stat = await fsp.stat(locator);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('Library source must be a file or directory.');
    const isDirectory = stat.isDirectory();
    const requestedExtensions = normalizeExtensions(input.extensions)
      .filter((extension) => SUPPORTED_EXTENSION_SET.has(extension));
    const source = await upsertSource({
      collectionId: input.collectionId,
      providerKind: 'local-path',
      locator,
      name: text(input.name) || path.basename(locator),
      scope: { kind: 'personal' },
      config: {
        scanConfigVersion: 1,
        recursive: isDirectory && input.recursive !== false,
        maxDepth: isDirectory && Number.isInteger(input.maxDepth) && input.maxDepth >= 0
          ? input.maxDepth
          : isDirectory ? DEFAULT_LIBRARY_DIRECTORY_SCAN.maxDepth : 0,
        include: Array.isArray(input.include) ? input.include.map(text).filter(Boolean) : [],
        exclude: Array.isArray(input.exclude) ? input.exclude.map(text).filter(Boolean) : [],
        extensions: requestedExtensions.length > 0
          ? requestedExtensions
          : [...SUPPORTED_LIBRARY_EXTENSIONS],
        maxFiles: isDirectory
          ? Math.min(DEFAULT_MAX_SOURCE_FILES, Math.max(1, Number(input.maxFiles) || DEFAULT_LIBRARY_DIRECTORY_SCAN.maxFiles))
          : 1,
        maxFileBytes: Math.max(1, Number(input.maxFileBytes) || DEFAULT_MAX_FILE_BYTES),
      },
    });
    installSourceWatcher(getSourceRow(source.id));
    if (input.refresh !== false) refreshSource({ sourceId: source.id, coalesced: true });
    return source;
  }

  async function addProjectSource(input = {}) {
    if (!featureFlags.projectAssets) throw new Error('Project Library sources are disabled.');
    const projectId = text(input.projectId);
    if (!projectId) throw new Error('Project id is required.');
    const project = await Promise.resolve(getProject(projectId));
    if (!project || project.archivedAt) throw new Error('Project not found.');
    let collectionId = text(input.collectionId);
    if (!collectionId) {
      const existingCollection = db.prepare(`
        SELECT id FROM library_collections
        WHERE scope_kind = 'project' AND scope_id = ? ORDER BY created_at LIMIT 1
      `).get(projectId);
      collectionId = existingCollection?.id || createCollection({
        name: `${project.name || '项目'}资料`,
        scope: { kind: 'project', projectId },
      }).id;
    }
    const source = await upsertSource({
      collectionId,
      providerKind: 'project-assets',
      locator: projectId,
      name: text(input.name) || `${project.name || '项目'}资产`,
      scope: { kind: 'project', projectId },
      config: { projectId },
    });
    if (input.refresh !== false) refreshSource({ sourceId: source.id, coalesced: true });
    return source;
  }

  async function saveTaskArtifact(input = {}) {
    const sessionId = text(input.sessionId);
    const sourcePath = path.resolve(text(input.path));
    const session = getSessionRecord(sessionId);
    if (!session?.workspace) throw new Error('Session not found.');
    const realWorkspace = await fsp.realpath(path.resolve(session.workspace));
    const realSource = await fsp.realpath(sourcePath);
    if (!isPathInside(realWorkspace, realSource)) {
      throw new Error('Task artifacts must come from the session workspace.');
    }
    const stat = await fsp.stat(realSource);
    if (!stat.isFile()) throw new Error('Task artifact must be a file.');
    if (input.target === 'project') {
      if (!session.projectId) throw new Error('A project session is required for a project Library artifact.');
      if (typeof commitProjectAsset !== 'function') throw new Error('Project asset storage is unavailable.');
      const asset = await commitProjectAsset(session.projectId, {
        sourcePath: realSource,
        fileName: safeName(input.name || path.basename(realSource)),
        name: text(input.name) || path.basename(realSource),
        sourceType: 'session_output',
        sourceSessionId: sessionId,
      });
      const projectSource = await addProjectSource({
        projectId: session.projectId,
        collectionId: input.collectionId,
        refresh: false,
      });
      const job = refreshSource({ sourceId: projectSource.id, coalesced: true });
      emit('artifact-saved', { sourceId: projectSource.id, sessionId, projectId: session.projectId });
      return {
        sourceId: projectSource.id,
        job,
        name: asset?.name || path.basename(realSource),
        target: 'project',
      };
    }
    const sourceId = createHash('sha256').update(`task-artifact:${sessionId}`).digest('hex').slice(0, 32);
    const artifactRoot = path.join(libraryRoot, 'artifacts', sourceId);
    await fsp.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    const targetName = safeName(input.name || path.basename(realSource));
    let targetPath = path.join(artifactRoot, targetName);
    if (fs.existsSync(targetPath)) {
      const parsed = path.parse(targetName);
      targetPath = path.join(artifactRoot, `${parsed.name}-${randomUUID().slice(0, 8)}${parsed.ext}`);
    }
    await fsp.copyFile(realSource, targetPath);
    await fsp.chmod(targetPath, 0o600).catch(() => {});
    const timestamp = now();
    const existing = db.prepare('SELECT id FROM library_sources WHERE id = ?').get(sourceId);
    if (!existing) {
      db.prepare(`
        INSERT INTO library_sources(
          id, provider_kind, scope_kind, locator, name, config_json, status, created_at, updated_at
        ) VALUES (?, 'task-artifacts', 'personal', ?, ?, ?, 'idle', ?, ?)
      `).run(
        sourceId,
        artifactRoot,
        `任务产物 · ${session.title || sessionId}`,
        json({ sessionId }),
        timestamp,
        timestamp,
      );
    }
    attachSource(text(input.collectionId) || ensureDefaultCollection(), sourceId);
    const job = refreshSource({ sourceId });
    emit('artifact-saved', { sourceId, sessionId });
    return { sourceId, job, name: path.basename(targetPath), target: 'personal' };
  }

  async function writeFilesToCollection(input = {}) {
    ensureOpen();
    const sessionId = text(input.sessionId);
    const session = getSessionRecord(sessionId);
    if (!session?.workspace) throw new Error('当前会话不可用。');
    const collectionId = text(input.collectionId);
    const collection = db.prepare(`
      SELECT * FROM library_collections WHERE id = ? AND scope_kind = 'personal'
    `).get(collectionId);
    if (!collection) throw new Error('目标个人资料集不存在。');
    const requestedFiles = Array.isArray(input.files) ? input.files : [];
    if (requestedFiles.length === 0) throw new Error('请至少提供一个需要写入资料库的文件。');

    const realWorkspace = await fsp.realpath(path.resolve(session.workspace));
    const managedKey = createHash('sha256')
      .update(`managed-files:${sessionId}:${collectionId}`)
      .digest('hex')
      .slice(0, 32);
    const managedRoot = path.join(libraryRoot, 'managed', 'personal', managedKey);
    await fsp.mkdir(managedRoot, { recursive: true, mode: 0o700 });
    const existingSource = db.prepare(`
      SELECT * FROM library_sources WHERE provider_kind = 'managed-files' AND locator = ?
    `).get(managedRoot);
    const storedConfig = parseJson(existingSource?.config_json, {});
    const storedFiles = new Map((Array.isArray(storedConfig.files) ? storedConfig.files : [])
      .map((entry) => [text(entry?.originalRelativePath), entry])
      .filter(([relativePath]) => relativePath));
    const written = [];
    const failed = [];

    for (const requested of requestedFiles) {
      const requestedPath = text(typeof requested === 'string' ? requested : requested?.path);
      if (!requestedPath) {
        failed.push({ path: '', error: '文件路径为空。' });
        continue;
      }
      let tempPath = '';
      try {
        const unresolvedPath = path.resolve(realWorkspace, requestedPath);
        const linkStat = await fsp.lstat(unresolvedPath);
        if (linkStat.isSymbolicLink()) throw new Error('不允许通过符号链接写入资料库。');
        const realSource = await fsp.realpath(unresolvedPath);
        if (!isPathInside(realWorkspace, realSource, { allowRoot: false })) {
          throw new Error('文件不在当前会话目录中。');
        }
        if (isPathInside(libraryRoot, realSource)) {
          throw new Error('资料库内部文件不能再次写入资料库。');
        }
        const stat = await fsp.stat(realSource);
        if (!stat.isFile()) throw new Error('目标不是普通文件。');
        const extension = path.extname(realSource).toLowerCase();
        if (!SUPPORTED_EXTENSION_SET.has(extension)) {
          throw new Error(`暂不支持 ${extension || '无扩展名'} 文件。`);
        }
        if (stat.size > DEFAULT_MAX_FILE_BYTES) {
          throw new Error(`文件超过 ${Math.round(DEFAULT_MAX_FILE_BYTES / 1024 / 1024)} MB。`);
        }

        const originalRelativePath = path.relative(realWorkspace, realSource).replaceAll(path.sep, '/');
        const safeOriginalRelativePath = safeRelativePath(originalRelativePath);
        if (!safeOriginalRelativePath) throw new Error('文件相对路径无效。');
        const rawCategoryKey = text(requested?.categoryKey).toLowerCase();
        const categoryKey = MANAGED_LIBRARY_CATEGORY_LABELS.has(rawCategoryKey) ? rawCategoryKey : 'other';
        const categoryLabel = MANAGED_LIBRARY_CATEGORY_LABELS.get(categoryKey);
        const subcategory = safeName(requested?.subcategory || '', '').slice(0, 24);
        let managedRelativePath = [categoryLabel, subcategory, safeOriginalRelativePath]
          .filter(Boolean)
          .join('/');
        const pathConflict = [...storedFiles.entries()].find(([storedOriginalPath, entry]) => (
          storedOriginalPath !== originalRelativePath && entry?.managedRelativePath === managedRelativePath
        ));
        if (pathConflict) {
          const parsed = path.posix.parse(managedRelativePath);
          const suffix = createHash('sha256').update(originalRelativePath).digest('hex').slice(0, 8);
          managedRelativePath = path.posix.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
        }
        const targetPath = path.resolve(managedRoot, ...managedRelativePath.split('/'));
        if (!isPathInside(managedRoot, targetPath, { allowRoot: false })) {
          throw new Error('生成的资料库路径无效。');
        }
        await fsp.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
        const contentHash = await sha256File(realSource);
        let copied = true;
        if (fs.existsSync(targetPath)) {
          const existingHash = await sha256File(targetPath);
          copied = existingHash !== contentHash;
        }
        if (copied) {
          tempPath = `${targetPath}.moss-${randomUUID().slice(0, 8)}.tmp`;
          await fsp.copyFile(realSource, tempPath);
          await fsp.chmod(tempPath, 0o600).catch(() => {});
          await fsp.rm(targetPath, { force: true });
          await fsp.rename(tempPath, targetPath);
          tempPath = '';
        }
        const previous = storedFiles.get(originalRelativePath);
        if (previous?.managedRelativePath && previous.managedRelativePath !== managedRelativePath) {
          const previousPath = path.resolve(managedRoot, ...safeRelativePath(previous.managedRelativePath).split('/'));
          if (isPathInside(managedRoot, previousPath, { allowRoot: false })) {
            await fsp.rm(previousPath, { force: true }).catch(() => {});
          }
        }
        const record = {
          originalRelativePath,
          managedRelativePath,
          categoryKey,
          categoryLabel,
          subcategory: subcategory || null,
          reason: text(requested?.reason).replace(/\s+/g, ' ').slice(0, 180),
          contentHash,
          size: stat.size,
          copiedAt: now(),
        };
        storedFiles.set(originalRelativePath, record);
        written.push({
          path: originalRelativePath,
          name: path.basename(originalRelativePath),
          categoryKey,
          categoryLabel,
          subcategory: subcategory || null,
          copied,
        });
      } catch (error) {
        if (tempPath) await fsp.rm(tempPath, { force: true }).catch(() => {});
        failed.push({
          path: requestedPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (written.length === 0) {
      if (!existingSource) await fsp.rm(managedRoot, { recursive: true, force: true }).catch(() => {});
      return {
        ...(existingSource ? { sourceId: existingSource.id, sourceName: existingSource.name } : {}),
        collectionId,
        collectionName: collection.name,
        written,
        failed,
        job: null,
      };
    }
    const files = [...storedFiles.values()]
      .sort((left, right) => left.managedRelativePath.localeCompare(right.managedRelativePath, 'zh-CN'));
    const source = await upsertSource({
      collectionId,
      providerKind: 'managed-files',
      locator: managedRoot,
      name: text(input.sourceName).slice(0, 80) || `资料整理 · ${session.title || path.basename(realWorkspace)}`,
      scope: { kind: 'personal' },
      config: {
        version: 1,
        originSessionId: sessionId,
        files,
        extensions: [...new Set(files.map((entry) => path.extname(entry.managedRelativePath).toLowerCase()))],
        maxFiles: files.length,
        maxFileBytes: DEFAULT_MAX_FILE_BYTES,
      },
    });
    const job = refreshSource({ sourceId: source.id, coalesced: true });
    emit('managed-files-written', { sourceId: source.id, collectionId, sessionId, count: written.length });
    return {
      sourceId: source.id,
      sourceName: source.name,
      collectionId,
      collectionName: collection.name,
      written,
      failed,
      job,
    };
  }

  function removeSource(input = {}) {
    ensureOpen();
    const sourceId = text(input.sourceId);
    const collectionId = text(input.collectionId);
    const source = getSourceRow(sourceId);
    let removed = false;
    transaction(() => {
      if (collectionId) {
        db.prepare(`
          DELETE FROM library_collection_sources WHERE collection_id = ? AND source_id = ?
        `).run(collectionId, sourceId);
      } else {
        db.prepare('DELETE FROM library_collection_sources WHERE source_id = ?').run(sourceId);
      }
      const attached = db.prepare(`
        SELECT 1 FROM library_collection_sources WHERE source_id = ? LIMIT 1
      `).get(sourceId);
      if (!attached) {
        deleteJobsForSource(sourceId);
        deleteChunksForSource(sourceId);
        db.prepare('DELETE FROM library_sources WHERE id = ?').run(sourceId);
        removed = true;
      }
    });
    if (removed) {
      stopSourceWatcher(sourceId);
      removeManagedSourceFiles(source);
    }
    pruneUnreferencedParseCache();
    emit('source-removed', { sourceId, collectionId: collectionId || null });
    return { ok: true, deleted: removed, detached: !removed };
  }

  async function discoverSource(source, context = {}) {
    const storedConfig = parseJson(source.config_json, {});
    const configuredExtensions = normalizeExtensions(storedConfig.extensions)
      .filter((extension) => SUPPORTED_EXTENSION_SET.has(extension));
    const config = {
      ...storedConfig,
      maxDepth: Number.isInteger(storedConfig.maxDepth) && storedConfig.maxDepth >= 0
        ? storedConfig.maxDepth
        : DEFAULT_LIBRARY_DIRECTORY_SCAN.maxDepth,
      maxFiles: storedConfig.scanConfigVersion === 1
        ? storedConfig.maxFiles
        : DEFAULT_LIBRARY_DIRECTORY_SCAN.maxFiles,
      extensions: configuredExtensions.length > 0
        ? configuredExtensions
        : [...SUPPORTED_LIBRARY_EXTENSIONS],
      signal: context.signal,
    };
    const existingRows = db.prepare(`
      SELECT provider_resource_id, size, mtime_ms, content_hash
      FROM library_resources WHERE source_id = ?
    `).all(source.id);
    const existingByProviderId = new Map(existingRows.map((row) => [row.provider_resource_id, row]));
    let candidates = [];
    if (source.provider_kind === 'project-assets') {
      const project = await Promise.resolve(getProject(source.locator));
      const assets = project && !project.archivedAt
        ? await getProjectAssets(source.locator)
        : [];
      candidates = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.path).map((asset) => ({
        path: path.resolve(asset.path),
        relativePath: text(asset.relativePath) || path.basename(asset.path),
        providerResourceId: text(asset.id),
        title: text(asset.name) || path.basename(asset.path),
        metadata: {
          projectId: source.locator,
          assetId: asset.id,
          sourceType: asset.sourceType || null,
          sourceSessionId: asset.sourceSessionId || null,
          provenance: Array.isArray(asset.provenance)
            ? asset.provenance.map((entry) => ({
                sourceSessionId: entry?.sourceSessionId || null,
                sourcePath: null,
                recordedAt: Number(entry?.recordedAt) || 0,
              }))
            : [],
        },
        suppliedHash: text(asset.contentHash),
      }));
    } else if (source.provider_kind === 'managed-files') {
      const managedFiles = Array.isArray(config.files) ? config.files : [];
      candidates = managedFiles.flatMap((entry) => {
        const managedRelativePath = safeRelativePath(entry?.managedRelativePath);
        const originalRelativePath = text(entry?.originalRelativePath);
        if (!managedRelativePath || !originalRelativePath) return [];
        const filePath = path.resolve(source.locator, ...managedRelativePath.split('/'));
        if (!isPathInside(source.locator, filePath, { allowRoot: false }) || !fs.existsSync(filePath)) return [];
        return [{
          path: filePath,
          relativePath: managedRelativePath,
          providerResourceId: originalRelativePath,
          title: path.basename(originalRelativePath, path.extname(originalRelativePath)),
          suppliedHash: text(entry?.contentHash),
          metadata: {
            originalRelativePath,
            categoryKey: text(entry?.categoryKey) || 'other',
            categoryLabel: text(entry?.categoryLabel) || '其他资料',
            subcategory: text(entry?.subcategory) || null,
            classificationReason: text(entry?.reason) || null,
            originSessionId: text(config.originSessionId) || null,
          },
        }];
      });
    } else {
      const files = await listLocalFiles(source.locator, { ...config, excludedRoots: [libraryRoot] });
      candidates = files.map((file) => ({
        ...file,
        providerResourceId: file.relativePath.replaceAll(path.sep, '/'),
        title: path.basename(file.path, path.extname(file.path)),
        metadata: source.provider_kind === 'task-artifacts' ? config : {},
      }));
    }

    candidates.sort((left, right) => String(left.relativePath || left.path)
      .localeCompare(String(right.relativePath || right.path), 'en'));
    const discovered = [];
    const seenContentHashes = new Set();
    const discoveryExtensionSet = new Set(config.extensions);
    const discoveryMaxFiles = Math.max(
      1,
      Number(config.maxFiles) || DEFAULT_LIBRARY_DIRECTORY_SCAN.maxFiles,
    );
    for (const candidate of candidates) {
      throwIfIndexingCancelled(context.signal);
      if (discovered.length >= discoveryMaxFiles) break;
      const extension = path.extname(candidate.path).toLowerCase();
      const stat = candidate.stat || await fsp.stat(candidate.path);
      if (!stat.isFile()) continue;
      const maxFileBytes = Number(config.maxFileBytes) || DEFAULT_MAX_FILE_BYTES;
      if (!SUPPORTED_EXTENSION_SET.has(extension)
        || !discoveryExtensionSet.has(extension)
        || stat.size > maxFileBytes) {
        continue;
      }
      const indexable = candidate.indexable !== undefined
        ? candidate.indexable
        : SUPPORTED_EXTENSION_SET.has(extension) && stat.size <= maxFileBytes;
      const unsupportedReason = candidate.unsupportedReason || (indexable
        ? ''
        : stat.size > maxFileBytes
          ? `File exceeds the ${maxFileBytes}-byte indexing limit.`
          : `Unsupported Library file type: ${extension || '(none)'}`);
      const existing = existingByProviderId.get(candidate.providerResourceId);
      const unchangedStat = existing
        && Number(existing.size) === stat.size
        && Number(existing.mtime_ms) === Math.round(stat.mtimeMs)
        && text(existing.content_hash);
      const contentHash = candidate.suppliedHash || (unchangedStat
        ? existing.content_hash
        : await sha256File(candidate.path, context.signal));
      if (seenContentHashes.has(contentHash)) continue;
      seenContentHashes.add(contentHash);
      discovered.push({
        providerResourceId: candidate.providerResourceId,
        locator: path.resolve(candidate.path),
        relativePath: candidate.relativePath.replaceAll(path.sep, '/'),
        title: candidate.title,
        extension,
        mimeType: extensionMimeType(extension),
        size: stat.size,
        mtimeMs: Math.round(stat.mtimeMs),
        contentHash,
        revision: contentHash,
        indexable,
        unsupportedReason,
        metadata: candidate.metadata || {},
      });
    }
    return discovered;
  }

  function reconcileResources(source, discovered) {
    const timestamp = now();
    const existingRows = db.prepare('SELECT * FROM library_resources WHERE source_id = ?').all(source.id);
    const existingByProviderId = new Map(existingRows.map((row) => [row.provider_resource_id, row]));
    const discoveredProviderIds = new Set(discovered.map((item) => item.providerResourceId));
    const renameCandidates = existingRows.filter((row) => !discoveredProviderIds.has(row.provider_resource_id));
    const matchedExistingIds = new Set();
    const changed = [];

    transaction(() => {
      for (const item of discovered) {
        let existing = existingByProviderId.get(item.providerResourceId);
        if (!existing) {
          const matches = renameCandidates.filter((row) => (
            row.content_hash === item.contentHash && Number(row.size) === item.size
          ));
          if (matches.length === 1) {
            existing = matches[0];
            renameCandidates.splice(renameCandidates.indexOf(existing), 1);
          }
        }
        const resourceId = existing?.id || randomUUID();
        if (existing) matchedExistingIds.add(existing.id);
        const itemChanged = !existing || existing.revision !== item.revision;
        const preserveFailedState = existing && !itemChanged && ['failed', 'stale'].includes(existing.status);
        const status = !item.indexable
          ? 'unsupported'
          : existing?.indexed_revision === item.revision
            ? 'ready'
            : preserveFailedState
              ? existing.status
              : existing?.indexed_revision ? 'stale' : 'discovered';
        const resourceError = item.unsupportedReason
          || (preserveFailedState ? existing.error : '');
        const uri = createLibraryResourceUri(resourceId, item.revision, item.title);
        if (existing) {
          db.prepare(`
            UPDATE library_resources SET
              provider_resource_id = ?, uri = ?, title = ?, locator = ?, relative_path = ?,
              extension = ?, mime_type = ?, size = ?, mtime_ms = ?, content_hash = ?,
              status = ?, error = ?, revision = ?, metadata_json = ?, updated_at = ?
            WHERE id = ?
          `).run(
            item.providerResourceId, uri, item.title, item.locator, item.relativePath,
            item.extension, item.mimeType, item.size, item.mtimeMs, item.contentHash,
            status, resourceError, item.revision, json(item.metadata), timestamp, resourceId,
          );
        } else {
          db.prepare(`
            INSERT INTO library_resources(
              id, source_id, provider_resource_id, uri, title, locator, relative_path,
              extension, mime_type, size, mtime_ms, content_hash, status, revision,
              metadata_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            resourceId, source.id, item.providerResourceId, uri, item.title, item.locator,
            item.relativePath, item.extension, item.mimeType, item.size, item.mtimeMs,
              item.contentHash, status, item.revision, json(item.metadata), timestamp, timestamp,
          );
          if (item.unsupportedReason) {
            db.prepare('UPDATE library_resources SET error = ? WHERE id = ?')
              .run(item.unsupportedReason, resourceId);
          }
        }
        if (item.indexable && itemChanged) {
          changed.push(resourceId);
        }
      }
      for (const row of existingRows) {
        if (!matchedExistingIds.has(row.id)) {
          const chunkIds = db.prepare('SELECT id FROM library_chunks WHERE resource_id = ?')
            .all(row.id).map((chunk) => chunk.id);
          const deleteFts = db.prepare('DELETE FROM library_chunks_fts WHERE rowid = ?');
          for (const chunkId of chunkIds) deleteFts.run(chunkId);
          db.prepare('DELETE FROM library_chunks WHERE resource_id = ?').run(row.id);
          db.prepare(`
            UPDATE library_resources SET status = 'missing', error = ?,
              indexed_revision = NULL, indexed_at = NULL, updated_at = ? WHERE id = ?
          `).run('The source file is outside the current scan rules or no longer available.', timestamp, row.id);
        }
      }
    });
    pruneUnreferencedParseCache();
    return changed;
  }

  function updateJob(jobId, status, progress, error = '', errorCode = null) {
    const completed = ['completed', 'failed', 'cancelled'].includes(status) ? now() : null;
    const started = status === 'running' ? now() : null;
    db.prepare(`
      UPDATE library_jobs SET
        status = ?, progress_json = ?, error = ?, error_code = ?,
        started_at = COALESCE(started_at, ?), completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `).run(status, json(progress), error, errorCode, started, completed, jobId);
    emit('job-updated', { jobId, status, progress });
  }

  function restoreSourceStatus(sourceId) {
    const active = db.prepare(`
      SELECT 1 FROM library_jobs
      WHERE source_id = ? AND status IN ('queued', 'running')
      LIMIT 1
    `).get(sourceId);
    if (active) return;
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status <> 'missing' THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready,
        SUM(CASE
          WHEN status = 'failed' OR (status = 'stale' AND error <> '') THEN 1
          ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'stale' AND error = '' THEN 1 ELSE 0 END) AS stale,
        SUM(CASE WHEN status = 'discovered' THEN 1 ELSE 0 END) AS discovered
      FROM library_resources WHERE source_id = ?
    `).get(sourceId);
    const failed = Number(counts?.failed) || 0;
    const stale = Number(counts?.stale) || 0;
    const discovered = Number(counts?.discovered) || 0;
    const ready = Number(counts?.ready) || 0;
    const total = Number(counts?.total) || 0;
    const status = failed > 0 || stale > 0
      ? 'stale'
      : discovered > 0
        ? 'idle'
        : ready > 0 || total === 0 ? 'ready' : 'idle';
    db.prepare(`
      UPDATE library_sources SET status = ?, error = ?, updated_at = ? WHERE id = ?
    `).run(status, failed > 0 ? `${failed} 个资源索引失败。` : '', now(), sourceId);
    emit('source-updated', { sourceId });
  }

  function replaceResourceChunks(resource, parsed) {
    const chunks = chunkLibraryBlocks(parsed.blocks);
    if (chunks.length === 0) throw new Error('The document contains no indexable text.');
    transaction(() => {
      const oldIds = db.prepare('SELECT id FROM library_chunks WHERE resource_id = ?').all(resource.id);
      const deleteFts = db.prepare('DELETE FROM library_chunks_fts WHERE rowid = ?');
      for (const row of oldIds) deleteFts.run(row.id);
      db.prepare('DELETE FROM library_chunks WHERE resource_id = ?').run(resource.id);
      const insertChunk = db.prepare(`
        INSERT INTO library_chunks(
          resource_id, chunk_index, block_index, heading, page, start_line, end_line,
          location_kind, content, indexed_content, char_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = db.prepare(`
        INSERT INTO library_chunks_fts(
          rowid, title_terms, path_terms, heading_terms, body_terms, resource_id
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      chunks.forEach((chunk, index) => {
        const title = text(parsed.title) || resource.title;
        const indexedContent = tokenizeLibraryText(chunk.content);
        const result = insertChunk.run(
          resource.id, index, chunk.blockIndex, chunk.heading, chunk.page,
          chunk.startLine, chunk.endLine, chunk.locationKind, chunk.content,
          indexedContent, chunk.content.length,
        );
        insertFts.run(
          Number(result.lastInsertRowid),
          tokenizeLibraryText(title),
          tokenizeLibraryText(resource.relative_path),
          tokenizeLibraryText(chunk.heading),
          indexedContent,
          resource.id,
        );
      });
      db.prepare(`
        UPDATE library_resources SET
          title = ?, status = 'ready', error = '', indexed_revision = revision,
          indexed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(text(parsed.title) || resource.title, now(), now(), resource.id);
    });
  }

  async function runRefreshJob(jobId, sourceId, full = false, options = {}) {
    const controller = new AbortController();
    jobControllers.set(jobId, controller);
    const retryFailed = options.retryFailed !== false;
    const progress = { phase: 'discover', discovered: 0, indexed: 0, skipped: 0, failed: 0, retryFailed };
    if (db.prepare('SELECT cancel_requested FROM library_jobs WHERE id = ?').get(jobId)?.cancel_requested) {
      updateJob(jobId, 'cancelled', progress, 'Indexing was cancelled.', 'CANCELLED');
      restoreSourceStatus(sourceId);
      jobControllers.delete(jobId);
      return;
    }
    updateJob(jobId, 'running', progress);
    db.prepare(`UPDATE library_sources SET status = 'indexing', error = '', updated_at = ? WHERE id = ?`)
      .run(now(), sourceId);
    emit('source-updated', { sourceId });
    try {
      const source = getSourceRow(sourceId);
      const discovered = await discoverSource(source, { signal: controller.signal });
      progress.discovered = discovered.length;
      progress.phase = 'index';
      const reconciledIds = reconcileResources(source, discovered);
      const changedIds = full
        ? db.prepare(`
            SELECT id FROM library_resources
            WHERE source_id = ? AND status NOT IN ('missing', 'unsupported')
          `).all(sourceId).map((row) => row.id)
        : retryFailed
          ? [...new Set([
              ...reconciledIds,
              ...db.prepare(`
                SELECT id FROM library_resources
                WHERE source_id = ? AND status IN ('discovered', 'stale', 'failed')
              `).all(sourceId).map((row) => row.id),
            ])]
          : reconciledIds;
      const sourceRevision = createHash('sha256')
        .update(discovered.map((item) => `${item.providerResourceId}:${item.revision}`).sort().join('\n'))
        .digest('hex');
      db.prepare(`UPDATE library_sources SET revision = ?, updated_at = ? WHERE id = ?`)
        .run(sourceRevision, now(), sourceId);

      for (const resourceId of changedIds) {
        const cancelled = db.prepare('SELECT cancel_requested FROM library_jobs WHERE id = ?').get(jobId);
        if (cancelled?.cancel_requested || controller.signal.aborted) {
          updateJob(jobId, 'cancelled', progress);
          db.prepare(`UPDATE library_sources SET status = 'stale', updated_at = ? WHERE id = ?`)
            .run(now(), sourceId);
          return;
        }
        const resource = db.prepare('SELECT * FROM library_resources WHERE id = ?').get(resourceId);
        progress.currentResourceId = resource.id;
        progress.currentTitle = resource.title;
        updateJob(jobId, 'running', progress);
        try {
          const parsed = await parseResourceDocument(resource, {
            signal: controller.signal,
            jobId,
            bypassCache: full,
          });
          replaceResourceChunks(resource, parsed);
          progress.indexed += 1;
        } catch (error) {
          if (error?.code === 'PARSER_CANCELLED' || error?.code === 'INDEX_CANCELLED') {
            db.prepare(`
              UPDATE library_resources SET status = CASE
                WHEN indexed_revision IS NULL THEN 'discovered' ELSE 'stale' END,
                error = '', updated_at = ? WHERE id = ?
            `).run(now(), resource.id);
            updateJob(jobId, 'cancelled', progress, 'Indexing was cancelled.', 'CANCELLED');
            restoreSourceStatus(sourceId);
            return;
          }
          progress.failed += 1;
          const status = resource.indexed_revision ? 'stale' : 'failed';
          db.prepare(`
            UPDATE library_resources SET status = ?, error = ?, updated_at = ? WHERE id = ?
          `).run(status, error.message || String(error), now(), resource.id);
          log('warn', 'library', 'Unable to index Library resource', {
            sourceId,
            resourceId: resource.id,
            error: error.message || String(error),
          });
        }
      }
      progress.skipped = Math.max(0, discovered.length - changedIds.length);
      progress.phase = 'done';
      const unresolved = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM library_resources
        WHERE source_id = ? AND status IN ('discovered', 'failed', 'stale')
      `).get(sourceId)?.count) || 0;
      db.prepare(`
        UPDATE library_sources SET
          indexed_revision = CASE WHEN ? = 0 THEN revision ELSE indexed_revision END,
          indexed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        unresolved,
        now(), now(), sourceId,
      );
      updateJob(
        jobId,
        'completed',
        progress,
        progress.failed > 0 ? `${progress.failed} 个资源索引失败。` : '',
        progress.failed > 0 ? 'PARTIAL_FAILURE' : null,
      );
      restoreSourceStatus(sourceId);
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'INDEX_CANCELLED' || error?.code === 'PARSER_CANCELLED') {
        progress.phase = 'cancelled';
        updateJob(jobId, 'cancelled', progress, 'Indexing was cancelled.', 'CANCELLED');
        restoreSourceStatus(sourceId);
        return;
      }
      progress.phase = 'failed';
      updateJob(jobId, 'failed', progress, error.message || String(error), error?.code || 'INDEX_FAILED');
      db.prepare(`UPDATE library_sources SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`)
        .run(error.message || String(error), now(), sourceId);
      emit('source-updated', { sourceId });
      log('error', 'library', 'Library source refresh failed', {
        sourceId,
        error: error.message || String(error),
      });
    } finally {
      jobControllers.delete(jobId);
      if (pendingRefreshes.delete(sourceId) && !closed) {
        queueMicrotask(() => {
          if (!closed) refreshSource({ sourceId, coalesced: true, retryFailed: false });
        });
      }
    }
  }

  function refreshSource(input = {}) {
    ensureOpen();
    if (!featureFlags.core) throw new Error('Library indexing is disabled.');
    const sourceId = text(input.sourceId);
    getSourceRow(sourceId);
    const active = db.prepare(`
      SELECT * FROM library_jobs
      WHERE source_id = ? AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).get(sourceId);
    if (active) {
      if (input.coalesced === true) pendingRefreshes.add(sourceId);
      return jobFromRow(active);
    }
    const jobId = randomUUID();
    const timestamp = now();
    const full = input.full === true;
    const retryFailed = input.retryFailed !== false;
    db.prepare(`
      INSERT INTO library_jobs(id, source_id, kind, status, progress_json, created_at)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `).run(jobId, sourceId, full ? 'rebuild' : 'refresh', json({ retryFailed }), timestamp);
    const job = jobFromRow(db.prepare('SELECT * FROM library_jobs WHERE id = ?').get(jobId));
    queue = queue
      .catch(() => {})
      .then(() => runRefreshJob(jobId, sourceId, full, { retryFailed }));
    emit('job-created', { jobId, sourceId });
    return job;
  }

  function cancelJob(input = {}) {
    const jobId = text(input.jobId);
    const job = db.prepare('SELECT kind, source_id FROM library_jobs WHERE id = ?').get(jobId);
    const result = db.prepare(`
      UPDATE library_jobs SET cancel_requested = 1 WHERE id = ? AND status IN ('queued', 'running')
    `).run(jobId);
    if (Number(result.changes) > 0) {
      jobControllers.get(jobId)?.abort();
      if (job?.source_id) pendingRefreshes.delete(job.source_id);
      if (job?.kind === 'repair') {
        pendingRefreshes.clear();
        const childJobs = db.prepare(`
          SELECT id FROM library_jobs WHERE source_id IS NOT NULL AND status IN ('queued', 'running')
        `).all();
        for (const child of childJobs) {
          db.prepare('UPDATE library_jobs SET cancel_requested = 1 WHERE id = ?').run(child.id);
          jobControllers.get(child.id)?.abort();
        }
      }
    }
    return { ok: Number(result.changes) > 0 };
  }

  function listJobs(input = {}) {
    const sourceId = text(input.sourceId);
    return db.prepare(`
      SELECT * FROM library_jobs
      ${sourceId ? 'WHERE source_id = ?' : ''}
      ORDER BY created_at DESC LIMIT ?
    `).all(...(sourceId ? [sourceId] : []), Math.min(100, Math.max(1, Number(input.limit) || 30)))
      .map(jobFromRow);
  }

  function listResources(input = {}) {
    ensureOpen();
    const clauses = ["r.status <> 'missing'"];
    const params = [];
    if (text(input.collectionId)) {
      clauses.push(`EXISTS (
        SELECT 1 FROM library_collection_sources cs
        WHERE cs.source_id = r.source_id AND cs.collection_id = ?
      )`);
      params.push(text(input.collectionId));
    }
    if (text(input.sourceId)) {
      clauses.push('r.source_id = ?');
      params.push(text(input.sourceId));
    }
    if (text(input.query)) {
      clauses.push('(r.title LIKE ? OR r.relative_path LIKE ?)');
      params.push(`%${text(input.query)}%`, `%${text(input.query)}%`);
    }
    if (Array.isArray(input.extensions) && input.extensions.length > 0) {
      const extensions = input.extensions.map((value) => {
        const normalized = text(value).toLowerCase();
        return normalized.startsWith('.') ? normalized : `.${normalized}`;
      }).filter(Boolean);
      if (extensions.length > 0) {
        clauses.push(`r.extension IN (${extensions.map(() => '?').join(',')})`);
        params.push(...extensions);
      }
    }
    appendAccessScope(clauses, params, 's', input);
    if (input.scopeKind === 'personal') {
      clauses.push("s.scope_kind = 'personal' AND s.provider_kind <> 'task-artifacts'");
    } else if (input.scopeKind === 'projects') {
      clauses.push("s.scope_kind = 'project'");
    } else if (input.scopeKind === 'task-artifacts') {
      clauses.push("s.provider_kind = 'task-artifacts'");
    }
    const limit = Math.min(500, Math.max(1, Number(input.limit) || 200));
    const offset = Math.min(100_000, Math.max(0, Number(input.offset) || 0));
    return db.prepare(`
      SELECT r.*, s.name AS source_name, s.provider_kind, s.scope_kind, s.scope_id
      FROM library_resources r
      JOIN library_sources s ON s.id = r.source_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY r.updated_at DESC, r.title COLLATE NOCASE
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map(resourceFromRow);
  }

  function searchDetailed(input = {}, includeDiagnostics = false) {
    ensureOpen();
    const searchStartedAt = performance.now();
    const query = text(input.query);
    if (!query) {
      return {
        items: [],
        diagnostics: {
          queryTerms: [], requestedMode: 'auto', candidateCounts: {}, candidateLimit: 0,
          coverageRejectedCount: 0, selectedCount: 0, fallbackUsed: false,
          scopedResourceCount: 0, durationMs: 0, reason: 'empty-query', candidates: [],
        },
      };
    }
    const clauses = ["r.status IN ('ready', 'stale')"];
    const params = [];
    if (text(input.collectionId)) {
      clauses.push(`EXISTS (
        SELECT 1 FROM library_collection_sources cs
        WHERE cs.source_id = r.source_id AND cs.collection_id = ?
      )`);
      params.push(text(input.collectionId));
    }
    if (text(input.sourceId)) {
      clauses.push('r.source_id = ?');
      params.push(text(input.sourceId));
    }
    appendAccessScope(clauses, params, 's', input);
    if (input.scopeKind === 'personal') {
      clauses.push("s.scope_kind = 'personal' AND s.provider_kind <> 'task-artifacts'");
    } else if (input.scopeKind === 'projects') {
      clauses.push("s.scope_kind = 'project'");
    } else if (input.scopeKind === 'task-artifacts') {
      clauses.push("s.provider_kind = 'task-artifacts'");
    }
    let normalizedExtensions = [];
    if (Array.isArray(input.extensions) && input.extensions.length > 0) {
      normalizedExtensions = input.extensions.map((value) => {
        const normalized = text(value).toLowerCase();
        return normalized.startsWith('.') ? normalized : `.${normalized}`;
      }).filter(Boolean);
      clauses.push(`r.extension IN (${normalizedExtensions.map(() => '?').join(',')})`);
      params.push(...normalizedExtensions);
    }
    const limit = Math.min(100, Math.max(1, Number(input.limit) || 30));
    const candidateLimit = Math.min(300, Math.max(40, limit * 6));
    const ftsQueries = {};
    const runFts = (mode) => {
      const ftsQuery = buildLibraryFtsQuery(query, mode);
      if (!ftsQuery) return [];
      ftsQueries[mode] = ftsQuery;
      return db.prepare(`
        SELECT c.*, r.uri, r.title, r.relative_path, r.source_id, r.extension,
          r.revision, r.indexed_revision, s.name AS source_name, s.provider_kind,
          s.scope_kind, s.scope_id,
          bm25(library_chunks_fts, 8.0, 3.0, 5.0, 1.0, 0.0) AS fts_score
        FROM library_chunks_fts
        JOIN library_chunks c ON c.id = library_chunks_fts.rowid
        JOIN library_resources r ON r.id = c.resource_id
        JOIN library_sources s ON s.id = r.source_id
        WHERE ${[...clauses, 'library_chunks_fts MATCH ?'].join(' AND ')}
        ORDER BY fts_score, r.updated_at DESC, c.id
        LIMIT ?
      `).all(...params, ftsQuery, candidateLimit);
    };
    const requestedMode = ['all', 'any'].includes(input.mode) ? input.mode : 'auto';
    const runs = [];
    if (requestedMode === 'all' || requestedMode === 'auto') {
      runs.push({ mode: 'all', rows: runFts('all') });
    }
    const strictCount = runs[0]?.rows.length || 0;
    if (requestedMode === 'any'
      || (requestedMode === 'auto' && strictCount < Math.min(3, limit))) {
      runs.push({ mode: 'any', rows: runFts('any') });
    }
    if (!runs.some((run) => run.rows.length > 0)) {
      const like = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      const literalRows = db.prepare(`
        SELECT c.*, r.uri, r.title, r.relative_path, r.source_id, r.extension,
          r.revision, r.indexed_revision, s.name AS source_name, s.provider_kind,
          s.scope_kind, s.scope_id, 0.0 AS fts_score
        FROM library_chunks c
        JOIN library_resources r ON r.id = c.resource_id
        JOIN library_sources s ON s.id = r.source_id
        WHERE ${clauses.join(' AND ')}
          AND (c.content LIKE ? ESCAPE '\\' OR r.title LIKE ? ESCAPE '\\'
            OR r.relative_path LIKE ? ESCAPE '\\' OR c.heading LIKE ? ESCAPE '\\')
        ORDER BY r.updated_at DESC, c.chunk_index
        LIMIT ?
      `).all(...params, like, like, like, like, candidateLimit);
      runs.push({ mode: 'literal', rows: literalRows });
    }
    const queryTerms = tokenizeLibraryText(query).split(/\s+/).filter(Boolean).slice(0, 32);
    const normalizedQuery = normalizeSearchText(query);
    const candidates = new Map();
    const coverageRejected = [];
    let coverageRejectedCount = 0;
    for (const run of runs) {
      run.rows.forEach((row, index) => {
        const chunkId = Number(row.id);
        const current = candidates.get(chunkId) || {
          row,
          rrf: 0,
          modes: new Set(),
          ftsScore: Number(row.fts_score) || 0,
        };
        current.rrf += 1 / (60 + index + 1);
        current.modes.add(run.mode);
        current.ftsScore = Math.min(current.ftsScore, Number(row.fts_score) || 0);
        candidates.set(chunkId, current);
      });
    }
    const ranked = [...candidates.values()].map((candidate) => {
      const row = candidate.row;
      const normalizedTitle = normalizeSearchText(row.title);
      const normalizedPath = normalizeSearchText(row.relative_path);
      const normalizedHeading = normalizeSearchText(row.heading);
      const normalizedBody = normalizeSearchText(row.content);
      const matchedFields = searchMatchedFields(row, queryTerms);
      const queryCoverage = searchTokenCoverage(row, queryTerms);
      if (!candidate.modes.has('all') && candidate.modes.has('any')
        && queryTerms.length > 1 && queryCoverage < 0.6) {
        coverageRejectedCount += 1;
        if (coverageRejected.length < 20) {
          coverageRejected.push({
            chunkId: Number(row.id), resourceId: row.resource_id, title: row.title,
            queryCoverage, fallbackMode: 'any',
          });
        }
        return null;
      }
      const exactPhrase = Boolean(normalizedQuery) && [
        normalizedTitle, normalizedPath, normalizedHeading, normalizedBody,
      ].some((value) => value.includes(normalizedQuery));
      let boost = matchedFields.length * 0.001;
      if (normalizedTitle === normalizedQuery) boost += 0.06;
      else if (normalizedTitle.includes(normalizedQuery)) boost += 0.035;
      if (normalizedHeading.includes(normalizedQuery)) boost += 0.025;
      if (normalizedPath.includes(normalizedQuery)) boost += 0.015;
      if (normalizedBody.includes(normalizedQuery)) boost += 0.008;
      return {
        ...candidate,
        matchedFields,
        queryCoverage,
        exactPhrase,
        boost,
        finalScore: candidate.rrf + boost,
        fallbackMode: candidate.modes.has('all')
          ? 'all'
          : candidate.modes.has('any') ? 'any' : 'literal',
      };
    }).filter(Boolean).sort((left, right) => (
      right.finalScore - left.finalScore
      || left.ftsScore - right.ftsScore
      || Number(left.row.id) - Number(right.row.id)
    ));
    const selected = [];
    const selectedIds = new Set();
    for (const pass of [1, 2, Number.POSITIVE_INFINITY]) {
      for (const candidate of ranked) {
        if (selected.length >= limit) break;
        const row = candidate.row;
        if (selectedIds.has(Number(row.id))) continue;
        const sameResource = selected.filter((entry) => entry.row.resource_id === row.resource_id);
        if (sameResource.length >= pass) continue;
        if (pass !== Number.POSITIVE_INFINITY && sameResource.some((entry) => (
          Math.abs(Number(entry.row.chunk_index) - Number(row.chunk_index)) <= 1
        ))) continue;
        selected.push(candidate);
        selectedIds.add(Number(row.id));
      }
      if (selected.length >= limit) break;
    }
    const includeContext = input.includeContext === true;
    let contextBudget = Math.min(
      100_000,
      Math.max(1_000, Number(input.contextBudget) || DEFAULT_SEARCH_TOTAL_CONTEXT_CHARS),
    );
    const results = selected.map((candidate, resultIndex) => {
      const row = candidate.row;
      let context = row.content;
      let contextChunkIndexes = [Number(row.chunk_index)];
      if (includeContext) {
        const remainingResults = selected.length - resultIndex;
        const resultBudget = Math.max(1, Math.min(
          DEFAULT_SEARCH_CONTEXT_CHARS,
          Math.floor(contextBudget / remainingResults),
        ));
        const neighbors = db.prepare(`
          SELECT chunk_index, block_index, heading, content
          FROM library_chunks
          WHERE resource_id = ? AND chunk_index BETWEEN ? AND ?
          ORDER BY chunk_index
        `).all(row.resource_id, Number(row.chunk_index) - 1, Number(row.chunk_index) + 1)
          .filter((chunk) => Number(chunk.block_index) === Number(row.block_index));
        const merged = mergeOverlappingText(neighbors.map((chunk) => chunk.content)) || row.content;
        context = trimPreservingAnchor(merged, row.content, resultBudget, query, queryTerms);
        contextChunkIndexes = neighbors.map((chunk) => Number(chunk.chunk_index));
        contextBudget = Math.max(0, contextBudget - context.length);
      }
      return {
        chunkId: Number(row.id),
        resourceId: row.resource_id,
        sourceId: row.source_id,
        uri: createLibraryResourceUri(row.resource_id, row.indexed_revision || row.revision, row.title),
        title: row.title,
        relativePath: row.relative_path || '',
        sourceName: row.source_name,
        providerKind: row.provider_kind,
        scope: row.scope_kind === 'project'
          ? { kind: 'project', projectId: row.scope_id }
          : { kind: 'personal' },
        extension: row.extension,
        revision: row.indexed_revision || row.revision,
        chunkIndex: Number(row.chunk_index),
        blockIndex: Number(row.block_index) || 0,
        heading: row.heading || null,
        page: row.page === null ? null : Number(row.page),
        startLine: row.start_line === null ? null : Number(row.start_line),
        endLine: row.end_line === null ? null : Number(row.end_line),
        locationKind: row.location_kind
          || inferLocationKind(row.extension, row.page, row.start_line),
        content: row.content,
        matchedChunk: row.content,
        context,
        contextChunkIndexes,
        snippet: row.content.replace(/\s+/g, ' ').slice(0, 420),
        score: candidate.finalScore,
        rank: {
          final: candidate.finalScore,
          fts: candidate.ftsScore,
          fusion: candidate.rrf,
          boost: candidate.boost,
          matchedFields: candidate.matchedFields,
          exactPhrase: candidate.exactPhrase,
          fallbackMode: candidate.fallbackMode,
          queryTerms,
          queryCoverage: candidate.queryCoverage,
        },
      };
    });
    const durationMs = performance.now() - searchStartedAt;
    const scopedResourceCount = includeDiagnostics || results.length === 0
      ? Number(db.prepare(`
          SELECT COUNT(DISTINCT r.id) AS count
          FROM library_resources r JOIN library_sources s ON s.id = r.source_id
          WHERE ${clauses.join(' AND ')}
        `).get(...params)?.count) || 0
      : 0;
    const fallbackUsed = results.some((result) => result.rank.fallbackMode !== 'all');
    const reason = results.length > 0
      ? 'results'
      : queryTerms.length === 0
        ? 'no-indexable-terms'
        : scopedResourceCount === 0
          ? 'no-scoped-content'
          : coverageRejectedCount > 0 ? 'coverage-filtered' : 'no-lexical-match';
    const selectedChunkIds = new Set(results.map((result) => result.chunkId));
    const diagnostics = {
      queryTerms,
      requestedMode,
      ftsQueries,
      candidateCounts: Object.fromEntries(runs.map((run) => [run.mode, run.rows.length])),
      candidateLimit,
      coverageRejectedCount,
      coverageRejected: includeDiagnostics ? coverageRejected : [],
      selectedCount: results.length,
      fallbackUsed,
      scopedResourceCount,
      durationMs,
      reason,
      candidates: (includeDiagnostics ? ranked.slice(0, 50) : []).map((candidate) => ({
        chunkId: Number(candidate.row.id),
        resourceId: candidate.row.resource_id,
        title: candidate.row.title,
        heading: candidate.row.heading || null,
        selected: selectedChunkIds.has(Number(candidate.row.id)),
        final: candidate.finalScore,
        fts: candidate.ftsScore,
        fusion: candidate.rrf,
        boost: candidate.boost,
        matchedFields: candidate.matchedFields,
        exactPhrase: candidate.exactPhrase,
        fallbackMode: candidate.fallbackMode,
        queryCoverage: candidate.queryCoverage,
      })),
    };
    recordMetric('search', durationMs, results.length, {
      mode: requestedMode,
      fallbackUsed,
      includeContext,
      reason,
    });
    return { items: results, diagnostics };
  }

  function search(input = {}) {
    return searchDetailed(input).items;
  }

  function diagnoseSearch(input = {}) {
    return searchDetailed(input, true);
  }

  function evaluationCaseFromRow(row) {
    return row ? {
      id: row.id,
      name: row.name,
      query: row.query,
      expectedResourceId: row.expected_resource_id || null,
      expectedResourceTitle: row.expected_resource_title || null,
      expectedHeading: row.expected_heading || null,
      collectionId: row.collection_id || null,
      sourceId: row.source_id || null,
      scopeKind: row.scope_kind,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    } : null;
  }

  function listEvaluationCases() {
    ensureOpen();
    return db.prepare(`
      SELECT c.*, r.title AS expected_resource_title
      FROM library_evaluation_cases c
      LEFT JOIN library_resources r ON r.id = c.expected_resource_id
      ORDER BY c.updated_at DESC, c.id
    `).all().map(evaluationCaseFromRow);
  }

  function saveEvaluationCase(input = {}) {
    ensureOpen();
    const query = text(input.query).slice(0, 500);
    if (!query) throw new Error('评测问题不能为空。');
    const expectedResourceId = text(input.expectedResourceId) || null;
    if (expectedResourceId && !db.prepare(
      "SELECT id FROM library_resources WHERE id = ? AND status <> 'missing'",
    ).get(expectedResourceId)) {
      throw new Error('评测目标资源不存在或已移除。');
    }
    const collectionId = text(input.collectionId) || null;
    if (collectionId && !db.prepare('SELECT id FROM library_collections WHERE id = ?').get(collectionId)) {
      throw new Error('评测资料集不存在。');
    }
    const sourceId = text(input.sourceId) || null;
    if (sourceId && !db.prepare('SELECT id FROM library_sources WHERE id = ?').get(sourceId)) {
      throw new Error('评测来源不存在。');
    }
    const scopeKind = ['personal', 'projects', 'task-artifacts'].includes(input.scopeKind)
      ? input.scopeKind
      : 'personal';
    const name = (text(input.name) || query).slice(0, 120);
    const expectedHeading = text(input.expectedHeading).slice(0, 240) || null;
    const id = text(input.id) || randomUUID();
    const timestamp = now();
    const existing = db.prepare('SELECT created_at FROM library_evaluation_cases WHERE id = ?').get(id);
    if (text(input.id) && !existing) throw new Error('评测样例不存在。');
    db.prepare(`
      INSERT INTO library_evaluation_cases(
        id, name, query, expected_resource_id, expected_heading, collection_id,
        source_id, scope_kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        query = excluded.query,
        expected_resource_id = excluded.expected_resource_id,
        expected_heading = excluded.expected_heading,
        collection_id = excluded.collection_id,
        source_id = excluded.source_id,
        scope_kind = excluded.scope_kind,
        updated_at = excluded.updated_at
    `).run(
      id, name, query, expectedResourceId, expectedHeading, collectionId,
      sourceId, scopeKind, Number(existing?.created_at) || timestamp, timestamp,
    );
    emit('evaluation-case-updated', { caseId: id });
    return evaluationCaseFromRow(db.prepare(`
      SELECT c.*, r.title AS expected_resource_title
      FROM library_evaluation_cases c
      LEFT JOIN library_resources r ON r.id = c.expected_resource_id
      WHERE c.id = ?
    `).get(id));
  }

  function deleteEvaluationCase(input = {}) {
    ensureOpen();
    const id = text(input.id);
    const result = db.prepare('DELETE FROM library_evaluation_cases WHERE id = ?').run(id);
    if (Number(result.changes) > 0) emit('evaluation-case-deleted', { caseId: id });
    return { ok: Number(result.changes) > 0 };
  }

  function evaluationRunFromRow(row, includeDetails = false) {
    if (!row) return null;
    return {
      id: row.id,
      summary: parseJson(row.summary_json, {}),
      ...(includeDetails ? { details: parseJson(row.details_json, []) } : {}),
      createdAt: Number(row.created_at),
    };
  }

  function getEvaluationOverview() {
    ensureOpen();
    const runs = db.prepare(`
      SELECT id, summary_json, details_json, created_at
      FROM library_evaluation_runs ORDER BY created_at DESC LIMIT 20
    `).all();
    return {
      cases: listEvaluationCases(),
      latestRun: evaluationRunFromRow(runs[0], true),
      recentRuns: runs.map((row) => evaluationRunFromRow(row, false)),
    };
  }

  function runEvaluation(input = {}) {
    ensureOpen();
    const requestedIds = new Set(Array.isArray(input.caseIds) ? input.caseIds.map(text).filter(Boolean) : []);
    const cases = listEvaluationCases()
      .filter((entry) => requestedIds.size === 0 || requestedIds.has(entry.id))
      .slice(0, 500);
    if (cases.length === 0) throw new Error('请先添加至少一个检索评测样例。');
    const resultSets = [];
    const durations = [];
    const details = [];
    let citedHits = 0;
    let positiveHits = 0;
    let duplicateEvidence = 0;
    let evidenceCount = 0;
    for (const entry of cases) {
      const outcome = searchDetailed({
        query: entry.query,
        collectionId: entry.collectionId || undefined,
        sourceId: entry.sourceId || undefined,
        scopeKind: entry.scopeKind,
        mode: 'auto',
        limit: 5,
        includeContext: true,
      });
      const results = outcome.items;
      durations.push(outcome.diagnostics.durationMs);
      const normalizedExpectedHeading = normalizeSearchText(entry.expectedHeading);
      resultSets.push(normalizedExpectedHeading
        ? results.map((result, index) => (
            result.resourceId === entry.expectedResourceId
              && !normalizeSearchText(result.heading).includes(normalizedExpectedHeading)
              ? { ...result, resourceId: `heading-mismatch-${index}` }
              : result
          ))
        : results);
      const resultRank = entry.expectedResourceId
        ? results.findIndex((result) => (
            result.resourceId === entry.expectedResourceId
            && (!normalizedExpectedHeading
              || normalizeSearchText(result.heading).includes(normalizedExpectedHeading))
          ))
        : -1;
      if (resultRank >= 0) {
        positiveHits += 1;
        const hit = results[resultRank];
        if (hit.uri && hit.revision && (hit.page || hit.startLine || hit.heading || hit.chunkIndex >= 0)) {
          citedHits += 1;
        }
      }
      const seenResources = new Set();
      for (const result of results) {
        evidenceCount += 1;
        if (seenResources.has(result.resourceId)) duplicateEvidence += 1;
        seenResources.add(result.resourceId);
      }
      details.push({
        caseId: entry.id,
        name: entry.name,
        query: entry.query,
        expectedResourceId: entry.expectedResourceId,
        expectedResourceTitle: entry.expectedResourceTitle,
        expectedNoResult: !entry.expectedResourceId,
        passed: entry.expectedResourceId ? resultRank >= 0 && resultRank < 5 : results.length === 0,
        resultRank: resultRank >= 0 ? resultRank + 1 : null,
        resultCount: results.length,
        durationMs: outcome.diagnostics.durationMs,
        reason: outcome.diagnostics.reason,
        topResults: results.map((result) => ({
          resourceId: result.resourceId,
          title: result.title,
          heading: result.heading,
          score: result.score,
        })),
      });
    }
    const summary = {
      ...evaluateLibraryRetrievalCases(
        cases.map((entry) => ({ expectedResourceIds: entry.expectedResourceId ? [entry.expectedResourceId] : [] })),
        resultSets,
        durations,
      ),
      passedCases: details.filter((entry) => entry.passed).length,
      citationCompleteness: positiveHits ? citedHits / positiveHits : 0,
      duplicateEvidenceRate: evidenceCount ? duplicateEvidence / evidenceCount : 0,
      contextCharacterCount: resultSets.flat().reduce((sum, result) => sum + result.context.length, 0),
    };
    const id = randomUUID();
    const createdAt = now();
    db.prepare(`
      INSERT INTO library_evaluation_runs(id, summary_json, details_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, json(summary), json(details), createdAt);
    db.prepare(`
      DELETE FROM library_evaluation_runs WHERE id IN (
        SELECT id FROM library_evaluation_runs ORDER BY created_at DESC LIMIT -1 OFFSET 20
      )
    `).run();
    emit('evaluation-completed', { runId: id });
    return { id, summary, details, createdAt };
  }

  function getResource(input = {}) {
    const resourceId = text(input.resourceId);
    const clauses = ['r.id = ?'];
    const params = [resourceId];
    appendAccessScope(clauses, params, 's', input);
    const row = db.prepare(`
      SELECT r.*, s.name AS source_name, s.provider_kind, s.scope_kind, s.scope_id
      FROM library_resources r JOIN library_sources s ON s.id = r.source_id
      WHERE ${clauses.join(' AND ')}
    `).get(...params);
    if (!row) throw new Error('Library resource not found.');
    const chunkOffset = Math.min(100_000, Math.max(0, Number(input.chunkOffset) || 0));
    const chunkLimit = Math.min(500, Math.max(1, Number(input.chunkLimit) || 100));
    const chunks = db.prepare(`
      SELECT id, chunk_index, block_index, heading, page, start_line, end_line,
        location_kind, content
      FROM library_chunks WHERE resource_id = ? AND chunk_index >= ?
      ORDER BY chunk_index LIMIT ?
    `).all(resourceId, chunkOffset, chunkLimit);
    return {
      ...resourceFromRow(row),
      chunks: chunks.map((chunk) => ({
        id: Number(chunk.id),
        index: Number(chunk.chunk_index),
        blockIndex: Number(chunk.block_index) || 0,
        heading: chunk.heading || null,
        page: chunk.page === null ? null : Number(chunk.page),
        startLine: chunk.start_line === null ? null : Number(chunk.start_line),
        endLine: chunk.end_line === null ? null : Number(chunk.end_line),
        locationKind: chunk.location_kind
          || inferLocationKind(row.extension, chunk.page, chunk.start_line),
        content: chunk.content,
      })),
      nextOffset: chunks.length === chunkLimit ? chunkOffset + chunks.length : null,
    };
  }

  async function resolveResourcePath(resourceId, access = {}) {
    const row = db.prepare(`
      SELECT r.*, s.provider_kind, s.locator AS source_locator,
        s.scope_kind, s.scope_id
      FROM library_resources r JOIN library_sources s ON s.id = r.source_id
      WHERE r.id = ?
    `).get(resourceId);
    if (!row || row.status === 'missing') throw new Error('Library resource is unavailable.');
    if (access.enforceScope === true
      && row.scope_kind === 'project'
      && row.scope_id !== text(access.projectId)) {
      throw new Error('This Library resource belongs to a different project scope.');
    }
    let candidate = row.locator;
    if (row.provider_kind === 'project-assets') {
      const assets = await getProjectAssets(row.source_locator);
      const asset = (Array.isArray(assets) ? assets : []).find((item) => item?.id === row.provider_resource_id);
      if (!asset?.path) throw new Error('The project asset is no longer available.');
      candidate = asset.path;
    }
    const realCandidate = await fsp.realpath(path.resolve(candidate));
    const candidateLinkStat = await fsp.lstat(path.resolve(candidate));
    if (candidateLinkStat.isSymbolicLink()) {
      throw new Error('Library resources cannot resolve through symbolic links.');
    }
    const stat = await fsp.stat(realCandidate);
    if (!stat.isFile()) throw new Error('Library resource is not a file.');
    if (row.provider_kind !== 'project-assets') {
      const realSource = await fsp.realpath(path.resolve(row.source_locator));
      const sourceLinkStat = await fsp.lstat(path.resolve(row.source_locator));
      if (sourceLinkStat.isSymbolicLink()) {
        throw new Error('Library source roots cannot be symbolic links.');
      }
      if (realSource !== path.resolve(row.source_locator)) {
        throw new Error('Library source roots cannot resolve through symbolic-link ancestors.');
      }
      const sourceStat = await fsp.stat(realSource);
      if (sourceStat.isDirectory() && !isPathInside(realSource, realCandidate)) {
        throw new Error('Library resource escaped its authorized source.');
      }
      if (sourceStat.isFile() && realSource !== realCandidate) {
        throw new Error('Library resource no longer matches its authorized source.');
      }
    }
    return { path: realCandidate, row };
  }

  async function openResource(input = {}) {
    const resolved = await resolveResourcePath(text(input.resourceId));
    return { path: resolved.path, resource: resourceFromRow(resolved.row) };
  }

  function ensureScopeAccess(row, sessionRecord) {
    if (row.scope_kind !== 'project') return;
    if (!sessionRecord?.projectId || row.scope_id !== sessionRecord.projectId) {
      throw new Error('This Library scope belongs to a different project.');
    }
  }

  async function mergeSessionRuntimeManifest(sessionRecord, additions) {
    if (typeof getSessionResourceManifestPath !== 'function') return;
    const runtimeManifestPath = path.resolve(getSessionResourceManifestPath(sessionRecord));
    let runtimeManifest = {};
    try {
      runtimeManifest = parseJson(await fsp.readFile(runtimeManifestPath, 'utf8'), {});
    } catch {}
    const mergeByUri = (current, incoming) => {
      const byUri = new Map((Array.isArray(current) ? current : []).map((item) => [item.uri, item]));
      for (const item of Array.isArray(incoming) ? incoming : []) byUri.set(item.uri, item);
      return [...byUri.values()];
    };
    const nextManifest = {
      ...runtimeManifest,
      schemaVersion: Number(runtimeManifest.schemaVersion) || 1,
      generatedAt: now(),
      libraryResources: mergeByUri(runtimeManifest.libraryResources, additions.libraryResources),
      libraryScopes: mergeByUri(runtimeManifest.libraryScopes, additions.libraryScopes),
      libraryQuotes: mergeByUri(runtimeManifest.libraryQuotes, additions.libraryQuotes),
    };
    await fsp.mkdir(path.dirname(runtimeManifestPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${runtimeManifestPath}.${process.pid}.${randomUUID()}.tmp`;
    await fsp.writeFile(temporaryPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await fsp.rename(temporaryPath, runtimeManifestPath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      await fsp.rm(runtimeManifestPath, { force: true });
      await fsp.rename(temporaryPath, runtimeManifestPath);
    }
  }

  async function prepareComposerResources(sessionRecord, inputResources) {
    ensureOpen();
    if (!featureFlags.composerResources) throw new Error('Library composer resources are disabled.');
    const normalized = [];
    for (const input of (Array.isArray(inputResources) ? inputResources : []).slice(0, 50)) {
      if (!input || typeof input !== 'object') throw new Error('Invalid Library resource reference.');
      const uri = text(input.uri);
      let parsed;
      try {
        parsed = new URL(uri);
      } catch {
        throw new Error('Invalid Library resource reference.');
      }
      if (parsed.protocol !== LIBRARY_RESOURCE_SCHEME) throw new Error('Invalid Library resource reference.');
      const id = parsed.pathname.replace(/^\/+/, '');
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(id) || (text(input.resourceId) && text(input.resourceId) !== id)) {
        throw new Error('Invalid Library resource identity.');
      }
      if (parsed.hostname === 'resource') {
        const reference = parseLibraryResourceUri(uri);
        const row = db.prepare(`
          SELECT r.*, s.scope_kind, s.scope_id
          FROM library_resources r JOIN library_sources s ON s.id = r.source_id
          WHERE r.id = ? AND r.status <> 'missing'
        `).get(reference.resourceId);
        if (!row) throw new Error('Library resource is unavailable.');
        ensureScopeAccess(row, sessionRecord);
        const selection = input.selection === 'quote' ? 'quote' : 'full-file';
        let quote;
        if (selection === 'quote') {
          if (reference.revision && reference.revision !== row.indexed_revision) {
            throw new Error('The indexed Library resource changed since this quote was created.');
          }
          const quoteText = String(input.quote?.text || '').trim().slice(0, 8_000);
          if (!quoteText) throw new Error('A Library quote must contain indexed text.');
          const indexedQuote = db.prepare(`
            SELECT 1 FROM library_chunks WHERE resource_id = ? AND instr(content, ?) > 0 LIMIT 1
          `).get(row.id, quoteText);
          if (!indexedQuote) throw new Error('The quoted text is not present in the indexed Library resource.');
          quote = {
            text: quoteText,
            heading: text(input.quote?.heading) || undefined,
            page: Number.isFinite(Number(input.quote?.page)) ? Number(input.quote.page) : undefined,
          };
        }
        normalized.push({
          uri,
          resourceId: row.id,
          kind: 'resource',
          selection,
          displayName: row.title,
          revision: reference.revision || row.revision || null,
          quote,
          scope: row.scope_kind === 'project'
            ? { kind: 'project', projectId: row.scope_id }
            : { kind: 'personal' },
        });
        continue;
      }
      if (!['collection', 'source'].includes(parsed.hostname) || input.selection !== 'search-scope') {
        throw new Error('Invalid Library retrieval scope.');
      }
      const table = parsed.hostname === 'collection' ? 'library_collections' : 'library_sources';
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
      if (!row) throw new Error('Library retrieval scope is unavailable.');
      ensureScopeAccess(row, sessionRecord);
      normalized.push({
        uri,
        resourceId: id,
        kind: parsed.hostname,
        selection: 'search-scope',
        displayName: row.name,
        revision: null,
        scope: row.scope_kind === 'project'
          ? { kind: 'project', projectId: row.scope_id }
          : { kind: 'personal' },
      });
    }
    const scopes = normalized.filter((item) => item.selection === 'search-scope');
    const quotes = normalized.filter((item) => item.selection === 'quote');
    if (scopes.length > 0 || quotes.length > 0) {
      await mergeSessionRuntimeManifest(sessionRecord, {
        libraryScopes: scopes,
        libraryQuotes: quotes,
      });
    }
    return normalized;
  }

  async function resolveAttachmentUris(sessionRecord, filePaths) {
    const resolvedPaths = [];
    const references = [];
    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
      const reference = parseLibraryResourceUri(filePath);
      if (!reference) {
        resolvedPaths.push(filePath);
        continue;
      }
      const resolved = await resolveResourcePath(reference.resourceId, {
        enforceScope: Boolean(sessionRecord.projectId),
        projectId: sessionRecord.projectId || null,
      });
      if (reference.revision && reference.revision !== resolved.row.revision) {
        throw new Error(`Library resource changed since it was selected: ${resolved.row.title}`);
      }
      const snapshotDir = path.join(sessionRecord.workspace, '.moss', 'library-resources', resolved.row.id);
      await fsp.mkdir(snapshotDir, { recursive: true, mode: 0o700 });
      const targetPath = path.join(snapshotDir, safeName(path.basename(resolved.path)));
      const sourceHash = await sha256File(resolved.path);
      const targetHash = fs.existsSync(targetPath) ? await sha256File(targetPath).catch(() => '') : '';
      if (sourceHash !== targetHash) await fsp.copyFile(resolved.path, targetPath);
      await fsp.chmod(targetPath, 0o600).catch(() => {});
      resolvedPaths.push(targetPath);
      references.push({
        resourceId: resolved.row.id,
        uri: reference.uri,
        revision: resolved.row.revision,
        title: resolved.row.title,
        localizedPath: targetPath,
        contentHash: sourceHash,
        localizedAt: now(),
      });
    }
    if (references.length > 0) {
      const manifestPath = path.join(sessionRecord.workspace, '.moss', 'library-resources', 'manifest.json');
      let manifest = { version: 1, resources: [] };
      try {
        manifest = parseJson(await fsp.readFile(manifestPath, 'utf8'), manifest);
      } catch {}
      const byUri = new Map((Array.isArray(manifest.resources) ? manifest.resources : []).map((item) => [item.uri, item]));
      for (const item of references) byUri.set(item.uri, item);
      await fsp.writeFile(manifestPath, `${JSON.stringify({
        version: 1,
        updatedAt: now(),
        resources: [...byUri.values()],
      }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await mergeSessionRuntimeManifest(sessionRecord, { libraryResources: references });
    }
    return resolvedPaths;
  }

  function getMigrationPreview(options = {}) {
    const includeLocators = options.includeLocators === true;
    const migrated = db.prepare('SELECT value FROM library_meta WHERE key = ?').get('legacy_local_kb_migrated');
    if (migrated?.value) {
      const marker = parseJson(migrated.value, null);
      return {
        available: false,
        migratedAt: Number(marker?.migratedAt || migrated.value) || null,
        legacyDbHash: marker?.legacyDbHash || null,
        knowledgeBases: [],
      };
    }
    if (!fs.existsSync(legacyDbPath)) return { available: false, knowledgeBases: [] };
    let legacy;
    try {
      legacy = new DatabaseSync(legacyDbPath, { readOnly: true });
      const tables = legacy.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('knowledge_bases', 'corpus_paths')
      `).all().map((row) => row.name);
      if (!tables.includes('knowledge_bases') || !tables.includes('corpus_paths')) {
        return { available: false, knowledgeBases: [] };
      }
      const kbColumns = new Set(
        legacy.prepare('PRAGMA table_info(knowledge_bases)').all().map((row) => row.name),
      );
      const descriptionSelect = kbColumns.has('description') ? 'description' : "'' AS description";
      const configSelect = kbColumns.has('config_json') ? 'config_json' : "'{}' AS config_json";
      const knowledgeBases = legacy.prepare(`
        SELECT id, name, ${descriptionSelect}, ${configSelect}
        FROM knowledge_bases ORDER BY created_at, name
      `).all().map((kb) => ({
        id: kb.id,
        name: kb.name,
        description: kb.description || '',
        config: parseJson(kb.config_json, {}),
        paths: legacy.prepare(`
          SELECT path, recursive, max_depth, include_globs, exclude_globs, exts
          FROM corpus_paths WHERE kb_id = ? ORDER BY path
        `).all(kb.id).map((entry) => ({
          path: path.basename(entry.path),
          ...(includeLocators ? { locator: entry.path } : {}),
          exists: fs.existsSync(entry.path),
          recursive: Boolean(entry.recursive),
          maxDepth: entry.max_depth === null ? null : Number(entry.max_depth),
          include: parseJson(entry.include_globs, []),
          exclude: parseJson(entry.exclude_globs, []),
          extensions: parseJson(entry.exts, []),
        })),
      }));
      return {
        available: knowledgeBases.length > 0,
        knowledgeBases,
        sourceCount: knowledgeBases.reduce((sum, item) => sum + item.paths.length, 0),
      };
    } catch (error) {
      log('warn', 'library', 'Unable to inspect legacy local-kb database', {
        error: error.message || String(error),
      });
      return {
        available: false,
        knowledgeBases: [],
        error: 'Unable to inspect the legacy local-kb database.',
      };
    } finally {
      legacy?.close();
    }
  }

  async function migrateLegacy() {
    const preview = getMigrationPreview({ includeLocators: true });
    if (!preview.available) return { migrated: false, collections: 0, sources: 0, skipped: 0 };
    let collectionCount = 0;
    let sourceCount = 0;
    let skipped = 0;
    const migratedSourceIds = new Set();
    const migrationStartedAt = now();
    const backupDir = path.join(libraryRoot, 'migration-backups');
    await fsp.mkdir(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = path.join(backupDir, `library-registrations-${migrationStartedAt}.json`);
    await fsp.writeFile(backupPath, `${JSON.stringify({
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      createdAt: migrationStartedAt,
      collections: db.prepare('SELECT * FROM library_collections ORDER BY created_at').all(),
      sources: db.prepare('SELECT * FROM library_sources ORDER BY created_at').all(),
      collectionSources: db.prepare('SELECT * FROM library_collection_sources ORDER BY created_at').all(),
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    const legacyDbHash = await sha256File(legacyDbPath);
    for (const knowledgeBase of preview.knowledgeBases) {
      const collectionName = knowledgeBase.name || 'Imported Library';
      const existingCollection = db.prepare(`
        SELECT * FROM library_collections
        WHERE scope_kind = 'personal' AND scope_id IS NULL AND name = ? COLLATE NOCASE
        ORDER BY created_at LIMIT 1
      `).get(collectionName);
      const collection = existingCollection
        ? updateCollection({
            id: existingCollection.id,
            description: knowledgeBase.description,
            config: knowledgeBase.config,
          })
        : createCollection({
            name: collectionName,
            description: knowledgeBase.description,
            config: knowledgeBase.config,
          });
      if (!existingCollection) collectionCount += 1;
      for (const legacySource of knowledgeBase.paths) {
        if (!legacySource.exists) {
          skipped += 1;
          continue;
        }
        const source = await addLocalSource({
          collectionId: collection.id,
          path: legacySource.locator,
          recursive: legacySource.recursive,
          maxDepth: legacySource.maxDepth,
          include: legacySource.include,
          exclude: legacySource.exclude,
          extensions: legacySource.extensions,
          refresh: false,
        });
        migratedSourceIds.add(source.id);
        sourceCount += 1;
      }
    }
    db.prepare(`
      INSERT INTO library_meta(key, value) VALUES ('legacy_local_kb_migrated', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(json({ migratedAt: now(), legacyDbHash, registrationBackup: backupPath }));
    for (const sourceId of migratedSourceIds) refreshSource({ sourceId });
    emit('legacy-migrated', { collectionCount, sourceCount, skipped });
    return { migrated: true, collections: collectionCount, sources: sourceCount, skipped };
  }

  function dismissLegacyMigration() {
    db.prepare(`
      INSERT INTO library_meta(key, value) VALUES ('legacy_local_kb_migrated', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(now()));
    emit('legacy-migration-dismissed');
    return { ok: true };
  }

  function repairIndex() {
    ensureOpen();
    const active = db.prepare(`
      SELECT id FROM library_jobs WHERE status IN ('queued', 'running') LIMIT 1
    `).get();
    if (active) throw new Error('Wait for current Library jobs to finish before repairing the index.');
    const jobId = randomUUID();
    const createdAt = now();
    db.prepare(`
      INSERT INTO library_jobs(id, source_id, kind, status, progress_json, created_at)
      VALUES (?, NULL, 'repair', 'queued', '{}', ?)
    `).run(jobId, createdAt);
    queue = queue.catch(() => {}).then(async () => {
      const sourceIds = db.prepare('SELECT id FROM library_sources WHERE enabled = 1 ORDER BY created_at')
        .all().map((row) => row.id);
      const progress = { phase: 'reset', discovered: sourceIds.length, indexed: 0, skipped: 0, failed: 0 };
      updateJob(jobId, 'running', progress);
      try {
        transaction(() => {
          db.prepare('DELETE FROM library_chunks_fts').run();
          db.prepare('DELETE FROM library_chunks').run();
          db.prepare(`
            UPDATE library_resources SET indexed_revision = NULL, indexed_at = NULL,
              status = CASE
                WHEN status = 'unsupported' THEN 'unsupported'
                WHEN status = 'missing' THEN 'missing'
                ELSE 'discovered'
              END,
              error = CASE WHEN status = 'unsupported' THEN error ELSE '' END,
              updated_at = ?
          `).run(now());
          db.prepare(`
            UPDATE library_sources SET indexed_revision = NULL, indexed_at = NULL,
              status = 'idle', error = '', updated_at = ?
          `).run(now());
        });
        progress.phase = 'rebuild';
        updateJob(jobId, 'running', progress);
        for (const sourceId of sourceIds) {
          if (db.prepare('SELECT cancel_requested FROM library_jobs WHERE id = ?').get(jobId)?.cancel_requested) {
            updateJob(jobId, 'cancelled', progress, 'Index repair was cancelled.', 'CANCELLED');
            return;
          }
          const childJobId = randomUUID();
          db.prepare(`
            INSERT INTO library_jobs(id, source_id, kind, status, progress_json, created_at)
            VALUES (?, ?, 'rebuild', 'queued', '{}', ?)
          `).run(childJobId, sourceId, now());
          await runRefreshJob(childJobId, sourceId, true);
          const child = db.prepare('SELECT status FROM library_jobs WHERE id = ?').get(childJobId);
          if (child?.status === 'completed') progress.indexed += 1;
          else progress.failed += 1;
          updateJob(jobId, 'running', progress);
        }
        progress.phase = 'done';
        updateJob(
          jobId,
          'completed',
          progress,
          progress.failed ? `${progress.failed} source(s) failed to rebuild.` : '',
          progress.failed ? 'PARTIAL_FAILURE' : null,
        );
      } catch (error) {
        progress.phase = 'failed';
        updateJob(jobId, 'failed', progress, error.message || String(error), error?.code || 'REPAIR_FAILED');
      }
    });
    emit('job-created', { jobId, sourceId: null });
    return jobFromRow(db.prepare('SELECT * FROM library_jobs WHERE id = ?').get(jobId));
  }

  function getOverview() {
    ensureOpen();
    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM library_collections) AS collections,
        (SELECT COUNT(*) FROM library_sources) AS sources,
        (SELECT COUNT(*) FROM library_resources WHERE status <> 'missing') AS resources,
        (SELECT COUNT(*) FROM library_chunks) AS chunks,
        (SELECT COUNT(*) FROM library_resources
          WHERE status = 'failed' OR (status = 'stale' AND error <> '')) AS errors
    `).get();
    const engine = getEngineStatus() || {};
    return {
      defaultCollectionId: ensureDefaultCollection(),
      stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value) || 0])),
      supportedExtensions: [...SUPPORTED_LIBRARY_EXTENSIONS],
      featureFlags: { ...featureFlags },
      engine: {
        status: engine.installed ? 'ready' : engine.resourceAvailable ? 'installing' : 'unavailable',
        runtime: 'managed-python',
        protocolVersion: 1,
      },
      providers: [
        { kind: 'local-path', capabilities: providerCapabilities('local-path') },
        { kind: 'project-assets', capabilities: providerCapabilities('project-assets') },
        { kind: 'task-artifacts', capabilities: providerCapabilities('task-artifacts') },
      ],
      diagnostics: getMetrics(),
      activeJobs: listJobs({ limit: 100 }).filter((job) => ['queued', 'running'].includes(job.status)),
      migration: featureFlags.migration ? getMigrationPreview() : { available: false, knowledgeBases: [] },
    };
  }

  function refreshProjectSource(projectId) {
    const source = db.prepare(`
      SELECT id FROM library_sources WHERE provider_kind = 'project-assets' AND locator = ?
    `).get(text(projectId));
    return source ? refreshSource({ sourceId: source.id, coalesced: true }) : null;
  }

  async function waitForIdle() {
    await queue;
  }

  function close() {
    if (closed) return;
    const hasActiveJobs = Boolean(db.prepare(`
      SELECT 1 FROM library_jobs WHERE status IN ('queued', 'running') LIMIT 1
    `).get());
    closed = true;
    if (fallbackTimer) clearInterval(fallbackTimer);
    for (const sourceId of sourceWatchers.keys()) stopSourceWatcher(sourceId);
    db.prepare(`
      UPDATE library_jobs SET cancel_requested = 1 WHERE status IN ('queued', 'running')
    `).run();
    for (const controller of jobControllers.values()) controller.abort();
    jobControllers.clear();
    for (const timer of watcherTimers.values()) clearTimeout(timer);
    watcherTimers.clear();
    if (hasActiveJobs) {
      void queue.finally(() => {
        try { db.close(); } catch {}
      });
    } else {
      db.close();
    }
  }

  if (featureFlags.core) {
    for (const job of recoverableJobs) {
      if (job.kind === 'refresh' && Number(job.has_terminal_history)) continue;
      if (Number(job.attempt_count) >= MAX_JOB_ATTEMPTS) continue;
      const retryFailed = parseJson(job.progress_json, {}).retryFailed !== false;
      queue = queue
        .catch(() => {})
        .then(() => runRefreshJob(job.id, job.source_id, job.kind === 'rebuild', { retryFailed }));
    }
  }
  if (featureFlags.core && watchSources) {
    const localSources = db.prepare(`
      SELECT * FROM library_sources WHERE provider_kind = 'local-path' AND enabled = 1
    `).all();
    for (const source of localSources) {
      installSourceWatcher(source);
      const config = parseJson(source.config_json, {});
      if (config.scanConfigVersion === 1) continue;
      try {
        const isDirectory = fs.statSync(source.locator).isDirectory();
        const extensions = normalizeExtensions(config.extensions)
          .filter((extension) => SUPPORTED_EXTENSION_SET.has(extension));
        const migratedConfig = {
          ...config,
          scanConfigVersion: 1,
          recursive: isDirectory && config.recursive !== false,
          maxDepth: isDirectory && Number.isInteger(config.maxDepth) && config.maxDepth >= 0
            ? config.maxDepth
            : isDirectory ? DEFAULT_LIBRARY_DIRECTORY_SCAN.maxDepth : 0,
          extensions: extensions.length > 0 ? extensions : [...SUPPORTED_LIBRARY_EXTENSIONS],
          maxFiles: isDirectory && Number(config.maxFiles) > 0 && Number(config.maxFiles) < DEFAULT_MAX_SOURCE_FILES
            ? Number(config.maxFiles)
            : isDirectory ? DEFAULT_LIBRARY_DIRECTORY_SCAN.maxFiles : 1,
          maxFileBytes: Math.max(1, Number(config.maxFileBytes) || DEFAULT_MAX_FILE_BYTES),
        };
        db.prepare('UPDATE library_sources SET config_json = ?, updated_at = ? WHERE id = ?')
          .run(json(migratedConfig), now(), source.id);
        refreshSource({ sourceId: source.id, coalesced: true });
      } catch (error) {
        log('warn', 'library', 'Unable to migrate local source scan settings', {
          sourceId: source.id,
          error: error.message || String(error),
        });
      }
    }
    fallbackTimer = setInterval(() => {
      if (closed) return;
      for (const sourceId of [...fallbackSourceIds]) {
        const source = db.prepare(`
          SELECT id FROM library_sources
          WHERE id = ? AND provider_kind = 'local-path' AND enabled = 1
        `).get(sourceId);
        if (source) queueWatchedRefresh(source.id);
        else fallbackSourceIds.delete(sourceId);
      }
    }, watchFallbackMs);
    fallbackTimer.unref?.();
  }

  return Object.freeze({
    addLocalSource,
    addProjectSource,
    cancelJob,
    close,
    createCollection,
    deleteCollection,
    deleteEvaluationCase,
    diagnoseSearch,
    dismissLegacyMigration,
    getMigrationPreview,
    getMetrics,
    getOverview,
    getEvaluationOverview,
    getResource,
    listCollections,
    listJobs,
    listResources,
    listSources,
    migrateLegacy,
    openResource,
    prepareComposerResources,
    refreshProjectSource,
    repairIndex,
    runEvaluation,
    refreshSource,
    removeSource,
    resolveAttachmentUris,
    saveTaskArtifact,
    writeFilesToCollection,
    search,
    saveEvaluationCase,
    updateCollection,
    waitForIdle,
  });
}
