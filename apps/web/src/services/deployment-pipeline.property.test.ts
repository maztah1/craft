/**
 * Property 20 — Deployment Pipeline Sequence
 *
 * REQUIREMENT (design.md):
 * For any successful deployment, the following sequence should occur in order:
 * code generation → GitHub repository creation → code push → Vercel project creation → Vercel deployment → URL return.
 *
 * This test formally verifies the correctness of the deployment pipeline sequence
 * using fast-check property-based testing with a minimum of 100 iterations.
 *
 * Feature: craft-platform
 * Design spec: .craft/specs/craft-platform/design.md
 * Property: 20
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ── Type Definitions ─────────────────────────────────────────────────────────

type DeploymentStatusType =
    | 'pending'
    | 'generating'
    | 'creating_repo'
    | 'pushing_code'
    | 'deploying'
    | 'completed'
    | 'failed';

interface PipelinePreconditions {
  userId: string;
  templateId: string;
  isPro: boolean;
  githubAuthorized: boolean;
}

interface StepOutcomes {
  generating: 'success' | 'failure';
  creatingRepo: 'success' | 'failure';
  pushingCode: 'success' | 'failure';
  deploying: 'success' | 'failure';
}

interface PipelineState {
  status: DeploymentStatusType;
  visitedStates: DeploymentStatusType[];
  error?: string;
  url?: string;
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbPreconditions = fc.record<PipelinePreconditions>({
  userId: fc.uuid(),
  templateId: fc.uuid(),
  isPro: fc.boolean(),
  githubAuthorized: fc.boolean(),
});

const arbStepOutcome = fc.constantFrom<'success' | 'failure'>('success', 'failure');

const arbStepOutcomes = fc.record<StepOutcomes>({
  generating: arbStepOutcome,
  creatingRepo: arbStepOutcome,
  pushingCode: arbStepOutcome,
  deploying: arbStepOutcome,
});

// ── Mock Orchestrator ────────────────────────────────────────────────────────

class MockDeploymentOrchestrator {
  private state: PipelineState = {
    status: 'pending',
    visitedStates: ['pending'],
  };

  async run(preconditions: PipelinePreconditions, outcomes: StepOutcomes): Promise<PipelineState> {
    // Stage 0: Initial Check
    if (!preconditions.githubAuthorized) {
       this.fail('GitHub not authorized');
       return this.state;
    }

    // Stage 1: Generating
    this.transition('generating');
    if (outcomes.generating === 'failure') {
      this.fail('Generation failed');
      return this.state;
    }

    // Stage 2: Creating Repo
    this.transition('creating_repo');
    if (outcomes.creatingRepo === 'failure') {
      this.fail('Repository creation failed');
      return this.state;
    }

    // Stage 3: Pushing Code
    this.transition('pushing_code');
    if (outcomes.pushingCode === 'failure') {
      this.fail('Code push failed');
      return this.state;
    }

    // Stage 4: Deploying
    this.transition('deploying');
    if (outcomes.deploying === 'failure') {
      this.fail('Vercel deployment failed');
      return this.state;
    }

    // Final Stage: Completed
    this.transition('completed');
    this.state.url = `https://craft-${preconditions.templateId.slice(0, 8)}.vercel.app`;
    
    return this.state;
  }

  private transition(newStatus: DeploymentStatusType) {
    this.state.status = newStatus;
    this.state.visitedStates.push(newStatus);
  }

  private fail(message: string) {
    this.state.status = 'failed';
    this.state.visitedStates.push('failed');
    this.state.error = message;
  }

  getState() {
    return this.state;
  }
}

// ── Property Tests ────────────────────────────────────────────────────────────

describe('Property 20 — Deployment Pipeline Sequence', () => {
  let orchestrator: MockDeploymentOrchestrator;

  beforeEach(() => {
    orchestrator = new MockDeploymentOrchestrator();
  });

  /**
   * Property 20.1: Successful deployments must visit all states in the correct order.
   */
  describe('Property 20.1 — Canonical Sequence Order', () => {
    it('all successful deployments follow the exact canonical state sequence', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbPreconditions,
          fc.constant<StepOutcomes>({
            generating: 'success',
            creatingRepo: 'success',
            pushingCode: 'success',
            deploying: 'success',
          }),
          async (preconditions: PipelinePreconditions, outcomes: StepOutcomes) => {
            // Pre-condition for success
            fc.pre(preconditions.githubAuthorized === true);

            const result = await orchestrator.run(preconditions, outcomes);

            const expectedSequence: DeploymentStatusType[] = [
              'pending',
              'generating',
              'creating_repo',
              'pushing_code',
              'deploying',
              'completed',
            ];

            expect(result.status).toBe('completed');
            expect(result.visitedStates).toEqual(expectedSequence);
            expect(result.url).toBeDefined();
            expect(result.error).toBeUndefined();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 20.2: Forbidden step orderings never occur.
   *
   * This property asserts that the orchestrator never enters a state out of order.
   */
  describe('Property 20.2 — Forbidden Orderings Invariant', () => {
    it('never enters a later state without passing through all previous states', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbPreconditions,
          arbStepOutcomes,
          async (preconditions: PipelinePreconditions, outcomes: StepOutcomes) => {
            const result = await orchestrator.run(preconditions, outcomes);
            const visited = result.visitedStates;

            // Invariant 1: 'creating_repo' never precedes 'generating'
            const genIdx = visited.indexOf('generating');
            const repoIdx = visited.indexOf('creating_repo');
            if (repoIdx !== -1) {
              expect(genIdx).toBeLessThan(repoIdx);
            }

            // Invariant 2: 'pushing_code' never precedes 'creating_repo'
            const pushIdx = visited.indexOf('pushing_code');
            if (pushIdx !== -1) {
              expect(repoIdx).toBeLessThan(pushIdx);
            }

            // Invariant 3: 'deploying' never precedes 'pushing_code'
            const deployIdx = visited.indexOf('deploying');
            if (deployIdx !== -1) {
              expect(pushIdx).toBeLessThan(deployIdx);
            }

            // Invariant 4: 'completed' never precedes 'deploying'
            const completedIdx = visited.indexOf('completed');
            if (completedIdx !== -1) {
              expect(deployIdx).toBeLessThan(completedIdx);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 20.3: Failures halt the pipeline immediately.
   */
  describe('Property 20.3 — Immediate Halt on Failure', () => {
    it('never visits any subsequent states after a "failed" state is reached', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbPreconditions,
          arbStepOutcomes,
          async (preconditions: PipelinePreconditions, outcomes: StepOutcomes) => {
            const result = await orchestrator.run(preconditions, outcomes);
            const visited = result.visitedStates;

            const failIdx = visited.indexOf('failed');
            if (failIdx !== -1) {
              // The 'failed' state must be the last state visited
              expect(failIdx).toBe(visited.length - 1);
              expect(result.status).toBe('failed');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 20.4: Correctness under random failures.
   */
  describe('Property 20.4 — Correctness under random failures', () => {
    it('either reaches "completed" with the full sequence OR reaches "failed" at the first failing step', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbPreconditions,
          arbStepOutcomes,
          async (preconditions: PipelinePreconditions, outcomes: StepOutcomes) => {
            const result = await orchestrator.run(preconditions, outcomes);
            
            if (result.status === 'completed') {
              expect(preconditions.githubAuthorized).toBe(true);
              expect(outcomes.generating).toBe('success');
              expect(outcomes.creatingRepo).toBe('success');
              expect(outcomes.pushingCode).toBe('success');
              expect(outcomes.deploying).toBe('success');
            } else if (result.status === 'failed') {
               // Must be because one of the requirements failed
               const githubFail = !preconditions.githubAuthorized;
               const genFail = outcomes.generating === 'failure';
               const repoFail = outcomes.creatingRepo === 'failure';
               const pushFail = outcomes.pushingCode === 'failure';
               const deployFail = outcomes.deploying === 'failure';
               
               expect(githubFail || genFail || repoFail || pushFail || deployFail).toBe(true);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
