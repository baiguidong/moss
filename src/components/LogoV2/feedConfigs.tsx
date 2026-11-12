import figures from 'figures';
import { homedir } from 'os';
import type { Step } from '../../projectOnboardingState.js';
import type { LogOption } from '../../types/logs.js';
import { getCwd } from '../../utils/cwd.js';
import { formatRelativeTimeAgo } from '../../utils/format.js';
import type { FeedConfig, FeedLine } from './Feed.js';
export function createRecentActivityFeed(activities: LogOption[]): FeedConfig {
  const lines: FeedLine[] = activities.map(log => {
    const time = formatRelativeTimeAgo(log.modified);
    const description = log.summary && log.summary !== 'No prompt' ? log.summary : log.firstPrompt;
    return {
      text: description || '',
      timestamp: time
    };
  });
  return {
    title: '最近活动',
    lines,
    footer: lines.length > 0 ? '使用 /resume 查看更多' : undefined,
    emptyMessage: '暂无最近活动'
  };
}
export function createProjectOnboardingFeed(steps: Step[]): FeedConfig {
  const enabledSteps = steps.filter(({
    isEnabled
  }) => isEnabled).sort((a, b) => Number(a.isComplete) - Number(b.isComplete));
  const lines: FeedLine[] = enabledSteps.map(({
    text,
    isComplete
  }) => {
    const checkmark = isComplete ? `${figures.tick} ` : '';
    return {
      text: `${checkmark}${text}`
    };
  });
  const warningText = getCwd() === homedir() ? '注意：Moss 当前在主目录中启动。为获得更好体验，请在项目目录中启动。' : undefined;
  if (warningText) {
    lines.push({
      text: warningText
    });
  }
  return {
    title: '入门提示',
    lines
  };
}
