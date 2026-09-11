import { describe, expect, it } from 'bun:test';
import { registerLibraryIpcHandlers } from '../src/library/library-ipc.mjs';

function setup(options: { canceled?: boolean; installPromise?: Promise<any> } = {}) {
  const handlers = new Map<string, (event: unknown, payload?: any) => Promise<any>>();
  const calls: Array<{ name: string; payload: any }> = [];
  const extensionCalls: any[][] = [];
  const guideCalls: string[] = [];
  const dialogCalls: any[] = [];
  const shownInFolder: string[] = [];
  const directoryPreparationCalls: any[] = [];
  let guideAcknowledged = false;
  const service = new Proxy({}, {
    get: (_target, name) => {
      if (name === 'listCollections') {
        return (payload?: any) => {
          calls.push({ name: String(name), payload });
          return [{
            id: 'collection-1', name: '个人资料', description: '',
            scope: { kind: 'personal' }, sourceCount: 0, resourceCount: 0,
          }];
        };
      }
      return async (payload?: any) => {
        calls.push({ name: String(name), payload });
        if (name === 'openResource') return { path: '/approved/resource.md' };
        if (name === 'getOverview') return { activeJobs: [] };
        if (name === 'repairIndex') return { id: 'repair-1' };
        return { ok: true };
      };
    },
  });
  registerLibraryIpcHandlers({
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, payload?: any) => Promise<any>) => {
        handlers.set(channel, handler);
      },
    },
    dialog: {
      showOpenDialog: async (_window: unknown, dialogOptions: any) => {
        dialogCalls.push(dialogOptions);
        return options.canceled
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: ['/picked/a.md', '/picked/b.md'] };
      },
      showSaveDialog: async () => ({ canceled: true }),
    },
    shell: {
      openPath: async () => '',
      showItemInFolder: (filePath: string) => shownInFolder.push(filePath),
    },
    getWindow: () => null,
    service,
    prepareDirectoryImport: (payload: any) => {
      directoryPreparationCalls.push(payload);
      return {
        workspace: payload.directoryPath,
        title: `资料库整理 · ${payload.directoryName}`,
        draftPrompt: '请整理当前目录中适合进入资料库的文档。',
      };
    },
    extensions: {
      getStatus: async () => ({ status: 'not-installed' }),
      install: async (...args: any[]) => {
        extensionCalls.push(args);
        return options.installPromise || { status: 'ready', packages: [] };
      },
    },
    getExtensionGuideAcknowledged: () => guideAcknowledged,
    acknowledgeExtensionGuide: () => {
      guideAcknowledged = true;
      guideCalls.push('acknowledged');
    },
  } as any);
  return { handlers, calls, extensionCalls, guideCalls, dialogCalls, shownInFolder, directoryPreparationCalls };
}

