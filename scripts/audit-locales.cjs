const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'src/locales/messages');
const base = JSON.parse(fs.readFileSync(path.join(folder, 'ru.json'), 'utf8'));
const missing = new Set();
function scan(folder) {
  for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'locales') scan(file); continue; }
    if (!/\.tsx?$/.test(file)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const key = node.arguments[0].text;
        if (!base[key]) missing.add(key);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan(path.join(root, 'src'));
for (const key of ['Подтверждение Microsoft', 'Подключение аккаунта', 'Профиль Minecraft Java']) if (!base[key]) missing.add(key);
console.log('Missing source keys:', [...missing]);
if (process.argv.includes('--prepare')) {
  const extra = Object.fromEntries([...missing].map(k => [k, k]));
  Object.assign(base, extra);
  fs.writeFileSync(path.join(folder, 'ru.json'), JSON.stringify(base, null, 2) + '\n');
  fs.writeFileSync(path.join(root, '.test-data/i18n/extra.json'), JSON.stringify(extra, null, 2) + '\n');
  const english = {'Системная тема':'System theme', 'Подтверждение Microsoft':'Microsoft confirmation', 'Подключение аккаунта':'Connecting account', 'Профиль Minecraft Java':'Minecraft Java profile'};
  fs.writeFileSync(path.join(root, '.test-data/i18n/extra-en.json'), JSON.stringify(english, null, 2) + '\n');
}
