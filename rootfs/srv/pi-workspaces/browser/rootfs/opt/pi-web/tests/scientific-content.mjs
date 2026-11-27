import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const katexSource = fs.readFileSync(new URL('../public/vendor/katex/katex.min.js', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../public/chat.js', import.meta.url), 'utf8');
const start = source.indexOf('  function esc(s)');
const end = source.indexOf('  function addCM(', start);
const context = vm.createContext({ window: { addEventListener() {} } });
// Test the same vendored math renderer that the browser actually loads.
vm.runInContext(katexSource, context);
vm.runInContext(source.slice(start, end) + '\nglobalThis.render = renderMd;', context);
const render = context.render;
for (const text of ['$x^2$', '\\(x^2\\)', '$$x^2$$', '\\[x^2\\]']) {
  assert.match(render(text), /class="katex"/);
  assert.doesNotMatch(render(text), /katex-error/);
}
const aligned = render('Before\n\\[\n\\begin{aligned}\na &= b+c \\\\\nd &= e\n\\end{aligned}\n\\]\nAfter');
assert.match(aligned, /math-block/); assert.doesNotMatch(aligned, /katex-error/);
const table = render('| Tool | Purpose |\n|---|---|\n| NumPy | Calculations |\n| SymPy | $x^2$ |');
assert.match(table, /<table>/); assert.equal((table.match(/<th /g) || []).length, 2);
assert.equal((table.match(/<td /g) || []).length, 4);
assert.match(render('| A | B |\n|---|---|\n| $P(a|b)$ | a\\|b |'), /P/);
assert.doesNotMatch(render('```tex\n\\[x\\]\n```'), /class="katex"/);
assert.doesNotMatch(render('`$x$`'), /class="katex"/);
assert.doesNotMatch(render('<script>alert(1)</script>'), /<script>/);
assert.match(render('```interactive\n<b>Demo</b>\n```'), /interactive-card/);
console.log('PASS scientific Markdown: delimiters, aligned equations, tables, code, escaping, interactive cards');
