import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function testParams() {
  return {
    version: 1,
    base: {
      mechanical: { S: 3, M: 6, L: 12 },
      integration: { S: 5, M: 10, L: 20 },
      judgment: { S: 8, M: 16, L: 30 },
    },
    workflowFactor: { inline: 1.0, 'subagent-driven': 1.8 },
    depMinutes: 3,
    phaseAgent: { brainstorm: 5, spec: 5, plan: 10 },
    phaseActive: { brainstormPerQuestion: 2, spec: 5, plan: 5 },
    brainstormQuestions: 5,
    manualTestActive: { S: 5, M: 10, L: 15 },
    replyDelay: 4,
    spread: { mechanical: 1.3, integration: 1.8, judgment: 2.5 },
    externalSpread: 1.5,
    lowFactor: 0.85,
    mergeOverhead: 3,
    breakMinutes: 30,
    minConfirmed: 3,
    learningRate: 0.3,
    clamp: [0.5, 2.0],
    expiryDays: 14,
  };
}

export function near(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not ≈ ${expected}`);
}

export const tmp = () => mkdtempSync(join(tmpdir(), 'agent-eta-'));
