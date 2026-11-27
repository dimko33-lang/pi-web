// Minimal, dependency-free Markdown + LaTeX renderer for archived LightCone messages.
// Everything is escaped first; only safe http(s) links survive. KaTeX renders math if present.
(function () {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const safeHref = (url) => /^https?:\/\//i.test(url) ? esc(url) : null;

  function inline(text) {
    let out = esc(text);
    out = out.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
      const href = safeHref(url.replace(/&amp;/g, '&'));
      return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
    out = out.replace(/(^|[\s])(https?:\/\/[^\s<]+)/g, (match, lead, url) => {
      const href = safeHref(url);
      return href ? `${lead}<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>` : match;
    });
    return out;
  }

  function math(el) {
    if (typeof window.katex === 'undefined') return;
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          if (!/\$|\\\(|\\\[/.test(child.nodeValue)) continue;
          const holder = document.createElement('span');
          holder.innerHTML = renderMathInText(child.nodeValue);
          child.replaceWith(...holder.childNodes);
        } else if (child.nodeType === 1 && !child.classList.contains('katex')) {
          walk(child);
        }
      }
    };
    walk(el);
  }

  function tex(source, display) {
    try {
      return window.katex.renderToString(source, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'html' });
    } catch (error) {
      return esc(display ? `$$${source}$$` : `$${source}$`);
    }
  }

  function renderMathInText(text) {
    // Split out math first so escaped markup never interferes with TeX.
    let out = '';
    let rest = text;
    const pattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\))/;
    let match;
    while ((match = pattern.exec(rest))) {
      out += esc(rest.slice(0, match.index));
      const token = match[1];
      if (token.startsWith('$$') && token.endsWith('$$')) out += tex(token.slice(2, -2), true);
      else if (token.startsWith('\\[')) out += tex(token.slice(2, -2), true);
      else if (token.startsWith('\\(')) out += tex(token.slice(2, -2), false);
      else out += tex(token.slice(1, -1), false);
      rest = rest.slice(match.index + token.length);
    }
    return out + esc(rest);
  }

  function renderMarkdown(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const html = [];
    let list = null, code = null, para = [];
    const flushPara = () => {
      if (para.length) { html.push(`<p>${inlineWithMath(para.join('\n'))}</p>`); para = []; }
    };
    for (const line of lines) {
      if (code !== null) {
        if (/^```/.test(line)) { html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
        else code.push(line);
        continue;
      }
      if (/^```/.test(line)) { flushPara(); code = []; continue; }
      if (!line.trim()) { flushPara(); if (list) { html.push(`</${list}>`); list = null; } continue; }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) { flushPara(); if (list) { html.push(`</${list}>`); list = null; }
        const level = heading[1].length; html.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (bullet || ordered) {
        flushPara();
        const want = bullet ? 'ul' : 'ol';
        if (list !== want) { if (list) html.push(`</${list}>`); html.push(`<${want}>`); list = want; }
        html.push(`<li>${inline((bullet || ordered)[1])}</li>`);
        continue;
      }
      if (/^&gt;\s?/.test(esc(line)) || /^>\s?/.test(line)) {
        flushPara(); if (list) { html.push(`</${list}>`); list = null; }
        html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue;
      }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); if (list) { html.push(`</${list}>`); list = null; }
        html.push('<hr>'); continue; }
      para.push(line);
    }
    if (code !== null) html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    flushPara();
    if (list) html.push(`</${list}>`);
    return html.join('\n');
  }

  function inlineWithMath(text) {
    const holder = document.createElement('span');
    holder.innerHTML = renderMathInText(text);
    // Inline Markdown inside the non-math text segments only.
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          const span = document.createElement('span');
          span.innerHTML = inline(child.nodeValue);
          child.replaceWith(...span.childNodes);
        } else if (child.nodeType === 1 && !child.classList.contains('katex')) walk(child);
      }
    };
    walk(holder);
    return holder.innerHTML;
  }

  window.PiRender = {
    html(text) { return renderMarkdown(text); },
    applyMath(el) { math(el); }
  };
})();
