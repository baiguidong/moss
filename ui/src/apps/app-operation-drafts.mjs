// Runtime supplies the calling identity; an App cannot choose another App or confirm a draft.
export function createAppOperationDraftHandlers(service) {
  const ownerKey = owner => JSON.stringify(Object.fromEntries(Object.entries(owner || {}).sort(([a], [b]) => a.localeCompare(b))));
  const owns = (draft, context) => draft.appId === context.appId && draft.instanceId === context.instanceId && ownerKey(draft.owner) === ownerKey(context.owner);
  const assertCurrent = context => { context.assertCurrent?.(); context.signal?.throwIfAborted(); };
  return {
    async 'draft.create'(input, context) {
      assertCurrent(context);
      return service.create({ ...input, appId: context.appId, instanceId: context.instanceId, owner: context.owner });
    },
    async 'draft.list'(_input, context) {
      assertCurrent(context);
      return { drafts: (await service.list()).filter(draft => owns(draft, context)) };
    },
    async 'draft.get'(input, context) {
      assertCurrent(context);
      const draft = await service.get(input);
      return draft && owns(draft, context) ? draft : null;
    },
  };
}
