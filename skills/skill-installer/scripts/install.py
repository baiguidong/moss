#!/usr/bin/env python3
"""Inspect and install Moss skills without executing downloaded code."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

MAX_BYTES = 50 * 1024 * 1024
MAX_FILES = 2000
NAME = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
META = '_moss_meta.json'


def home():
    return Path(os.environ.get('MOSS_HOME', Path.home() / '.moss')).expanduser()


def hub_url():
    try:
        settings = json.loads((home() / 'settings.json').read_text())
        return settings.get('skillHub', {}).get('apiBaseUrl') or 'https://api.skillhub.cn'
    except (OSError, ValueError):
        return 'https://api.skillhub.cn'


def fetch(url):
    if urllib.parse.urlparse(url).scheme not in ('https', 'http'):
        raise ValueError('只支持 HTTP(S) 来源')
    request = urllib.request.Request(url, headers={'User-Agent': 'Moss-SkillInstaller/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('下载超过 50 MiB 限制')
    return data


def api(base, route, **params):
    return base.rstrip('/') + route + '?' + urllib.parse.urlencode({k: v for k, v in params.items() if v})


def safe_path(name):
    path = PurePosixPath(name)
    if not name or '\\' in name or '\0' in name or ':' in name or path.is_absolute() or '..' in path.parts:
        raise ValueError(f'不安全的文件路径：{name}')
    return path


def unzip(data, dest):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_FILES or sum(e.file_size for e in entries) > MAX_BYTES:
            raise ValueError('解压内容超出限制')
        seen = set()
        for entry in entries:
            relative = safe_path(entry.filename)
            if str(relative).casefold() in seen:
                raise ValueError('压缩包包含重复路径')
            seen.add(str(relative).casefold())
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in (0, stat.S_IFDIR, stat.S_IFREG):
                raise ValueError('压缩包包含符号链接或特殊文件')
            target = dest / relative
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open('xb') as output:
                    output.write(archive.read(entry))
                target.chmod(0o700 if entry.external_attr >> 16 & 0o111 else 0o600)


def manifest(root):
    skill = root / 'SKILL.md'
    if not skill.is_file() or skill.is_symlink() or skill.stat().st_size > 1024 * 1024:
        raise ValueError('需要不超过 1 MiB 的 SKILL.md')
    text = skill.read_text(encoding='utf-8')
    match = re.match(r'^\ufeff?---\r?\n(.*?)\r?\n---\r?\n([\s\S]+)$', text, re.S)
    if not match or not match[2].strip():
        raise ValueError('SKILL.md 需要 YAML 元数据和正文')
    fields = {}
    for key in ('name', 'description'):
        matches = re.findall(r'^' + key + r':[^\S\n]*(.*)$', match[1], re.M)
        if len(matches) != 1 or not matches[0].strip():
            raise ValueError(f'需要唯一的非空 {key}')
        value = matches[0].strip()
        if value.startswith('"'):
            value = json.loads(value)
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1].replace("''", "'")
        elif re.fullmatch(r'[|>][-+]?', value):
            block = re.search(r'^' + key + r':[^\n]*\n((?:[ \t]+[^\n]*\n?)+)', match[1], re.M)
            value = ' '.join(block[1].split()) if block else ''
        else:
            value = re.split(r'\s+#', value, maxsplit=1)[0]
        if not isinstance(value, str) or not value.strip() or value.lower() in ('null', 'true', 'false', '~'):
            raise ValueError(f'{key} 必须为文本')
        fields[key] = value
    if not NAME.fullmatch(fields['name']) or len(fields['name']) > 64:
        raise ValueError('技能 name 必须为不超过 64 字符的小写英文、数字和连字符')
    return fields, text


def snapshot(root):
    files, total, digest = [], 0, hashlib.sha256()
    for current, dirs, names in os.walk(root, followlinks=False):
        for name in dirs + names:
            item = Path(current) / name
            if item.is_symlink() or not (item.is_file() or item.is_dir()):
                raise ValueError('技能包含符号链接或特殊文件')
        for name in names:
            item = Path(current) / name
            relative = item.relative_to(root).as_posix()
            safe_path(relative)
            if relative == META:
                continue  # Local receipt is regenerated, never trusted from the source.
            total += item.stat().st_size
            if total > MAX_BYTES or len(files) >= MAX_FILES:
                raise ValueError('技能文件超出限制')
            files.append(relative)
    for relative in sorted(files):
        item = root / relative
        digest.update(relative.encode() + b'\0')
        digest.update(b'x' if item.stat().st_mode & 0o111 else b'-')
        digest.update(hashlib.sha256(item.read_bytes()).digest())
    return {'files': sorted(files), 'bytes': total, 'digest': digest.hexdigest()}


def source(args, temp):
    if args.source:
        local = Path(args.source).expanduser().absolute()
        if local.is_symlink():
            raise ValueError('来源不能是符号链接')
        if local.is_dir():
            snapshot(local)
            return local, {'type': 'local', 'path': str(local)}
        if local.stat().st_size > MAX_BYTES:
            raise ValueError('压缩包超过 50 MiB')
        data, receipt = local.read_bytes(), {'type': 'local', 'path': str(local)}
    elif args.repo:
        if not re.fullmatch(r'[\w.-]+/[\w.-]+', args.repo):
            raise ValueError('--repo 格式为 owner/repo')
        if not args.path:
            raise ValueError('GitHub 来源需要明确 --path，仓库根目录用 .')
        safe_path(args.path)
        url = f'https://codeload.github.com/{args.repo}/zip/{urllib.parse.quote(args.ref, safe="")}'
        data, receipt = fetch(url), {'type': 'github', 'repo': args.repo, 'ref': args.ref, 'path': args.path}
    else:
        url = api(args.hub_url, '/api/v1/download', slug=args.slug, namespace=args.namespace, version=args.version)
        data, receipt = fetch(url), {'type': 'skillhub', 'hub': args.hub_url, 'slug': args.slug, 'namespace': args.namespace, 'version': args.version}
    archive_sha = hashlib.sha256(data).hexdigest()
    if args.sha256 and archive_sha != args.sha256.lower():
        raise ValueError('压缩包 SHA256 不匹配')
    receipt['archiveSha256'] = archive_sha
    unzip(data, temp)
    if args.repo:
        roots = list(temp.iterdir())
        if len(roots) != 1 or not roots[0].is_dir():
            raise ValueError('GitHub 压缩包结构异常')
        root = roots[0] / args.path
    else:
        candidates = list(temp.rglob('SKILL.md'))
        if len(candidates) != 1:
            raise ValueError('来源须包含唯一的 SKILL.md；多个技能请分别指定目录安装')
        root = candidates[0].parent
    return root, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    search = sub.add_parser('search'); search.add_argument('query'); search.add_argument('--page', type=int, default=1)
    search.add_argument('--hub-url', default=hub_url())
    listing = sub.add_parser('list'); listing.add_argument('--dest', default=str(home() / 'skills'))
    for name in ('inspect', 'install'):
        command = sub.add_parser(name)
        group = command.add_mutually_exclusive_group(required=True)
        group.add_argument('--source'); group.add_argument('--repo'); group.add_argument('--slug')
        command.add_argument('--path'); command.add_argument('--ref', default='HEAD')
        command.add_argument('--version'); command.add_argument('--namespace'); command.add_argument('--sha256')
        command.add_argument('--hub-url', default=hub_url())
        command.add_argument('--dest', default=str(home() / 'skills'))
        command.add_argument('--expected-digest')
    args = parser.parse_args()
    if args.command == 'search':
        return json.loads(fetch(api(args.hub_url, '/api/skills', keyword=args.query, page=max(1, args.page), pageSize=20)))
    if args.command == 'list':
        roots = [(Path(args.dest).expanduser(), False)]
        bundle = os.environ.get('MOSS_BUNDLED_SKILLS_DIR')
        if bundle:
            roots.append((Path(bundle), True))
        found, seen = [], set()
        for root, builtin in roots:
            if not root.exists():
                continue
            for item in sorted(root.iterdir()):
                if not item.is_dir() or not (item / 'SKILL.md').exists() or item.name in seen:
                    continue
                fields, _ = manifest(item)
                found.append({**fields, 'path': str(item), 'builtin': builtin, **snapshot(item)})
                seen.add(item.name)
        return {'skills': found}
    with tempfile.TemporaryDirectory(prefix='moss-skill-inspect-') as directory:
        root, origin = source(args, Path(directory))
        fields, content = manifest(root)
        state = snapshot(root)
        if args.expected_digest and args.expected_digest != state['digest']:
            raise ValueError('来源内容已改变，请重新查看后再安装')
        result = {**fields, **state, 'origin': origin}
        if args.command == 'inspect':
            return {**result, 'instructions': content}
        parent = Path(args.dest).expanduser().absolute()
        parent.mkdir(parents=True, exist_ok=True)
        target = parent / fields['name']
        target.mkdir()  # Exclusive; an existing installation is never overwritten.
        try:
            for relative in state['files']:
                output = target / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(root / relative, output)
            if snapshot(target)['digest'] != state['digest']:
                raise ValueError('来源在安装期间发生变化')
            (target / META).write_text(json.dumps({
                'name': fields['name'], 'description': fields['description'], 'enabled': True,
                'source_type': 'skillhub' if origin['type'] == 'skillhub' else 'upload',
                'installed_version': args.version or '', 'origin': origin, 'content_sha256': state['digest'],
                'slug': args.slug or '', 'namespace': {'handle': args.namespace} if args.namespace else None,
            }, ensure_ascii=False, indent=2) + '\n')
        except Exception:
            shutil.rmtree(target)
            raise
        return {**result, 'installed': True, 'path': str(target)}


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
