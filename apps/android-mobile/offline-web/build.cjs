const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
function build(output = path.resolve(__dirname, '../app/src/main/assets/offline')) {
  const partial = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/partial-cache-playlist.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 }, reportDiagnostics: true,
  });
  if (partial.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) throw new Error('Partial cache helper compilation failed');
  fs.mkdirSync(output, { recursive: true });
  for (const name of fs.readdirSync(path.join(__dirname, 'src'))) {
    fs.copyFileSync(path.join(__dirname, 'src', name), path.join(output, name));
  }
  fs.writeFileSync(path.join(output, 'partial-cache-playlist.js'), partial.outputText);
  fs.copyFileSync(require.resolve('hls.js/dist/hls.mjs'), path.join(output, 'hls.mjs'));
  fs.copyFileSync(path.join(root, 'public/logo.png'), path.join(output, 'logo.png'));
  fs.copyFileSync(path.join(__dirname, 'node_modules/hls.js/LICENSE'), path.join(output, 'HLS-LICENSE.txt'));
  console.log('Built local-only offline assets:', output);
}
module.exports = build;
if (require.main === module) build();
