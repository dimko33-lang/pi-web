# Third-party notices

The [project MIT license](../../LICENSE) covers original Pi Web code and its technical documentation. It does not relicense third-party software or fonts, model weights, or the articles and media in Notes.

## Pi coding agent

Pi Web is an independent interface for [Pi](https://pi.dev/), created by Mario Zechner. The fresh-host installer installs the official `@earendil-works/pi-coding-agent` package at 1.7.0. Pi's own license is [MIT, copyright 2026 Earendil Inc.](pi-MIT.txt) ([upstream license for v1.7.0](https://github.com/earendil-works/pi/blob/v1.7.0/LICENSE)). Earlier Pi distributions also carried the notice “Copyright (c) 2025 Mario Zechner”. That notice belongs to Pi; it is not replaced by the Pi Web copyright notice.

## Browser assets included in this distribution

| Component | Bundled files | License and notices |
| --- | --- | --- |
| [KaTeX](https://github.com/KaTeX/KaTeX/tree/v0.16.47) | `public/vendor/katex/` and `public/nikita/vendor/katex/` | [MIT for the renderer](katex-MIT.txt); the [KaTeX fonts are under the SIL Open Font License 1.1](katex-fonts-OFL.txt). |
| [Inter](https://github.com/rsms/inter) | `public/vendor/inter/` | [SIL Open Font License 1.1](inter-OFL.txt) |
| [Marked](https://github.com/markedjs/marked/tree/v15.0.12) | `public/nikita/vendor/marked.js` | [Upstream license and notices](marked.txt) |
| [DOMPurify](https://github.com/cure53/DOMPurify/tree/3.3.0) | `public/nikita/vendor/purify.js` | [Apache 2.0 or MPL 2.0](dompurify.txt) |
| [Plotly.js basic](https://github.com/plotly/plotly.js/tree/v3.1.2) | `public/nikita/vendor/plotly.js` | [MIT](plotly-MIT.txt); the bundle also contains notices for embedded libraries. |

When redistributing, keep the applicable notices, including those embedded in the files. Dependencies and models downloaded during setup retain their upstream licenses and model terms. Hosted model and messaging services have their own terms; the Pi Web license does not grant access to those services.
