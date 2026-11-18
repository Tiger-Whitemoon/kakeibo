// Node でテストを実行： node test/run-node.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = { console, crypto: globalThis.crypto };
ctx.globalThis = ctx;
vm.createContext(ctx);
['js/util.js', 'js/balance.js', 'js/credit.js', 'js/report.js', 'js/ledger.js', 'test/tests.js'].forEach((f) =>
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f })
);
const results = ctx.KB.runTests();
let fail = 0;
results.forEach((r) => {
  if (!r.ok) fail++;
  console.log((r.ok ? 'OK   ' : 'FAIL ') + r.name + (r.ok ? '' : `\n     期待: ${JSON.stringify(r.expected)}\n     実際: ${JSON.stringify(r.actual)}`));
});
console.log(`\n${results.length - fail} / ${results.length} 件成功`);
process.exit(fail ? 1 : 0);
