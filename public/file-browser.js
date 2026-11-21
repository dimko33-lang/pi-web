(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const form = $('upform'), picker = $('picker'), queue = $('queue');
  let uploading = false, pendingDelete = null, toastTimer;
  const size = bytes => bytes < 1024 ? bytes + ' B' : bytes < 1024 ** 2 ? (bytes / 1024).toFixed(1) + ' KB' : bytes < 1024 ** 3 ? (bytes / 1024 ** 2).toFixed(1) + ' MB' : (bytes / 1024 ** 3).toFixed(1) + ' GB';
  const date = value => {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  function kind(extension) {
    for (const [type, values] of Object.entries({ img: ['png','jpg','jpeg','gif','webp','svg','bmp','ico'], vid: ['mp4','webm','mov','mkv','avi'], aud: ['mp3','wav','ogg','flac','m4a'], zip: ['zip','rar','7z','tar','gz','bz2','xz'], pdf: ['pdf'], txt: ['md','txt','log','json','yml','yaml','csv'], code: ['html','htm','css','js','ts','py','sh'] })) if (values.includes(extension)) return type;
    return 'file';
  }
  function toast(message, error = false) {
    $('toast').textContent = message;
    $('toast').className = 'toast show' + (error ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').className = 'toast'; }, 2600);
  }
  async function refresh() {
    const response = await fetch('/files/api/list', { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 401 ? 'Open your private pi-web link again to sign in.' : 'Could not load files.');
    const data = await response.json();
    form.title = 'Up to ' + size(data.maxBytes) + ' per file';
    $('count').textContent = data.files.length + ' files';
    const rows = data.files.map(file => {
      const row = document.createElement('a'); row.className = 'row'; row.href = file.url; row.download = file.name;
      const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
      const icon = document.createElement('div'); icon.className = 'ic ' + kind(extension); icon.textContent = extension.toUpperCase().slice(0, 6) || 'FILE';
      const meta = document.createElement('div'); meta.className = 'meta';
      const name = document.createElement('div'); name.className = 'name'; name.textContent = file.name; name.title = file.name;
      meta.append(name);
      const bytes = document.createElement('div'); bytes.className = 'size'; bytes.textContent = size(file.size);
      const stamp = document.createElement('div'); stamp.className = 'date'; stamp.textContent = date(file.createdAt);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'act'; remove.textContent = '×'; remove.title = 'Delete'; remove.setAttribute('aria-label', 'Delete ' + file.name);
      remove.onclick = event => {
        event.preventDefault(); event.stopPropagation();
        pendingDelete = { file, button: remove };
        $('deleteMessage').textContent = 'Delete “' + file.name + '”?';
        $('deleteConfirm').showModal();
        $('cancelDelete').focus();
      };
      row.append(icon, meta, bytes, stamp, remove); return row;
    });
    if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Empty — drop a file to start'; rows.push(empty); }
    $('list').replaceChildren(...rows);
  }
  $('cancelDelete').onclick = () => $('deleteConfirm').close();
  $('deleteConfirm').addEventListener('close', () => { pendingDelete = null; });
  $('confirmDelete').onclick = async () => {
    const item = pendingDelete;
    if (!item) return;
    $('deleteConfirm').close();
    item.button.disabled = true;
    try {
      const response = await fetch('/files/api/' + item.file.id, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete the file.');
      await refresh(); toast('Deleted');
    } catch (error) { item.button.disabled = false; toast(error.message, true); }
  };
  function upload(file, row) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest(); request.open('POST', '/files/upload'); request.responseType = 'json';
      const paint = pct => { row.querySelector('.up-fill').style.width = pct + '%'; row.querySelector('.up-pct').textContent = pct + '%'; };
      request.upload.onprogress = event => { if (event.lengthComputable) paint(Math.round(event.loaded / event.total * 100)); };
      request.onload = () => { if (request.status >= 200 && request.status < 300) { paint(100); resolve(request.response); } else reject(new Error(request.response?.error || 'Upload failed.')); };
      request.onerror = () => reject(new Error('Connection lost during upload.'));
      request.onabort = () => reject(new Error('Upload cancelled.'));
      const data = new FormData(); data.append('file', file); request.send(data);
    });
  }
  async function uploadFiles(files) {
    if (uploading || !files.length) return;
    uploading = true; picker.disabled = true; form.setAttribute('aria-disabled', 'true');
    queue.replaceChildren(); queue.classList.add('on');
    const rows = files.map(file => {
      const row = document.createElement('div'); row.className = 'up-item';
      row.innerHTML = '<div class="up-name"></div><div class="up-bar"><div class="up-fill"></div></div><div class="up-pct">0%</div>';
      row.querySelector('.up-name').textContent = file.name; queue.append(row); return row;
    });
    try {
      for (let i = 0; i < files.length; i++) await upload(files[i], rows[i]);
      await refresh(); toast('Upload complete.');
    } catch (error) { toast(error.message, true); await refresh().catch(() => {}); }
    finally { uploading = false; picker.disabled = false; picker.value = ''; form.removeAttribute('aria-disabled'); }
  }
  form.onsubmit = event => event.preventDefault();
  form.onclick = event => { if (event.target !== picker && !uploading) picker.click(); };
  form.onkeydown = event => { if (event.target === form && ['Enter', ' '].includes(event.key)) { event.preventDefault(); if (!uploading) picker.click(); } };
  picker.onchange = () => uploadFiles([...picker.files]);
  form.ondragover = event => { event.preventDefault(); form.classList.add('over'); };
  form.ondragleave = () => form.classList.remove('over');
  form.ondrop = event => { event.preventDefault(); form.classList.remove('over'); uploadFiles([...event.dataTransfer.files]); };
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => event.preventDefault());
  addEventListener('focus', () => { if (!uploading && !$('deleteConfirm').open) refresh().catch(error => toast(error.message, true)); });
  refresh().catch(error => toast(error.message, true));
})();
