#!/usr/bin/env python3
"""Create and inspect Moss skills using only the Python standard library."""
import argparse
import json
import os
from pathlib import Path
import re
import sys

NAME = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')


def metadata(text):
    lines = text.lstrip('\ufeff').splitlines()
    if not lines or lines[0].strip() != '---':
        raise ValueError('SKILL.md 缺少 YAML frontmatter')
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == '---')
    except StopIteration:
        raise ValueError('YAML frontmatter 缺少结束分隔符')
    fields = {}
    for key in ('name', 'description'):
        matches = [(i, re.match(r'^' + key + r':\s*(.*)$', line)) for i, line in enumerate(lines[1:end], 1)]
        matches = [(i, m) for i, m in matches if m]
        if len(matches) != 1:
            raise ValueError(f'需要唯一的 {key} 字段')
        index, match = matches[0]
        value = match.group(1).strip()
        if re.fullmatch(r'[|>][-+]?', value):
            parts = []
            for line in lines[index + 1:end]:
                if line and not line[0].isspace():
                    break
                parts.append(line.strip())
            value = ' '.join(parts).strip()
        elif value.startswith('"'):
            value, _ = json.JSONDecoder().raw_decode(value)
        elif value.startswith("'"):
            found = re.fullmatch(r"'((?:[^']|'')*)'\s*(?:#.*)?", value)
            if not found:
                raise ValueError(f'{key} 的引号不完整')
            value = found[1].replace("''", "'")
        else:
            value = re.split(r'\s+#', value, maxsplit=1)[0].strip()
            if not value or value[0] in '[{&*!' or value.lower() in ('null', 'true', 'false', '~'):
                raise ValueError(f'{key} 必须是非空文本')
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f'{key} 必须是非空文本')
        fields[key] = value
    if not NAME.fullmatch(fields['name']) or len(fields['name']) > 64:
        raise ValueError('name 需为不超过 64 字符的小写英文、数字、连字符')
    if not '\n'.join(lines[end + 1:]).strip():
        raise ValueError('技能正文不能为空')
    return fields


def validate(root):
    root = Path(root).absolute()
    if root.is_symlink() or not root.is_dir():
        raise ValueError('技能必须是实际目录')
    file = root / 'SKILL.md'
    if file.is_symlink() or not file.is_file() or file.stat().st_size > 1024 * 1024:
        raise ValueError('需要有效的 SKILL.md，最大 1 MiB')
    text = file.read_text(encoding='utf-8')
    fields = metadata(text)
    if fields['name'] != root.name:
        raise ValueError('目录名必须与 name 一致')
    if re.search(r'\[TODO\s*:|\{\{(?:TODO|SKILL_NAME)\}\}', text, re.I):
        raise ValueError('存在未完成的脚手架占位符')
    for item in root.rglob('*'):
        if item.is_symlink() or not (item.is_file() or item.is_dir()):
            raise ValueError(f'不支持符号链接或特殊文件：{item.relative_to(root)}')
    for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
        link = link.strip().split(' "', 1)[0].strip('<>')
        if not link or link.startswith('#') or re.match(r'^[a-zA-Z][\w+.-]*:', link):
            continue
        target = (root / link.split('#', 1)[0]).resolve()
        if not target.is_relative_to(root.resolve()) or not target.exists():
            raise ValueError(f'资源链接不存在或超出技能目录：{link}')
    return {**fields, 'path': str(root), 'valid': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    check = commands.add_parser('validate'); check.add_argument('path')
    create = commands.add_parser('init'); create.add_argument('name'); create.add_argument('--description', required=True)
    create.add_argument('--instructions-file', required=True)
    create.add_argument('--dest', default=str(Path(os.environ.get('MOSS_HOME', Path.home() / '.moss')) / 'skills'))
    args = parser.parse_args()
    if args.command == 'validate':
        return validate(args.path)
    name = re.sub('[^a-z0-9]+', '-', args.name.lower()).strip('-')
    if not NAME.fullmatch(name) or len(name) > 64:
        raise ValueError('请提供有效的英文技能名称')
    body = Path(args.instructions_file).read_text(encoding='utf-8').strip()
    text = f'---\nname: {name}\ndescription: {json.dumps(args.description, ensure_ascii=False)}\n---\n\n{body}\n'
    metadata(text)
    parent = Path(args.dest).expanduser().absolute()
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / name
    target.mkdir()  # Existing skills are never overwritten.
    try:
        (target / 'SKILL.md').write_text(text, encoding='utf-8')
        return validate(target)
    except Exception:
        (target / 'SKILL.md').unlink(missing_ok=True)
        target.rmdir()
        raise


if __name__ == '__main__':
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except (OSError, ValueError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
