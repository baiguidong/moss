import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rename, rm } from 'fs/promises'
import path from 'path'

export const DRAFTS_DIR_NAME = '.drafts'

const FILE_INTENT_MARKERS = {
  final: ['@final', '@output', '@deliverable', '@result'],
  draft: ['@draft', '@intermediate', '@temp', '@scratch'],
}

const DRAFT_FILE_PATTERNS = {
  prefixes: [
    'temp_',
    'temp-',
    'tmp_',
    'tmp-',
    'temporary_',
    'temporary-',
    'draft_',
    'draft-',
    'wip_',
    'wip-',
    'scratch_',
    'scratch-',
    'proto_',
    'proto-',
    'poc_',
    'poc-',
    'step_',
    'step-',
    'step1',
    'step2',
    'step3',
    'step4',
    'step5',
    'phase_',
    'phase-',
    'phase1',
    'phase2',
    'phase3',
  ],
  suffixes: [
    '_draft',
    '-draft',
    '_wip',
    '-wip',
    '_temp',
    '-temp',
    '_tmp',
    '-tmp',
    '_backup',
    '-backup',
    '_bak',
    '-bak',
    '_old',
    '-old',
  ],
}

const FINAL_FILE_PATTERNS = {
  suffixes: [
    '_final',
    '-final',
    '_result',
    '-result',
    '_output',
    '-output',
    '_completed',
    '-completed',
    '_done',
    '-done',
  ],
}

const DRAFT_EXTENSIONS = ['.tmp', '.temp', '.bak', '.backup', '.log', '.cache']

const FINAL_EXTENSIONS = [
  '.md',
  '.txt',
  '.pdf',
  '.docx',
  '.pptx',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.xlsx',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.rb',
  '.php',
  '.lua',
  '.toml',
  '.ini',
  '.conf',
  '.cfg',
  '.html',
  '.css',
  '.scss',
  '.png',
  '.jpg',
  '.svg',
]

const COMMENT_SYNTAX_MAP: Record<string, string> = {
  '.py': '#',
  '.pyw': '#',
  '.sh': '#',
  '.bash': '#',
  '.zsh': '#',
  '.rb': '#',
  '.pl': '#',
  '.pm': '#',
  '.lua': '#',
  '.r': '#',
  '.rscript': '#',
  '.js': '//',
  '.jsx': '//',
  '.ts': '//',
  '.tsx': '//',
  '.mjs': '//',
  '.cjs': '//',
  '.es6': '//',
  '.c': '//',
  '.cpp': '//',
  '.cc': '//',
  '.cxx': '//',
  '.h': '//',
  '.hpp': '//',
  '.java': '//',
  '.cs': '//',
  '.go': '//',
  '.rs': '//',
  '.swift': '//',
  '.kt': '//',
  '.kts': '//',
  '.yaml': '#',
  '.yml': '#',
  '.toml': '#',
  '.ini': '#',
  '.conf': '#',
  '.cfg': '#',
  '.json': '#',
  '.html': '<!--',
  '.htm': '<!--',
  '.xml': '<!--',
  '.svg': '<!--',
  '.md': '<!--',
  '.markdown': '<!--',
  default: '#',
}

const EXCLUDED_NAMES = new Set([
  DRAFTS_DIR_NAME,
  '.git',
  '.gitignore',
  '.env',
  '.env.local',
  'README.md',
  'readme.md',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
])

type FileIntentResult = {
  intent: 'final' | 'draft' | 'unknown'
  reason: string
  marker?: string
  line?: number
}

function log(message: string): void {
  process.stderr.write(`[draftsCleanup] ${message}\n`)
}

function matchesDraftPattern(fileName: string): boolean {
  const lower = fileName.toLowerCase()

  for (const prefix of DRAFT_FILE_PATTERNS.prefixes) {
    if (lower.startsWith(prefix)) return true
  }

  const ext = path.extname(lower)
  const baseName = lower.slice(0, lower.length - ext.length)
  for (const suffix of DRAFT_FILE_PATTERNS.suffixes) {
    if (baseName.endsWith(suffix)) return true
  }

  return DRAFT_EXTENSIONS.includes(ext)
}

function matchesFinalPattern(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  const ext = path.extname(lower)
  const baseName = lower.slice(0, lower.length - ext.length)

  for (const suffix of FINAL_FILE_PATTERNS.suffixes) {
    if (baseName.endsWith(suffix)) return true
  }

  return FINAL_EXTENSIONS.includes(ext)
}

export function detectFileIntent(filePath: string, content: string): FileIntentResult {
  const ext = path.extname(filePath).toLowerCase()
  const commentPrefix = COMMENT_SYNTAX_MAP[ext] || COMMENT_SYNTAX_MAP.default
  const lines = content.split('\n').slice(0, 10)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    let commentContent: string | null = null

    if (commentPrefix === '<!--') {
      if (line.startsWith('<!--') && line.endsWith('-->')) {
        commentContent = line.slice(4, -3).trim()
      }
    } else if (line.startsWith(commentPrefix)) {
      commentContent = line.slice(commentPrefix.length).trim()
    }

    if (!commentContent) continue

    for (const marker of FILE_INTENT_MARKERS.final) {
      if (commentContent.includes(marker)) {
        return {
          intent: 'final',
          reason: `Detected ${marker} marker at line ${index + 1}`,
          marker,
          line: index + 1,
        }
      }
    }

    for (const marker of FILE_INTENT_MARKERS.draft) {
      if (commentContent.includes(marker)) {
        return {
          intent: 'draft',
          reason: `Detected ${marker} marker at line ${index + 1}`,
          marker,
          line: index + 1,
        }
      }
    }
  }

  return { intent: 'unknown', reason: 'No marker found' }
}

