import { runWorkflowEval } from '../src/core/evals/workflow-suite.ts';
const report = runWorkflowEval({ classes: ['world_intelligence', 'topic_state'], workflowTypes: ['scout', 'topic_brief'] });
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
