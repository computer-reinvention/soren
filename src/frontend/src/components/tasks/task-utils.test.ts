import { describe, it, expect } from 'vitest';
import {
  flattenTasks,
  countByStatus,
  collectAssignees,
  matchesSearch,
  filterTasks,
  sortTasks,
  toggleInSet,
} from './task-utils';
import type { Task } from '@/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'default-id',
    title: 'Default title',
    description: '',
    project: '',
    assigned_to: '',
    status: 'pending',
    priority: 'medium',
    source: 'user',
    linked_workers: '',
    parent_id: '',
    resources: [],
    created_at: '',
    updated_at: '',
    completed_at: '',
    remarks: '',
    ...overrides,
  };
}

describe('flattenTasks', () => {
  it('returns a flat list including nested children, parent before its children', () => {
    const tree = [
      makeTask({
        id: 'a',
        children: [makeTask({ id: 'a1' }), makeTask({ id: 'a2', children: [makeTask({ id: 'a2a' })] })],
      }),
      makeTask({ id: 'b' }),
    ];
    expect(flattenTasks(tree).map((t) => t.id)).toEqual(['a', 'a1', 'a2', 'a2a', 'b']);
  });

  it('returns an empty array for an empty tree', () => {
    expect(flattenTasks([])).toEqual([]);
  });
});

describe('countByStatus', () => {
  it('counts across nested children, not just top-level tasks', () => {
    const tree = [
      makeTask({ id: 'a', status: 'done', children: [makeTask({ id: 'a1', status: 'done' })] }),
      makeTask({ id: 'b', status: 'blocked' }),
    ];
    expect(countByStatus(tree)).toEqual({ done: 2, blocked: 1 });
  });
});

describe('collectAssignees', () => {
  it('deduplicates and sorts assignees, ignoring unassigned tasks', () => {
    const tree = [
      makeTask({ id: 'a', assigned_to: 'worker-b' }),
      makeTask({ id: 'b', assigned_to: '' }),
      makeTask({ id: 'c', assigned_to: 'worker-a', children: [makeTask({ id: 'c1', assigned_to: 'worker-b' })] }),
    ];
    expect(collectAssignees(tree)).toEqual(['worker-a', 'worker-b']);
  });
});

describe('matchesSearch', () => {
  it('matches an empty query against anything', () => {
    expect(matchesSearch(makeTask(), '')).toBe(true);
  });

  it('matches case-insensitively against title, description, assignee, and project', () => {
    const task = makeTask({ title: 'Fix the Worktree bug', assigned_to: 'dash-frontend', project: 'soren' });
    expect(matchesSearch(task, 'worktree')).toBe(true);
    expect(matchesSearch(task, 'DASH-FRONTEND')).toBe(true);
    expect(matchesSearch(task, 'soren')).toBe(true);
    expect(matchesSearch(task, 'nonexistent')).toBe(false);
  });
});

describe('filterTasks', () => {
  const tree = [
    makeTask({ id: 'a', status: 'done', priority: 'high', assigned_to: 'w1', title: 'Alpha' }),
    makeTask({
      id: 'b',
      status: 'pending',
      priority: 'low',
      assigned_to: 'w2',
      title: 'Beta parent',
      children: [makeTask({ id: 'b1', status: 'done', priority: 'high', assigned_to: 'w1', title: 'Beta child matches' })],
    }),
  ];

  it('returns everything when no filters are active', () => {
    const result = filterTasks(tree, new Set(), new Set(), new Set(), '');
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('keeps a parent whose child matches, even if the parent itself does not', () => {
    const result = filterTasks(tree, new Set(), new Set(), new Set(), 'child matches');
    expect(result.map((t) => t.id)).toEqual(['b']);
    expect(result[0].children?.map((c) => c.id)).toEqual(['b1']);
  });

  it('drops a parent whose children were all filtered out and who does not match itself', () => {
    const result = filterTasks(tree, new Set(['done']), new Set(), new Set(), '');
    // 'a' matches directly (done); 'b' doesn't match but its child 'b1' does.
    expect(result.map((t) => t.id)).toEqual(['a', 'b']);
    expect(result.find((t) => t.id === 'b')?.children?.map((c) => c.id)).toEqual(['b1']);
  });

  it('filters by assignee', () => {
    const result = filterTasks(tree, new Set(), new Set(), new Set(['w2']), '');
    expect(result.map((t) => t.id)).toEqual(['b']);
  });
});

describe('sortTasks', () => {
  it('sorts by priority descending (critical/high first)', () => {
    const tasks = [makeTask({ id: 'low', priority: 'low' }), makeTask({ id: 'crit', priority: 'critical' })];
    expect(sortTasks(tasks, 'priority-desc').map((t) => t.id)).toEqual(['crit', 'low']);
  });

  it('sorts by priority ascending', () => {
    const tasks = [makeTask({ id: 'crit', priority: 'critical' }), makeTask({ id: 'low', priority: 'low' })];
    expect(sortTasks(tasks, 'priority-asc').map((t) => t.id)).toEqual(['low', 'crit']);
  });

  it('sorts nested children recursively too', () => {
    const tasks = [
      makeTask({
        id: 'parent',
        children: [makeTask({ id: 'low', priority: 'low' }), makeTask({ id: 'crit', priority: 'critical' })],
      }),
    ];
    const sorted = sortTasks(tasks, 'priority-desc');
    expect(sorted[0].children?.map((c) => c.id)).toEqual(['crit', 'low']);
  });
});

describe('toggleInSet', () => {
  it('adds a value not already present', () => {
    const result = toggleInSet(new Set(['a']), 'b');
    expect([...result].sort()).toEqual(['a', 'b']);
  });

  it('removes a value already present', () => {
    const result = toggleInSet(new Set(['a', 'b']), 'a');
    expect([...result]).toEqual(['b']);
  });

  it('does not mutate the original set', () => {
    const original = new Set(['a']);
    toggleInSet(original, 'b');
    expect(original.has('b')).toBe(false);
  });
});
