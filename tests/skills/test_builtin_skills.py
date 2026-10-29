import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
CREATOR = ROOT / 'skills/skill-creator/scripts/skill.py'
INSTALLER = ROOT / 'skills/skill-installer/scripts/install.py'
spec = importlib.util.spec_from_file_location('installer', INSTALLER)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class Skills(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.body = self.root / 'body.md'
        self.body.write_text('# 周报\n读取用户给定资料，生成事实和待办。\n')

    def run_script(self, script, *args, ok=True):
        result = subprocess.run(['python3', str(script), *map(str, args)], capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, ok, result.stdout + result.stderr)
        return json.loads(result.stdout if ok else result.stderr)

    def create(self):
        return self.run_script(CREATOR, 'init', 'weekly-report', '--description', '生成周报',
                               '--instructions-file', self.body, '--dest', self.root / 'source')

    def archive(self, entries):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as output:
            for name, content in entries:
                output.writestr(name, content)
        return data.getvalue()

    def test_create_inspect_install_receipt_and_no_overwrite(self):
        source = Path(self.create()['path'])
        (source / 'scripts').mkdir()
        (source / 'scripts/work.py').write_text('raise Exception("must never execute")')
        info = self.run_script(INSTALLER, 'inspect', '--source', source)
        result = self.run_script(INSTALLER, 'install', '--source', source, '--expected-digest', info['digest'], '--dest', self.root / 'installed')
        target = Path(result['path'])
        self.assertEqual((target / 'scripts/work.py').read_text(), (source / 'scripts/work.py').read_text())
        self.assertEqual(json.loads((target / '_moss_meta.json').read_text())['content_sha256'], info['digest'])
        self.run_script(INSTALLER, 'install', '--source', source, '--dest', self.root / 'installed', ok=False)
        self.assertEqual((target / 'SKILL.md').read_bytes(), (source / 'SKILL.md').read_bytes())
        self.run_script(CREATOR, 'init', 'weekly-report', '--description', 'overwrite', '--instructions-file', self.body, '--dest', source.parent, ok=False)

    def test_changed_source_and_failed_creation_do_not_install(self):
        source = Path(self.create()['path'])
        info = self.run_script(INSTALLER, 'inspect', '--source', source)
        (source / 'extra.txt').write_text('changed')
        self.run_script(INSTALLER, 'install', '--source', source, '--expected-digest', info['digest'], '--dest', self.root / 'installed', ok=False)
        self.assertFalse((self.root / 'installed/weekly-report').exists())
        self.body.write_text('[missing](references/missing.md)')
        self.run_script(CREATOR, 'init', 'invalid', '--description', 'Test', '--instructions-file', self.body, '--dest', self.root, ok=False)
        self.assertFalse((self.root / 'invalid').exists())

    def test_wrapped_zip_and_multiple_skills(self):
        source = Path(self.create()['path'])
        file = self.root / 'skill.zip'
        file.write_bytes(self.archive([('release/skill/SKILL.md', (source / 'SKILL.md').read_bytes()), ('release/skill/data.txt', 'hello')]))
        info = self.run_script(INSTALLER, 'install', '--source', file, '--dest', self.root / 'installed')
        self.assertEqual((Path(info['path']) / 'data.txt').read_text(), 'hello')
        file.write_bytes(self.archive([('a/SKILL.md', 'a'), ('b/SKILL.md', 'b')]))
        self.run_script(INSTALLER, 'inspect', '--source', file, ok=False)

    def test_unsafe_zip_entries(self):
        for name in ('../out', '/tmp/out', 'a/../../out', 'a\\b', 'C:/out'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                installer.unzip(self.archive([(name, 'bad')]), self.root / 'extracted')
        link = zipfile.ZipInfo('link'); link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            installer.unzip(self.archive([(link, '/tmp')]), self.root / 'extracted')
        with self.assertRaises(ValueError):
            installer.unzip(self.archive([('FILE', 'a'), ('file', 'b')]), self.root / 'collision')

    def test_local_links_are_rejected(self):
        source = Path(self.create()['path'])
        (source / 'outside').symlink_to(self.body)
        self.run_script(INSTALLER, 'inspect', '--source', source, ok=False)
        self.run_script(CREATOR, 'validate', source, ok=False)

    def test_hub_and_github_transport(self):
        source = Path(self.create()['path'])
        raw = (source / 'SKILL.md').read_bytes()
        from types import SimpleNamespace
        common = dict(source=None, repo=None, slug=None, namespace='owner', version='1.0.0', sha256=None, hub_url='https://hub.example', path=None, ref='v1')
        for kind in ('github', 'hub'):
            args = SimpleNamespace(**common)
            args.repo, args.path = ('owner/repo', 'skills/weekly-report') if kind == 'github' else (None, None)
            args.slug = 'weekly-report' if kind == 'hub' else None
            prefix = 'repo-v1/skills/weekly-report' if kind == 'github' else 'weekly-report'
            with tempfile.TemporaryDirectory() as directory, patch.object(installer, 'fetch', return_value=self.archive([(prefix + '/SKILL.md', raw)])) as fetch:
                root, receipt = installer.source(args, Path(directory))
                self.assertEqual(installer.manifest(root)[0]['name'], 'weekly-report')
                self.assertIn('archiveSha256', receipt)
                self.assertIn('codeload.github.com/owner/repo/zip/v1' if kind == 'github' else '/api/v1/download?slug=weekly-report&namespace=owner&version=1.0.0', fetch.call_args.args[0])
        args.sha256 = '0' * 64
        with patch.object(installer, 'fetch', return_value=b'archive'), self.assertRaises(ValueError):
            installer.source(args, self.root)

    def test_builtin_resources_validate(self):
        for name in ('skill-creator', 'skill-installer', 'imagegen'):
            result = self.run_script(CREATOR, 'validate', ROOT / 'skills' / name)
            self.assertEqual(result['name'], name)


if __name__ == '__main__':
    unittest.main()
