type WorkspaceScope = { sessionId: string; workspace: string };

/** Merge only current directory responses; slow snapshots must not erase files. */
export function createWorkspaceDirectoryLoader<T>({
  getScope,
  readDirectory,
  applyDirectory,
}: {
  getScope: () => WorkspaceScope | null;
  readDirectory: (payload: { sessionId: string; dirPath: string }) => Promise<T>;
  applyDirectory: (dirPath: string, data: T) => void;
}) {
  let generation = 0;
  const requests = new Map<string, object>();
  return {
    reset() {
      generation++;
      requests.clear();
    },
    async load(scope: WorkspaceScope, dirPath: string) {
      const request = {};
      const startedGeneration = generation;
      requests.set(dirPath, request);
      const isCurrent = () => {
        const current = getScope();
        return startedGeneration === generation && requests.get(dirPath) === request
          && current?.sessionId === scope.sessionId && current.workspace === scope.workspace;
      };
      try {
        const data = await readDirectory({ sessionId: scope.sessionId, dirPath });
        if (isCurrent()) applyDirectory(dirPath, data);
      } catch (error) {
        if (isCurrent()) throw error;
      }
    },
  };
}
