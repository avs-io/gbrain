import { runWorkflowEval } from '../src/core/evals/workflow-suite.ts';
const report = runWorkflowEval({ privacyOnly: true });
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
