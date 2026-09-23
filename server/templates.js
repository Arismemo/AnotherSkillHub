// 服务端下发给终端/Agent 的脚本与指南模板。占位符 __NAME__ 由 render 替换；
// .sh 模板里的值必须事先经过 shQuote，模板本身只做字面替换。
const fs = require('fs');
const path = require('path');

const cache = new Map();
function load(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(__dirname, 'templates', name), 'utf8'));
  return cache.get(name);
}

function render(name, values) {
  return load(name).replace(/__([A-Z_]+)__/g, (match, key) => (Object.hasOwn(values, key) ? values[key] : match));
}

module.exports = { render };
