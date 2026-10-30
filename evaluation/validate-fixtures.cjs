'use strict';
// Deterministically validates that each benchmark fixture is well-formed and intentionally starts red.
// It executes only repository-owned fixture source files in a subprocess, never imported user code.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname);
const fixtures = fs.readdirSync(path.join(ROOT, 'fixtures'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
if (!fixtures.length) throw new Error('No evaluation fixtures were found.');
const results = [];
for (const id of fixtures) {
  const dir = path.join(ROOT, 'fixtures', id);
  const packagePath = path.join(dir, 'package.json');
  const contractPath = path.join(dir, 'test', 'contract.test.cjs');
  if (!fs.existsSync(packagePath) || !fs.existsSync(contractPath)) throw new Error(`${id}: missing package.json or immutable contract test.`);
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  if (pkg.scripts?.test !== 'node --test') throw new Error(`${id}: contract runner must be node --test.`);
  const src = path.join(dir, 'src');
  if (!fs.existsSync(src) || !fs.readdirSync(src).some(name => fs.statSync(path.join(src, name)).isFile())) throw new Error(`${id}: expected source files are missing.`);
  const output = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/contract.test.cjs'], { cwd: dir, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  const text = `${output.stdout || ''}\n${output.stderr || ''}`;
  if (output.error) throw new Error(`${id}: fixture process failed to start: ${output.error.message}`);
  if (output.status !== 1 || !/not ok \d/.test(text) || !/# fail [1-9]\d*/.test(text) || /Cannot find module|SyntaxError:|ERR_MODULE_NOT_FOUND/.test(text)) throw new Error(`${id}: expected real assertion failures before repair; got exit ${output.status}.\n${text.slice(-2000)}`);
  results.push({ id, sourceFiles: fs.readdirSync(src).filter(name => fs.statSync(path.join(src, name)).isFile()).length, immutableContract: 'test/contract.test.cjs', baseline: 'red by assertion' });
}
console.log(`Evaluation fixtures validated: ${results.length} tasks (all baseline tests fail through behavioral assertions).`);
for (const r of results) console.log(`- ${r.id}: ${r.sourceFiles} source file(s), ${r.baseline}`);
