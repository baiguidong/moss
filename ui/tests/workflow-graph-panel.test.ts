import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  decorateWorkflowMermaid,
  normalizeWorkflowMermaid,
  selectLatestWorkflow,
  summarizeWorkflowProgress,
  WorkflowSessionStrip,
} from '../src/renderer-react/components/workflow-graph-panel'
import {
  buildWorkflowCanvasElements,
  getWorkflowLoopBackPath,
  WORKFLOW_NODE_TYPE_LABELS,
} from '../src/renderer-react/components/workflow-canvas'
import type {
  BackgroundTaskInfo,
  WorkflowCatalogDetail,
  WorkflowGraph,
  WorkflowNodeEvent,
} from '../src/renderer-react/types'

function workflowTask(
  id: string,
  status: BackgroundTaskInfo['status'],
  progress: BackgroundTaskInfo['progress'] = [],
): BackgroundTaskInfo {
  return {
    id,
    description: id,
    command: '',
    kind: 'workflow',
    status,
    isBackgrounded: true,
    startTime: 1,
    endTime: null,
    exitCode: null,
    progress,
  }
}

describe('workflow graph panel', () => {
  test('the top strip follows a live workflow before completed history', () => {
    const tasks = [
      workflowTask('old', 'completed'),
      workflowTask('live', 'running'),
      workflowTask('newer-history', 'completed'),
    ]

    expect(selectLatestWorkflow(tasks)?.id).toBe('live')
    expect(selectLatestWorkflow(tasks.filter((task) => task.status === 'completed'))?.id).toBe('newer-history')
  })

  test('merges a draft and its run into one compact workflow strip', () => {
    const task = {
      ...workflowTask('run-1', 'completed'),
      workflowId: 'wfd_aaaaaaaaaaaaaaaa',
      workflowName: 'df-quick-demo',
      agentCount: 2,
    }
    const draft = {
      record: {
        id: 'wfd_aaaaaaaaaaaaaaaa',
        title: 'df 快速检查演示',
        currentRevision: 1,
      },
    } as WorkflowCatalogDetail
    const markup = renderToStaticMarkup(React.createElement(WorkflowSessionStrip, {
      drafts: [draft],
      tasks: [task],
      onOpenDraft: () => {},
      onOpenTask: () => {},
    }))

    expect(markup.match(/Workflow ·/g)?.length).toBe(1)
    expect(markup).toContain('Workflow · df 快速检查演示')
    expect(markup).toContain('草稿 r1 · 待确认')
    expect(markup).toContain('已完成')
    expect(markup).not.toContain('Workflow 草稿 ·')
    expect(markup).not.toContain('df-quick-demo')
  })

  test('uses concise Chinese node type labels', () => {
    expect(WORKFLOW_NODE_TYPE_LABELS.start).toBe('输入')
    expect(WORKFLOW_NODE_TYPE_LABELS.condition).toBe('判断')
    expect(WORKFLOW_NODE_TYPE_LABELS.merge).toBe('汇合')
    expect(WORKFLOW_NODE_TYPE_LABELS.foreach).toBe('遍历')
  })

  test('summarizes the live phase and agent states for the workbench header', () => {
    const task = workflowTask('live', 'running', [
      { type: 'workflow_phase', index: 1, title: 'Analyze', kind: 'definition' },
      { type: 'workflow_agent', index: 1, nodeId: 'support', instanceId: 'support', label: 'support', state: 'done' },
      { type: 'workflow_agent', index: 2, nodeId: 'judge', instanceId: 'judge', label: 'judge', state: 'progress', phaseTitle: 'Decision' },
      { type: 'workflow_agent', index: 3, nodeId: 'review', instanceId: 'review', label: 'review', state: 'error' },
    ])

    expect(summarizeWorkflowProgress(task)).toEqual({
      total: 3,
      completed: 1,
      failed: 1,
      latestPhase: 'Analyze',
      activeLabels: ['judge'],
    })
  })

  test('summarizes code-only workflows from authoritative node executions', () => {
    const task = {
      ...workflowTask('code-only', 'completed'),
      graph: {
        version: 3,
        name: 'code-only',
        title: 'code-only',
        description: 'code-only',
        nodes: [
          { id: 'n1', type: 'start', label: '输入', workflowNodeId: 'start' },
          { id: 'n2', type: 'code', label: '计算', workflowNodeId: 'calculate' },
          { id: 'n3', type: 'end', label: '输出', workflowNodeId: 'end' },
        ],
        edges: [],
        warnings: [],
      } satisfies WorkflowGraph,
      nodeEvents: [
        { type: 'workflow_node', sequence: 1, nodeId: 'start', instanceId: 'start', state: 'completed', timestamp: 1 },
        { type: 'workflow_node', sequence: 2, nodeId: 'calculate', instanceId: 'calculate', state: 'completed', timestamp: 2 },
        { type: 'workflow_node', sequence: 3, nodeId: 'unused', instanceId: 'unused', state: 'skipped', timestamp: 3 },
        { type: 'workflow_node', sequence: 4, nodeId: 'end', instanceId: 'end', state: 'completed', timestamp: 4 },
      ] satisfies WorkflowNodeEvent[],
    }

    expect(summarizeWorkflowProgress(task)).toEqual({
      total: 3,
      completed: 3,
      failed: 0,
      latestPhase: null,
      activeLabels: [],
    })
  })

  test('escapes raw backticks before Mermaid renders a label', () => {
    const persisted = 'flowchart TD\n  n1["`prompt ${value}…"]'

    expect(normalizeWorkflowMermaid(persisted)).toBe(
      'flowchart TD\n  n1["&#96;prompt ${value}…"]',
    )
    expect(decorateWorkflowMermaid(persisted, null)).not.toContain('`')
  })

  test('decorates nodes and the selected condition edge from runtime events', () => {
    const graph: WorkflowGraph = {
      version: 3,
      name: 'demo',
      title: 'demo',
      description: 'demo',
      nodes: [
        { id: 'n1', type: 'condition', label: 'enabled?', workflowNodeId: 'condition-1' },
        { id: 'n2', type: 'agent', label: 'run', workflowNodeId: 'agent-1' },
        { id: 'n3', type: 'end', label: 'End', workflowNodeId: '$end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'true', label: 'true', branchKey: 'then' },
        { id: 'e2', source: 'n1', target: 'n3', type: 'false', label: 'false', branchKey: 'else' },
      ],
      warnings: [],
    }
    const trace: WorkflowNodeEvent[] = [
      { type: 'workflow_node', sequence: 1, nodeId: 'condition-1', instanceId: 'condition-1', state: 'completed', timestamp: 1, branch: 'then' },
      { type: 'workflow_node', sequence: 2, nodeId: 'agent-1', instanceId: 'agent-1', state: 'running', timestamp: 2 },
    ]
    const decorated = decorateWorkflowMermaid(
      'flowchart TD\n  n1{"enabled?"}\n  n2["run"]\n  n3(["End"])\n  n1 -->|"true"| n2\n  n1 -->|"false"| n3',
      graph,
      trace,
    )

    expect(decorated).toContain('class n1 wfCompleted')
    expect(decorated).toContain('class n2 wfRunning')
    expect(decorated).toContain('class n3 wfUnvisited')
    expect(decorated).toContain('linkStyle 0 stroke:#f59e0b,stroke-width:3px,stroke-dasharray:8 6')
    expect(decorated).toContain('linkStyle 1 stroke:#a1a1aa')

    const canvas = buildWorkflowCanvasElements(graph, trace, []);
    const condition = canvas.nodes.find((node) => node.id === 'n1');
    expect(condition?.data.nodeType).toBe('condition');
    expect(condition?.data.nodeTypeLabel).toBe('判断');
    expect(condition?.data.branchCount).toBe(2);
  })

  test('highlights the active and completed paths of a loop', () => {
    const graph: WorkflowGraph = {
      version: 3,
      name: 'loop',
      title: 'loop',
      description: 'loop',
      nodes: [
        { id: 'n1', type: 'agent', label: '处理当前项', workflowNodeId: 'loop-1' },
        { id: 'n2', type: 'agent', label: 'work', workflowNodeId: 'agent-1' },
        { id: 'n3', type: 'end', label: 'End', workflowNodeId: '$end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'true', label: 'iterate', branchKey: 'iterate' },
        { id: 'e2', source: 'n1', target: 'n3', type: 'false', label: 'done', branchKey: 'done' },
      ],
      warnings: [],
    };
    const base = 'flowchart TD\n  n1{{"for…of: items"}}\n  n2["work"]\n  n3(["End"])\n  n1 -->|"iterate"| n2\n  n1 -->|"done"| n3';

    const running = decorateWorkflowMermaid(base, graph, [
      { type: 'workflow_node', sequence: 1, nodeId: 'loop-1', instanceId: 'loop-1', state: 'running', timestamp: 1, branch: 'iterate', iteration: 1 },
    ]);
    expect(running).toContain('linkStyle 0 stroke:#f59e0b,stroke-width:3px,stroke-dasharray:8 6');

    const completed = decorateWorkflowMermaid(base, graph, [
      { type: 'workflow_node', sequence: 2, nodeId: 'loop-1', instanceId: 'loop-1', state: 'completed', timestamp: 2, branch: 'done', iteration: 3 },
    ]);
    expect(completed).toContain('linkStyle 1 stroke:#22c55e');
  })

  test('routes a loop-back outside the forward edge and keeps a traversed loop visible', () => {
    const graph: WorkflowGraph = {
      version: 3,
      name: 'review-loop',
      title: 'review-loop',
      description: 'review-loop',
      nodes: [
        { id: 'n1', type: 'agent', label: '生成并自检草稿', workflowNodeId: 'draft' },
        { id: 'n2', type: 'condition', label: '是否需要改进', workflowNodeId: 'check' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'next', workflowEdgeId: 'draft:default->check' },
        { id: 'e2', source: 'n2', target: 'n1', type: 'loop-back', label: '改进后复查', branchKey: 'yes', workflowEdgeId: 'check:yes->draft' },
      ],
      warnings: [],
    }
    const nodes: WorkflowNodeEvent[] = [
      { type: 'workflow_node', sequence: 1, nodeId: 'draft', instanceId: 'draft', state: 'completed', timestamp: 1 },
      { type: 'workflow_node', sequence: 2, nodeId: 'draft', instanceId: 'draft[2]', state: 'completed', timestamp: 2, iteration: 2 },
      { type: 'workflow_node', sequence: 3, nodeId: 'check', instanceId: 'check[2]', state: 'completed', timestamp: 3, branch: 'no', iteration: 2 },
    ]
    const elements = buildWorkflowCanvasElements(graph, nodes, [{
      type: 'workflow_edge', sequence: 4, edgeId: 'check:yes->draft', source: 'check', target: 'draft', instanceId: 'check[2]', state: 'skipped', timestamp: 4,
    }])
    const loop = elements.edges.find(edge => edge.id === 'e2')

    expect(loop?.type).toBe('workflow-loop-back')
    expect(loop?.style?.stroke).toBe('#22c55e')
    expect(loop?.style?.strokeDasharray).toBe('7 5')

    const route = getWorkflowLoopBackPath({ sourceX: 100, sourceY: 220, targetX: 100, targetY: 20 })
    expect(route.labelX).toBeLessThan(-50)
    expect(route.path).toContain(`L ${route.labelX}`)
    expect(route.path).not.toBe('M 100 220 L 100 20')
  })

  test('matches a localized switch edge through its runtime branch key', () => {
    const graph: WorkflowGraph = {
      version: 3,
      name: 'switch',
      title: 'switch',
      description: 'switch',
      nodes: [
        { id: 'n1', type: 'condition', label: '根据风险等级选择分支', workflowNodeId: 'switch-1' },
        { id: 'n2', type: 'end', label: '完成', workflowNodeId: '$end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'case', label: '严重风险', branchKey: 'case:0' },
      ],
      warnings: [],
    }

    const decorated = decorateWorkflowMermaid(
      'flowchart TD\n  n1{"根据风险等级选择分支"}\n  n2(["完成"])\n  n1 -->|"严重风险"| n2',
      graph,
      [{ type: 'workflow_node', sequence: 1, nodeId: 'switch-1', instanceId: 'switch-1', state: 'completed', timestamp: 1, branch: 'case:0' }],
    )

    expect(decorated).toContain('linkStyle 0 stroke:#22c55e')
  })

  test('renders interrupted nodes as stopped instead of still running', () => {
    const graph: WorkflowGraph = {
      version: 3,
      name: 'stop',
      title: 'stop',
      description: 'stop',
      nodes: [{ id: 'n1', type: 'agent', label: 'work', workflowNodeId: 'agent-1' }],
      edges: [],
      warnings: [],
    }
    const decorated = decorateWorkflowMermaid('flowchart TD\n  n1["work"]', graph, [
      { type: 'workflow_node', sequence: 1, nodeId: 'agent-1', instanceId: 'agent-1', state: 'running', timestamp: 1 },
      { type: 'workflow_node', sequence: 2, nodeId: 'agent-1', instanceId: 'agent-1', state: 'interrupted', timestamp: 2 },
    ])

    expect(decorated).toContain('class n1 wfStopped')
    expect(decorated).toContain('work · 已中断')
    expect(decorated).not.toContain('class n1 wfRunning')
  })

  test('renders blocked nodes distinctly and preserves repeated execution count', () => {
    const graph: WorkflowGraph = {
      version: 3,
      name: 'blocked',
      title: 'blocked',
      description: 'blocked',
      nodes: [{ id: 'n1', type: 'agent', label: 'Review 代码', workflowNodeId: 'review' }],
      edges: [],
      warnings: [],
    }
    const decorated = decorateWorkflowMermaid('flowchart TD\n  n1["Review 代码"]', graph, [
      { type: 'workflow_node', sequence: 1, nodeId: 'review', instanceId: 'review', state: 'completed', timestamp: 1 },
      { type: 'workflow_node', sequence: 2, nodeId: 'review', instanceId: 'review[2]', state: 'blocked', timestamp: 2, iteration: 2 },
    ])

    expect(decorated).toContain('class n1 wfBlocked')
    expect(decorated).toContain('Review 代码 · 已执行 2 次')
  })

  test('distinguishes a skipped branch from a node that was never visited', () => {
    const graph: WorkflowGraph = {
      version: 3,
      name: 'skip',
      title: 'skip',
      description: 'skip',
      nodes: [
        { id: 'n1', type: 'agent', label: 'skipped', workflowNodeId: 'skipped-agent' },
        { id: 'n2', type: 'agent', label: 'unvisited', workflowNodeId: 'unvisited-agent' },
      ],
      edges: [],
      warnings: [],
    }
    const decorated = decorateWorkflowMermaid(
      'flowchart TD\n  n1["skipped"]\n  n2["unvisited"]',
      graph,
      [{ type: 'workflow_node', sequence: 1, nodeId: 'skipped-agent', instanceId: 'skipped-agent', state: 'skipped', timestamp: 1 }],
    )

    expect(decorated).toContain('class n1 wfSkipped')
    expect(decorated).toContain('class n2 wfUnvisited')
  })
})
