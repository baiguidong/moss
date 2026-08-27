export function softDeleteProjectRecord(project, now = Date.now()) {
  return {
    ...project,
    archivedAt: project.archivedAt || now,
    updatedAt: now,
  };
}
