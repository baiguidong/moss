import creator from '../../../skills/skill-creator/SKILL.md' with { type: 'text' }
import creatorScript from '../../../skills/skill-creator/scripts/skill.py' with { type: 'text' }
import installer from '../../../skills/skill-installer/SKILL.md' with { type: 'text' }
import installerScript from '../../../skills/skill-installer/scripts/install.py' with { type: 'text' }
import imagegen from '../../../skills/imagegen/SKILL.md' with { type: 'text' }
import prompting from '../../../skills/imagegen/references/prompting.md' with { type: 'text' }
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { registerBundledSkill } from '../bundledSkills.js'

// The desktop exposes the same source files through its builtin skill catalog.
// CLI/server builds without that directory carry the resources in the bundle.
export function registerCreationSkills(): void {
  if (process.env.MOSS_BUNDLED_SKILLS_DIR) return
  for (const [markdown, files] of [
    [creator, { 'scripts/skill.py': creatorScript }],
    [installer, { 'scripts/install.py': installerScript }],
    [imagegen, { 'references/prompting.md': prompting }],
  ] as [string, Record<string, string>][]) {
    const { frontmatter, content } = parseFrontmatter(markdown)
    registerBundledSkill({
      name: String(frontmatter.name),
      description: String(frontmatter.description),
      files: { 'SKILL.md': markdown, ...files },
      async getPromptForCommand(args) {
        return [{ type: 'text', text: content + (args ? `\n\n用户请求：\n${args}` : '') }]
      },
    })
  }
}
