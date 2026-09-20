import type { WorkflowDefinitionV3 } from '../definition.js'

const OBJECT = { type: 'object' }
const ANGLE_SCHEMA = {
  type: 'object',
  required: ['angles'],
  properties: {
    angles: { type: 'array', items: { type: 'object', required: ['angle', 'query'], properties: { angle: { type: 'string' }, query: { type: 'string' } } } },
  },
}
const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: { type: 'array', items: { type: 'object', required: ['claim', 'url'], properties: { claim: { type: 'string' }, url: { type: 'string' }, quote: { type: 'string' } } } },
  },
}

export const DEEP_RESEARCH_DEFINITION: WorkflowDefinitionV3 = {
  version: 3,
  kind: 'state-machine',
  meta: {
    name: 'deep-research',
    title: '深度研究',
    description: '从多个角度搜索、核对资料并生成带引用的报告',
  },
  defaults: { concurrency: 4 },
  limits: { maxAgentCalls: 24, maxNodeExecutions: 100, maxConcurrency: 4 },
  graph: {
    entry: 'input',
    nodes: [
      {
        id: 'input', type: 'start', title: '输入研究问题',
        outputSchema: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'object', required: ['question'], properties: { question: { type: 'string', minLength: 1 } } }] },
      },
      {
        id: 'prepare-question', type: 'code', title: '读取研究问题', language: 'javascript',
        input: [{ target: ['value'], source: { kind: 'workflow-input' } }],
        script: "const question = typeof input.value === 'string' ? input.value : input.value.question\nif (!question) throw new Error('deep-research needs a question')\nreturn { question }",
        outputSchema: { type: 'object', required: ['question'], properties: { question: { type: 'string' } } },
      },
      {
        id: 'plan-angles', type: 'agent', title: '规划搜索角度',
        prompt: '把研究问题拆成最多 4 个互补且可独立检索的研究角度，不要只是换一种说法。',
        input: [{ target: [], source: { kind: 'node-output', nodeId: 'prepare-question' } }],
        outputSchema: ANGLE_SCHEMA,
      },
      {
        id: 'research-angles', type: 'foreach', title: '并行研究各角度',
        items: { kind: 'node-output', nodeId: 'plan-angles', path: ['angles'] },
        concurrency: 4, outputSchema: { type: 'array' },
        output: [{ target: [], source: { kind: 'node-output', nodeId: 'research-angle' } }],
        body: {
          entry: 'research-angle',
          nodes: [{
            id: 'research-angle', type: 'agent', title: '搜索并核对资料',
            prompt: '针对当前研究角度搜索并阅读可靠资料，优先使用一手来源。提取可验证论据和 URL；无法验证时不要猜测。',
            input: [
              { target: ['question'], source: { kind: 'node-output', nodeId: 'prepare-question', path: ['question'] } },
              { target: ['angle'], source: { kind: 'iteration-item' } },
            ],
            outputSchema: FINDINGS_SCHEMA,
          }],
          edges: [{ source: 'research-angle', target: '$complete' }],
        },
      },
      {
        id: 'prepare-report', type: 'code', title: '整理研究材料', language: 'javascript',
        input: [{ target: ['batches'], source: { kind: 'node-output', nodeId: 'research-angles' } }],
        script: "const seen = new Set(), findings = []\nfor (const batch of input.batches) for (const item of (batch && batch.findings) || []) { const key = String(item.claim || '').toLowerCase().replace(/\\s+/g, ' ').trim(); if (key && !seen.has(key)) { seen.add(key); findings.push(item) } }\nreturn { findings }",
        outputSchema: FINDINGS_SCHEMA,
      },
      {
        id: 'has-findings', type: 'condition', title: '是否找到可靠资料？',
        branches: [{ port: 'yes', label: '是', when: { left: { kind: 'node-output', nodeId: 'prepare-report', path: ['findings'] }, operator: 'is-not-empty' } }],
        default: { port: 'no', label: '否' },
      },
      {
        id: 'write-report', type: 'agent', title: '生成研究报告',
        prompt: '使用给定研究材料回答问题。每个事实后附来源 URL，并明确区分已验证事实与不确定内容。',
        input: [
          { target: ['question'], source: { kind: 'node-output', nodeId: 'prepare-question', path: ['question'] } },
          { target: ['research'], source: { kind: 'node-output', nodeId: 'prepare-report' } },
        ],
        outputSchema: { type: 'object', required: ['report'], properties: { report: { type: 'string' } } },
      },
      {
        id: 'empty-report', type: 'code', title: '说明未找到资料', language: 'javascript',
        input: [{ target: ['question'], source: { kind: 'node-output', nodeId: 'prepare-question', path: ['question'] } }],
        script: "return { report: null, question: input.question, note: 'no reliable findings found' }",
        outputSchema: OBJECT,
      },
      {
        id: 'result', type: 'merge', title: '汇总研究结果', mode: 'first-available',
        sources: [{ kind: 'node-output', nodeId: 'write-report' }, { kind: 'node-output', nodeId: 'empty-report' }],
        outputSchema: OBJECT,
      },
      {
        id: 'output', type: 'end', title: '输出研究报告', inputSchema: OBJECT,
        input: [{ target: [], source: { kind: 'node-output', nodeId: 'result' } }],
      },
    ],
    edges: [
      { source: 'input', target: 'prepare-question' },
      { source: 'prepare-question', target: 'plan-angles' },
      { source: 'plan-angles', target: 'research-angles' },
      { source: 'research-angles', target: 'prepare-report' },
      { source: 'prepare-report', target: 'has-findings' },
      { source: 'has-findings', sourcePort: 'yes', target: 'write-report' },
      { source: 'has-findings', sourcePort: 'no', target: 'empty-report' },
      { source: 'write-report', target: 'result' },
      { source: 'empty-report', target: 'result' },
      { source: 'result', target: 'output' },
    ],
  },
}
