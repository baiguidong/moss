export function createUpdateInstallPreparation({ getBlockers, shutdown, timeout = 30_000 }) {
  let preparing = false;
  let pending;
  return {
    isPreparing: () => preparing,
    prepare() {
      if (pending) return pending;
      const blockers = getBlockers();
      if (blockers.length) return Promise.reject(new Error(`请先结束以下工作：${blockers.join('、')}`));
      // Keep new work blocked once teardown starts, even if a component fails to close.
      preparing = true;
      pending = Promise.resolve().then(async () => {
        let timer;
        try {
          await Promise.race([
            shutdown(),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('退出准备超时，尚未启动安装。请重试安装，或退出后重新打开 Moss。')), timeout); }),
          ]);
        } finally { clearTimeout(timer); pending = null; }
      });
      return pending;
    },
  };
}
