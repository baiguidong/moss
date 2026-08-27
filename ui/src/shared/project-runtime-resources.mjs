function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function mergeProjectConnectorIds(projectConnectorIds, sessionConnectorIds) {
  return normalizeStringList([
    ...normalizeStringList(projectConnectorIds),
    ...normalizeStringList(sessionConnectorIds),
  ]);
}

export function getSessionConnectorOverrides(projectConnectorIds, requestedConnectorIds) {
  const projectIds = new Set(normalizeStringList(projectConnectorIds));
  return normalizeStringList(requestedConnectorIds).filter((id) => !projectIds.has(id));
}

export function resolveProjectSessionResourceScope(project) {
  return {
    connectorIds: normalizeStringList(project?.connectorIds),
    skillIds: normalizeStringList(project?.skillIds),
    expertIds: normalizeStringList(project?.expertIds),
  };
}

export function scopeProjectResourceManifestForWorker(manifest, assignment) {
  if (!manifest || typeof manifest !== 'object') return null;
  const connectorIds = new Set(normalizeStringList(assignment?.connectorIds));
  const skillIds = new Set(normalizeStringList(assignment?.skillIds));
  const expertIds = new Set(normalizeStringList(
    typeof assignment?.expertId === 'string' ? [assignment.expertId] : [],
  ));
  return {
    ...manifest,
    connectors: Array.isArray(manifest.connectors)
      ? manifest.connectors.filter((item) => connectorIds.has(item?.id))
      : [],
    skills: Array.isArray(manifest.skills)
      ? manifest.skills.filter((item) => skillIds.has(item?.id))
      : [],
    unavailableSkillIds: normalizeStringList(manifest.unavailableSkillIds)
      .filter((id) => skillIds.has(id)),
    experts: Array.isArray(manifest.experts)
      ? manifest.experts.filter((item) => expertIds.has(item?.id))
      : [],
    unavailableExpertIds: normalizeStringList(manifest.unavailableExpertIds)
      .filter((id) => expertIds.has(id)),
  };
}

export function normalizeSelectedSkills(skills) {
  if (!Array.isArray(skills)) return [];
  const seen = new Set();
  const result = [];
  for (const skill of skills) {
    const name = typeof skill?.name === 'string' ? skill.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({
      name,
      displayName: typeof skill?.displayName === 'string' && skill.displayName.trim()
        ? skill.displayName.trim()
        : name,
    });
  }
  return result;
}

export function buildSelectedSkillsInstruction(skills) {
  const selectedSkills = normalizeSelectedSkills(skills);
  if (selectedSkills.length === 0) return '';
  return [
    '[User-selected skills]',
    'The user explicitly selected the following skills for this turn.',
    'Before doing the requested work, invoke each listed skill by its command name with the Skill tool and follow its instructions.',
    ...selectedSkills.map((skill) => (
      skill.displayName === skill.name
        ? `- ${skill.name}`
        : `- ${skill.name} (${skill.displayName})`
    )),
  ].join('\n');
}

export function buildProjectCoordinatorSelectedSkillsInstruction(skills) {
  const selectedSkills = normalizeSelectedSkills(skills);
  if (selectedSkills.length === 0) return '';
  return [
    '[User-selected project skills]',
    'The user explicitly selected the following skills for this project turn.',
    'The project coordinator cannot invoke Skill directly. Assign each listed skill ID to the relevant worker; assigned skill instructions are preloaded into that worker before it starts.',
    ...selectedSkills.map((skill) => (
      skill.displayName === skill.name
        ? `- ${skill.name}`
        : `- ${skill.name} (${skill.displayName})`
    )),
  ].join('\n');
}
