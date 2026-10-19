import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { ApplicationError, commandMain, invokeCLI, privateDirectory } from './adapter-runtime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const cases = new Set(JSON.parse(readFileSync(new URL('../data/index.json', import.meta.url))).cases.map(item => item.id));
export async function runApplication(input, parameters, signal, invocation) {
  if (Object.keys(input).some(key => !['caseId', 'action', 'task', 'allowWrites', 'intent'].includes(key)) || !cases.has(input.caseId) || !['run', 'inspect'].includes(input.action) ||
      typeof input.task !== 'string' || !input.task.trim() || input.task.length > 8000 || input.task.includes('\0') || typeof input.allowWrites !== 'boolean' ||
      (input.allowWrites ? !input.intent || typeof input.intent !== 'object' || Array.isArray(input.intent) || JSON.stringify(input.intent).length > 8000 : input.intent !== null) ||
      (input.action === 'inspect' && input.allowWrites)) throw new Error('Supply a reviewed case/action/task and independent literal write grant with exact structured caller intent, or null for read-only.');
  const directory = await privateDirectory(root, invocation), workspace = join(directory, 'workspace');
  try {
    await invokeCLI([process.execPath, 'firedrill/case-driver.mjs', 'init', workspace, input.caseId], { cwd: root, signal });
    const argv = input.action === 'inspect' ? [process.execPath, 'firedrill/case-driver.mjs', 'inspect', workspace] : [process.execPath, 'src/agent.js', "--repo", workspace, '--task', input.task, '--output', join(directory, 'receipts')];
    if (input.action === 'run') {
      if (input.allowWrites) argv.push('--allow-writes', '--intent-json', JSON.stringify(input.intent));
      if (parameters.model) argv.push('--model', parameters.model);
    }
    return { executionKind: input.action === 'inspect' ? 'application_state_inspection' : 'native_claude_mcp_agent',
      application: await invokeCLI(argv, { cwd: root, signal }), localState: { directory, workspaceRoot: workspace } };
  } catch (error) { if (error instanceof ApplicationError) { error.evidence.runDirectory = directory; error.evidence.workspaceRoot = workspace; } throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await commandMain(runApplication);
