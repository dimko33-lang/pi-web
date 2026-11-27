#!/usr/bin/env node
// TeX -> SVG. Использование: node render.js out.svg 'формула' [display=1]
const fs = require('fs');

const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { SVG } = require('mathjax-full/js/output/svg.js');
const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX({ packages: AllPackages, formatError: (jax, err) => { throw err; } });
const svg = new SVG({ fontCache: 'local' });
const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });

const out = process.argv[2];
const src = process.argv[3];
const display = process.argv[4] !== '0';

if (!out || !src) {
  console.error('нужно: node render.js out.svg "формула" [1|0]');
  process.exit(2);
}

const node = doc.convert(src, { display, em: 16, ex: 8, containerWidth: 1400 });
let content = adaptor.innerHTML(node);
if (!content.includes('xmlns=')) {
  content = content.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
}
fs.writeFileSync(out, content);