export async function ensureDraftsDirectory(workspace: string): Promise<string> {
  const draftsDir = path.join(workspace, DRAFTS_DIR_NAME)
  await mkdir(draftsDir, { recursive: true })
  return draftsDir
}

export async function cleanupIntermediateFiles(workspace: string): Promise<void> {
  try {
    if (!existsSync(workspace)) return

    const draftsDir = await ensureDraftsDirectory(workspace)
    const entries = await readdir(workspace, { withFileTypes: true })
    const filesToMove: Array<{ name: string; reason: string }> = []
    let hasDraftScripts = false

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (EXCLUDED_NAMES.has(entry.name)) continue

      const filePath = path.join(workspace, entry.name)
      let content: string | null = null
      try {
        content = await readFile(filePath, 'utf8')
      } catch {
        // Binary files fall through to name-based detection.
      }

      if (content) {
        const intentResult = detectFileIntent(filePath, content)
        if (intentResult.intent === 'draft') {
          filesToMove.push({
            name: entry.name,
            reason: `Detected ${intentResult.marker ?? '@draft'} marker`,
          })
          hasDraftScripts = true
          continue
        }
        if (intentResult.intent === 'final') {
          continue
        }
      }

      if (matchesFinalPattern(entry.name)) {
        continue
      }

      if (matchesDraftPattern(entry.name)) {
        filesToMove.push({
          name: entry.name,
          reason: 'Matches draft file pattern',
        })
        hasDraftScripts = true
      }
    }

    for (const { name, reason } of filesToMove) {
      const srcPath = path.join(workspace, name)
      let destPath = path.join(draftsDir, name)

      if (existsSync(destPath)) {
        const ext = path.extname(name)
        const base = path.basename(name, ext)
        destPath = path.join(draftsDir, `${base}_${Date.now()}${ext}`)
      }

      try {
        await rename(srcPath, destPath)
        log(`Moved ${name} to ${DRAFTS_DIR_NAME}/ (${reason})`)
      } catch (error) {
        log(`Failed to move ${name} to drafts: ${String(error)}`)
      }
    }

    if (!hasDraftScripts) return

    for (const fileName of ['package.json', 'package-lock.json', 'bun.lockb']) {
      const filePath = path.join(workspace, fileName)
      if (!existsSync(filePath)) continue

      let destPath = path.join(draftsDir, fileName)
      if (existsSync(destPath)) {
        const ext = path.extname(fileName)
        const base = path.basename(fileName, ext)
        destPath = path.join(draftsDir, `${base}_${Date.now()}${ext}`)
      }

      try {
        await rename(filePath, destPath)
        log(`Moved script side effect ${fileName} to ${DRAFTS_DIR_NAME}/`)
      } catch (error) {
        log(`Failed to move script side effect ${fileName}: ${String(error)}`)
      }
    }

    const nodeModulesPath = path.join(workspace, 'node_modules')
    if (existsSync(nodeModulesPath)) {
      await rm(nodeModulesPath, { recursive: true, force: true })
      log('Deleted script side effect directory node_modules')
    }
  } catch (error) {
    log(`Cleanup failed: ${String(error)}`)
  }
}

export function buildDraftsInstruction(workspace: string): string {
  const draftsPath = `${workspace}/${DRAFTS_DIR_NAME}`

  return `[CRITICAL: File Intent Marking System - MANDATORY]

Your workspace is: ${workspace}
A drafts directory exists at: ${draftsPath}

When creating files, add an intent marker as the FIRST LINE:
- Final deliverables use @final, for example "# @final" or "// @final".
- Intermediate files use @draft, for example "# @draft" or "// @draft".

Decision rule:
- If the file is the user-requested final output, mark it @final and keep it in the workspace root.
- If the file only helps produce the final output, mark it @draft. Examples: helper scripts, temporary data, conversion scripts, scratch files.
- If a script creates the final output, the script is @draft and the output is @final.

Post-processing behavior:
- Files with @draft marker are automatically moved to ${draftsPath}/.
- Files with @final marker stay in ${workspace}/.
- Files without markers stay in ${workspace}/ as the safe default.

Use language-appropriate comments:
- Python/Shell/Ruby/Perl: "# @final" or "# @draft"
- JavaScript/TypeScript/Go/C++/Java/Rust: "// @final" or "// @draft"
- HTML/XML/Markdown/SVG: "<!-- @final -->" or "<!-- @draft -->"

When script execution creates dependency side effects such as package.json, package-lock.json, bun.lockb, or node_modules, those are treated as intermediate artifacts when draft scripts are present.

[End of File Intent Marking System Rules]`
}
