// Одноразовый инструмент: оборачивает русские строки интерфейса в tx(...) по AST (комментарии не трогает).
// node scripts/i18n-wrap.mjs [--dry] файлы...   -> печатает собранные ключи в scripts/i18n-keys.json
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const args = process.argv.slice(2);
const dry = args[0] === '--dry';
const files = dry ? args.slice(1) : args;
const CYR = /[А-Яа-яЁё]/;
const allKeys = new Set();
const warnings = [];

const isFn = (n) => /Function|ArrowFunction|ObjectMethod|ClassMethod/.test(n.type);

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const reps = []; // {start, end, text}
  const covered = []; // диапазоны уже заменённых узлов

  const inside = (n) => covered.some(([a, b]) => n.start >= a && n.end <= b);

  function walk(node, parent, fnDepth) {
    if (!node || typeof node.type !== 'string') return;
    if (inside(node)) return;
    const depth = fnDepth + (isFn(node) ? 1 : 0);

    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return;

    // уже переведено: tx('...')
    if (node.type === 'CallExpression' && node.callee?.name === 'tx') return;

    if (node.type === 'StringLiteral' && CYR.test(node.value)) {
      const isKey = parent && (parent.type === 'ObjectProperty' || parent.type === 'Property') && parent.key === node;
      if (!isKey) {
        const key = node.value;
        allKeys.add(key);
        const text = parent?.type === 'JSXAttribute' ? `{tx(${JSON.stringify(key)})}` : `tx(${JSON.stringify(key)})`;
        reps.push({ start: node.start, end: node.end, text });
        covered.push([node.start, node.end]);
        if (depth === 0) warnings.push(`${file}:${node.loc.start.line} верхний уровень: ${key}`);
        return;
      }
    }

    if (node.type === 'JSXText' && CYR.test(node.value)) {
      const raw = src.slice(node.start, node.end);
      const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const key = m[2].replace(/\s+/g, ' ');
      allKeys.add(key);
      reps.push({ start: node.start, end: node.end, text: `${m[1]}{tx(${JSON.stringify(key)})}${m[3]}` });
      covered.push([node.start, node.end]);
      return;
    }

    if (node.type === 'TemplateLiteral' && parent?.type !== 'TaggedTemplateExpression' && node.quasis.some((q) => CYR.test(q.value.cooked))) {
      let key = '';
      node.quasis.forEach((q, i) => { key += q.value.cooked; if (i < node.expressions.length) key += `{${i}}`; });
      const exprs = node.expressions.map((e) => src.slice(e.start, e.end));
      if (node.expressions.some((e) => CYR.test(src.slice(e.start, e.end)))) warnings.push(`${file}:${node.loc.start.line} русский текст внутри выражения шаблона — проверить вручную`);
      allKeys.add(key);
      reps.push({ start: node.start, end: node.end, text: exprs.length ? `tx(${JSON.stringify(key)}, [${exprs.join(', ')}])` : `tx(${JSON.stringify(key)})` });
      covered.push([node.start, node.end]);
      if (depth === 0) warnings.push(`${file}:${node.loc.start.line} верхний уровень (шаблон): ${key}`);
      return;
    }

    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments' || k === 'extra') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, node, depth));
      else if (v && typeof v.type === 'string') walk(v, node, depth);
    }
  }
  walk(ast.program, null, 0);

  if (!dry && reps.length) {
    let out = src;
    for (const r of reps.sort((a, b) => b.start - a.start)) out = out.slice(0, r.start) + r.text + out.slice(r.end);
    if (!/import \{[^}]*\btx\b[^}]*\} from ['"][./]*i18n\.js['"]/.test(out)) {
      let rel = path.relative(path.dirname(file), 'src/i18n.js').replace(/\\/g, '/');
      if (!rel.startsWith('.')) rel = './' + rel;
      const lines = out.split('\n');
      let last = -1;
      lines.forEach((l, i) => { if (/^import .* from /.test(l)) last = i; });
      lines.splice(last + 1, 0, `import { tx } from '${rel}';`);
      out = lines.join('\n');
    }
    writeFileSync(file, out);
  }
  console.log(`${file}: ${reps.length}`);
}

writeFileSync('scripts/i18n-keys.json', JSON.stringify([...allKeys], null, 1));
console.log('ключей:', allKeys.size);
if (warnings.length) console.log('ВНИМАНИЕ:\n' + warnings.join('\n'));
