import { runWorkflowEval } from '../src/core/evals/workflow-suite.ts';
const report = runWorkflowEval({ workflowTypes: ['project_pack', 'meeting_brief', 'opportunity_eval', 'agent_handoff'] });
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
