import { describe, expect, test } from 'bun:test';
import { filterAndSortProjectTasks } from '../src/shared/project-task-list.mjs';

const tasks = [
  { id: 'old-complete', subject: '整理报告', description: '审查代码', status: 'completed', createdAt: 10, updatedAt: 12 },
  { id: 'mid-waiting', subject: '发送会议通知', description: '使用邮箱发送', status: 'waiting_for_user', createdAt: 20, updatedAt: 40 },
  { id: 'new-running', subject: '上传网盘资料', description: '生成分享链接', status: 'working', createdAt: 30, updatedAt: 31 },
];

describe('project task list', () => {
  test('sorts root coordinator tasks newest first by default', () => {
    expect(filterAndSortProjectTasks(tasks).map((task) => task.id)).toEqual([
      'new-running',
      'mid-waiting',
      'old-complete',
    ]);
  });

  test('filters by status and searches task content', () => {
    expect(filterAndSortProjectTasks(tasks, { status: 'working' }).map((task) => task.id)).toEqual(['new-running']);
    expect(filterAndSortProjectTasks(tasks, { query: '邮箱' }).map((task) => task.id)).toEqual(['mid-waiting']);
  });

  test('supports oldest, recently updated, and status sorting', () => {
    expect(filterAndSortProjectTasks(tasks, { sort: 'oldest' }).map((task) => task.id)).toEqual([
      'old-complete',
      'mid-waiting',
      'new-running',
    ]);
    expect(filterAndSortProjectTasks(tasks, { sort: 'updated' }).map((task) => task.id)[0]).toBe('mid-waiting');
    expect(filterAndSortProjectTasks(tasks, { sort: 'status' }).map((task) => task.id)[0]).toBe('mid-waiting');
  });
});
