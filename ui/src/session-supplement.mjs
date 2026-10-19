import fsp from 'node:fs/promises';
import { buildFileAttachmentPrompt } from './session-prompt-preparation.mjs';
import { buildSelectedSkillsInstruction, buildProjectCoordinatorSelectedSkillsInstruction } from './shared/project-runtime-resources.mjs';
import { buildExplicitAgentDispatchInstruction } from './desktop-agents.mjs';

/** Uses the same file-reference and skill instructions as foreground sends. */
export function createSupplementPreparation({ localizeFiles, resolveResource, isResourceUri, getAgentCatalog }) {
  return async (record, { prompt, details = {} }) => {
    const intent = record.isCoordinatorMode || record.projectId ? 'boss' : 'chat';
    // These operations change the execution environment. The sender schedules
    // them automatically once that environment can be rebuilt.
    if ((details.intent && details.intent !== intent) || details.appSelection || record.appToolsPending
      || /^[!/]/.test(prompt.trim())) return null;
    if (details.workspace && details.workspace !== record.workspace) throw new Error('工作区已变化，请重新选择附件。');
    const files = details.files ?? [];
    if (!Array.isArray(files) || files.length > 32) throw new Error('附件数量无效。');
    const paths = [];
    for (const file of files) {
      let filePath = file?.path;
      if (file?.resource) {
        if (file.resource.selection !== 'full-file' || !isResourceUri(file.resource.uri)) throw new Error('请选择 App 文档文件作为附件。');
        filePath = (await resolveResource(file.resource.uri)).path;
      }
      if (typeof filePath !== 'string' || !filePath || !(await fsp.stat(filePath)).isFile()) throw new Error('附件已失效，请重新选择。');
      paths.push(filePath);
    }
    const localized = paths.length ? await localizeFiles(record, paths) : [];
    let agentInstruction = '';
    if (details.agentType) {
      if (intent !== 'boss') throw new Error('只有 Boss 模式可以显式调度 Agent。');
      const catalog = await getAgentCatalog({ workspace: record.workspace });
      if (!catalog.agents.some(agent => agent.agentType === details.agentType && agent.active)) throw new Error('所选 Agent 已不可用，请重新选择。');
      agentInstruction = buildExplicitAgentDispatchInstruction(details.agentType);
    }
    return [record.projectId ? buildProjectCoordinatorSelectedSkillsInstruction(details.skills) : buildSelectedSkillsInstruction(details.skills),
      agentInstruction, prompt + buildFileAttachmentPrompt(localized)].filter(Boolean).join('\n\n');
  };
}
