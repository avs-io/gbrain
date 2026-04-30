import { runWorkflowEval } from '../src/core/evals/workflow-suite.ts';
const report = runWorkflowEval({ workflowTypes: ['recall', 'project_pack'] });
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
