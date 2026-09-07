/**
 * Workflow-shape assertion (ci-pipeline: "GATE-2 Is A Named, Independently
 * Identifiable Gate" / "GATE-2 Precedes Editor UI Delivery"). Parses the
 * real `.github/workflows/ci.yml` and confirms GATE-2 (WU-7's markdown
 * round-trip suite, `packages/editor/src/round-trip.test.ts`) runs as its
 * own named step in the `verify` job — distinct from the generic `test`
 * step's pass/fail signal — and runs before the build step, so a change
 * wiring Milkdown into a screen while GATE-2 is red fails the run at the
 * GATE-2 step rather than surfacing later as an undifferentiated build or
 * test failure.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
}

interface WorkflowJob {
  steps: WorkflowStep[];
}

interface WorkflowFile {
  jobs: Record<string, WorkflowJob>;
}

const WORKFLOW_PATH = join(import.meta.dir, '..', '..', '..', '.github', 'workflows', 'ci.yml');
const GATE_2_STEP_NAME = 'gate-2-round-trip';
const GATE_2_SUITE_PATH = 'packages/editor/src/round-trip.test.ts';

function loadWorkflow(): WorkflowFile {
  return parse(readFileSync(WORKFLOW_PATH, 'utf8')) as WorkflowFile;
}

function requireVerifyJob(workflow: WorkflowFile): WorkflowJob {
  const verifyJob = workflow.jobs.verify;
  if (!verifyJob) throw new Error('ci.yml has no "verify" job');
  return verifyJob;
}

describe('CI workflow: GATE-2 is a named, independently identifiable gate', () => {
  test('the verify job runs a step named gate-2-round-trip, distinct from the generic test step', () => {
    const workflow = loadWorkflow();
    const verifyJob = requireVerifyJob(workflow);

    const gate2Step = verifyJob.steps.find((step) => step.name === GATE_2_STEP_NAME);
    expect(gate2Step).toBeDefined();
    expect(gate2Step?.run).toContain(GATE_2_SUITE_PATH);

    const genericTestStep = verifyJob.steps.find((step) => step.name === 'test');
    expect(genericTestStep).toBeDefined();
    expect(genericTestStep?.run).not.toBe(gate2Step?.run);
  });

  test('the gate-2-round-trip step runs before the build step, so a red GATE-2 blocks editor UI delivery', () => {
    const workflow = loadWorkflow();
    const verifyJob = requireVerifyJob(workflow);

    const gate2Index = verifyJob.steps.findIndex((step) => step.name === GATE_2_STEP_NAME);
    const buildIndex = verifyJob.steps.findIndex((step) => (step.name ?? '').startsWith('build'));

    expect(gate2Index).toBeGreaterThanOrEqual(0);
    expect(buildIndex).toBeGreaterThan(gate2Index);
  });
});