describe('Library IPC', () => {
  it('registers mutations without exposing an arbitrary-path add handler', () => {
    const { handlers } = setup();
    expect(handlers.has('library:pick-sources')).toBe(true);
    expect(handlers.has('library:select-directory')).toBe(true);
    expect(handlers.has('library:prepare-directory-import')).toBe(true);
    expect(handlers.has('library:create-directory-session')).toBe(false);
    expect(handlers.has('library:analyze-selected-directory')).toBe(false);
    expect(handlers.has('library:add-selected-directory')).toBe(false);
    expect(handlers.has('library:add-local-source')).toBe(false);
    expect(handlers.has('library:search')).toBe(true);
    expect(handlers.has('library:diagnose-search')).toBe(true);
    expect(handlers.has('library:get-evaluation-overview')).toBe(true);
    expect(handlers.has('library:save-evaluation-case')).toBe(true);
    expect(handlers.has('library:delete-evaluation-case')).toBe(true);
    expect(handlers.has('library:run-evaluation')).toBe(true);
    expect(handlers.has('library:repair-index')).toBe(true);
    expect(handlers.has('library:get-extension-status')).toBe(true);
    expect(handlers.has('library:acknowledge-extension-guide')).toBe(true);
    expect(handlers.has('library:install-extensions')).toBe(true);
  });

  it('adds only paths returned by the main-process picker', async () => {
    const { handlers, calls, dialogCalls } = setup();
    const result = await handlers.get('library:pick-sources')?.(null, {
      collectionId: 'collection-1',
      kind: 'files',
      path: '/renderer-controlled/secret',
    });
    expect(result).toHaveLength(2);
    expect(calls.filter((call) => call.name === 'addLocalSource').map((call) => call.payload.path))
      .toEqual(['/picked/a.md', '/picked/b.md']);
    expect(dialogCalls[0].filters[0].extensions).toContain('md');
    expect(dialogCalls[0].filters[0].extensions).not.toContain('png');
  });

  it('prepares a home-page draft without creating a session', async () => {
    const { handlers, directoryPreparationCalls, dialogCalls } = setup();
    const selection = await handlers.get('library:select-directory')?.(null, {});
    const prepared = await handlers.get('library:prepare-directory-import')?.(null, {
      selectionId: selection.selectionId,
      collectionId: 'collection-1',
      path: '/renderer-controlled/secret',
    });
    expect(prepared).toMatchObject({
      workspace: '/picked/a.md',
      title: '资料库整理 · a.md',
    });
    expect(prepared).not.toHaveProperty('sessionKind');
    expect(prepared.draftPrompt).toContain('请整理当前目录');
    expect(directoryPreparationCalls).toEqual([{
      directoryPath: '/picked/a.md',
      directoryName: 'a.md',
      collection: expect.objectContaining({ id: 'collection-1', name: '个人资料' }),
    }]);
    await expect(handlers.get('library:prepare-directory-import')?.(null, {
      selectionId: selection.selectionId,
      collectionId: 'collection-1',
    })).rejects.toThrow('目录选择已失效');
    expect(dialogCalls[0].properties).toEqual(['openDirectory', 'createDirectory']);
  });

  it('requires a live main-process selection before preparing the draft', async () => {
    const { handlers, directoryPreparationCalls } = setup();
    await expect(handlers.get('library:prepare-directory-import')?.(null, {
      collectionId: 'collection-1',
      selectionId: 'renderer-controlled-path',
    })).rejects.toThrow('目录选择已失效');
    expect(directoryPreparationCalls).toEqual([]);
  });

  it('requires an existing personal Collection', async () => {
    const { handlers, directoryPreparationCalls } = setup();
    const selection = await handlers.get('library:select-directory')?.(null, {});
    await expect(handlers.get('library:prepare-directory-import')?.(null, {
      collectionId: 'missing-collection',
      selectionId: selection.selectionId,
    })).rejects.toThrow('目标个人资料集不存在');
    expect(directoryPreparationCalls).toEqual([]);
  });

  it('opens a resource only after resolving its id through the service', async () => {
    const { handlers, calls } = setup();
    await handlers.get('library:open-resource')?.(null, {
      resourceId: 'resource-1',
      path: '/renderer-controlled/secret',
    });
    expect(calls.find((call) => call.name === 'openResource')?.payload)
      .toEqual({ resourceId: 'resource-1' });
  });

  it('shows a resource in its folder only after resolving its id', async () => {
    const { handlers, calls, shownInFolder } = setup();
    await handlers.get('library:show-resource-in-folder')?.(null, {
      resourceId: 'resource-1',
      path: '/renderer-controlled/secret',
    });
    expect(calls.find((call) => call.name === 'openResource')?.payload)
      .toEqual({ resourceId: 'resource-1' });
    expect(shownInFolder).toEqual(['/approved/resource.md']);
  });

  it('persists the first-run extension guide decision', async () => {
    const { handlers, guideCalls } = setup();
    expect(await handlers.get('library:get-extension-status')?.(null, {}))
      .toMatchObject({ guideAcknowledged: false });
    expect(await handlers.get('library:acknowledge-extension-guide')?.(null, {}))
      .toEqual({ acknowledged: true });
    expect(await handlers.get('library:get-extension-status')?.(null, {}))
      .toMatchObject({ guideAcknowledged: true });
    expect(guideCalls).toEqual(['acknowledged']);
  });

  it('starts selected extensions in the background and rebuilds only after installation', async () => {
    let finishInstallation: ((value: any) => void) | null = null;
    const installPromise = new Promise((resolve) => { finishInstallation = resolve; });
    const { handlers, calls, extensionCalls, guideCalls } = setup({ installPromise });
    const result = await handlers.get('library:install-extensions')?.(null, {
      packages: ['renderer-controlled-package'],
      packageIds: ['pypdf'],
    });
    expect(result).toMatchObject({ status: 'not-installed', background: true, guideAcknowledged: true });
    expect(calls.some((call) => call.name === 'repairIndex')).toBe(false);
    expect(extensionCalls).toEqual([[['pypdf']]]);
    expect(guideCalls).toEqual(['acknowledged']);

    finishInstallation?.({ status: 'ready', packages: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.some((call) => call.name === 'repairIndex')).toBe(true);
  });
});
