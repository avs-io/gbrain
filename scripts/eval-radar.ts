import { runWorkflowEval } from '../src/core/evals/workflow-suite.ts';
const report = runWorkflowEval({ classes: ['opportunity_radar'], workflowTypes: ['radar'] });
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
