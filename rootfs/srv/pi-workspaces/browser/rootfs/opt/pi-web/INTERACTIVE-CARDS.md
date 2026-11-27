# Interactive chat cards

The local web chat recognizes a fenced Markdown block with the exact language `interactive`.
Put a self-contained HTML fragment inside it, with inline CSS, SVG/canvas, and inline JavaScript as needed. Do not nest Markdown fences inside the fragment.

Cards appear automatically at full message width, without a header, border, Run demo button or Source disclosure. Execution starts when the card approaches the visible area, including restored history. Height follows content between 120 and 1000 CSS pixels; taller examples scroll within the frame. Keep demos small and responsive; target roughly 360px of content. Use English UI labels. Explain the purpose in ordinary text outside the fence.

Once started, a mounted card keeps its state while scrolling away; it is not suspended. Avoid continuous animation and background work. Removing or rerendering the card destroys the frame and resets its temporary state. This is not a full-screen editor or automatic integration with the real scene.

Execution is inside a sandboxed iframe with scripts enabled but no same-origin access, network fetching, external dependencies, nested frames, forms, popups, camera or microphone. Do not request access to the parent page, server, files, cookies or project APIs. Do not include secrets. This is a convenience isolation layer, not a resource quota: avoid infinite loops or expensive calculations.

Use inline scripts/styles only. Prefer SVG for draggable geometry and native range inputs for parameters. Demo state is temporary; code is retained in the normal message/session text and can be restored via Resume. This does not automatically integrate the demo with the editor or save its slider state.

## When to demonstrate

When discussing a proposed tool, geometry interaction, or ambiguous visual behavior, offer a small interactive prototype in chat before modifying the editor. Use it to confirm understanding: explain what the demo represents, ask the user to try it, and iterate from their feedback. Do not create a demo for every ordinary question. Integrate an approved prototype into the editor only when the user explicitly requests it.

The model knows the source it generated, but does not automatically receive the rendered image, dragged coordinates, slider values, or clicks from the iframe. Do not claim to see the user's current demo state. Ask for a screenshot or parameter values when needed. The current implementation does not synchronize demo state between people or send it back to the model.

Example:

```interactive
<label>Radius <input id="radius" type="range" min="5" max="90" value="40"></label>
<svg viewBox="0 0 240 220"><circle id="circle" cx="120" cy="110" r="40" fill="none" stroke="#77aaff" stroke-width="2"/></svg>
<script>
const radius = document.getElementById('radius');
const circle = document.getElementById('circle');
radius.oninput = () => circle.setAttribute('r', radius.value);
</script>
```
