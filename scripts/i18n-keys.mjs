// Собирает все ключи tx("...") из src и проверяет, что для каждого есть английский перевод.
// node scripts/i18n-keys.mjs            -> список ключей без перевода (выход 1, если такие есть)
// node scripts/i18n-keys.mjs --dump     -> записать все ключи в scripts/i18n-keys.json
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { parse } from '@babel/parser';

const keys = new Set(['По имени', 'По последнему открытию', 'По дате создания']); // переводятся через tx(v)
function scan(p) {
  const ast = parse(readFileSync(p, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  (function w(n) {
    if (!n || typeof n.type !== 'string') return;
    if (n.type === 'CallExpression' && n.callee?.name === 'tx' && n.arguments[0]?.type === 'StringLiteral') keys.add(n.arguments[0].value);
    for (const k of Object.keys(n)) {
      if (['loc', 'leadingComments', 'trailingComments', 'innerComments'].includes(k)) continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(w);
      else if (v && typeof v.type === 'string') w(v);
    }
  })(ast.program);
}
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = d + '/' + f;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(f) && !f.startsWith('i18n')) scan(p);
  }
})('src');

const all = [...keys];
if (process.argv.includes('--dump')) {
  writeFileSync('scripts/i18n-keys.json', JSON.stringify(all, null, 1));
  console.log('ключей:', all.length);
} else {
  const en = (await import('../src/i18n-en.js')).default;
  const missing = all.filter((k) => !(k in en));
  const unused = Object.keys(en).filter((k) => !keys.has(k));
  console.log(`ключей: ${all.length}, без перевода: ${missing.length}, лишних в словаре: ${unused.length}`);
  missing.forEach((k) => console.log('  НЕТ:', JSON.stringify(k)));
  unused.forEach((k) => console.log('  ЛИШНИЙ:', JSON.stringify(k)));
  process.exit(missing.length ? 1 : 0);
}
