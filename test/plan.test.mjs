import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan } from '../scripts/lib/plan.mjs';

const PLAN = `# Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)

---

### Task 1: Stripe client

**Files:**
- Create: \`src/stripe.ts\`
- Modify: \`src/app.ts:12-30\`
- Test: \`test/stripe.test.ts\`

- [x] **Step 1: Write the failing test**

\`\`\`bash
# this is a comment, not a heading
- [ ] not a real checkbox
\`\`\`

- [ ] **Step 2: Implement**

### Task 2: Webhooks

**Files:**
- Create: \`src/webhook.ts\`

- [ ] **Step 1: Write the failing test**

## Notes

- [ ] checkbox outside any task
`;

test('parses tasks, files and workflow', () => {
  const p = parsePlan(PLAN);
  assert.equal(p.workflow, 'subagent-driven');
  assert.equal(p.tasks.length, 2);
  assert.deepEqual(p.tasks[0], { id: 1, title: 'Stripe client', files: ['src/stripe.ts', 'src/app.ts', 'test/stripe.test.ts'], steps: 2, done: 1 });
  assert.deepEqual(p.tasks[1], { id: 2, title: 'Webhooks', files: ['src/webhook.ts'], steps: 1, done: 0 });
});

test('counts only task checkboxes outside code fences', () => {
  const p = parsePlan(PLAN);
  assert.equal(p.totalSteps, 3);
  assert.equal(p.checkedSteps, 1);
  assert.equal(p.allChecked, false);
});

test('allChecked when every task checkbox is ticked', () => {
  const p = parsePlan(PLAN.replace(/- \[ \] \*\*Step/g, '- [x] **Step'));
  assert.equal(p.allChecked, true);
});

test('plan without the superpowers header is inline', () => {
  assert.equal(parsePlan('### Task 1: A\n\n- [ ] do it\n').workflow, 'inline');
});

test('CRLF line endings work', () => {
  const p = parsePlan(PLAN.replace(/\n/g, '\r\n'));
  assert.equal(p.tasks.length, 2);
  assert.equal(p.tasks[0].files.length, 3);
});
