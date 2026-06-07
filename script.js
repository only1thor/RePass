const APP_VERSION = 'v14';
const KEY = 'repass_secrets_v2';
const PBKDF2_ITERS = 600_000;
const KDF = `pbkdf2-sha256-${PBKDF2_ITERS}`;
localStorage.removeItem('repass_secrets');
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

const normalize = list => list.map(s => {
  const out = { ...s };
  if (!out.kdf) out.kdf = KDF;
  if (out.interval == null) out.interval = out.days ?? 1;
  if (out.efactor == null) out.efactor = 2.5;
  if (out.reps == null) out.reps = 0;
  delete out.days;
  return out;
});

function sm2(grade, prior) {
  let { interval, efactor, reps } = prior;
  if (grade < 3) {
    reps = 0;
    interval = 1;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * efactor);
    reps += 1;
  }
  efactor = Math.max(1.3, efactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  return { interval, efactor, reps };
}
const load = () => normalize(JSON.parse(localStorage.getItem(KEY) || '[]'));
const save = list => localStorage.setItem(KEY, JSON.stringify(normalize(list)));

const randomSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

async function hash(secret, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64(salt), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    key,
    256
  );
  return b64(new Uint8Array(bits));
}

const dueFromNow = days => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const isDue = iso => new Date(iso) <= new Date();

const fmt = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

async function addSecret(name, secret) {
  const salt = randomSalt();
  const list = load();
  list.push({
    id: crypto.randomUUID(),
    name,
    salt,
    hash: await hash(secret, salt),
    kdf: KDF,
    interval: 1,
    efactor: 2.5,
    reps: 0,
    nextDue: dueFromNow(1),
  });
  save(list);
}

const testDlg = document.getElementById('test');
const testMsg = document.getElementById('test-msg');
const testInput = document.getElementById('test-input');
let testId = null;

const testInputSection = document.getElementById('test-input-section');
const testGradeSection = document.getElementById('test-grade-section');
const testVerifyBtn = document.getElementById('test-verify');

function testSecret(id) {
  const item = load().find(s => s.id === id);
  if (!item) return;
  testId = id;
  document.getElementById('test-title').textContent = item.name;
  testInput.value = '';
  testMsg.hidden = true;
  testMsg.className = 'msg';
  testInputSection.hidden = false;
  testGradeSection.hidden = true;
  testVerifyBtn.hidden = false;
  testVerifyBtn.disabled = false;
  testVerifyBtn.textContent = 'Verify';
  testDlg.showModal();
}

document.getElementById('test-cancel').onclick = () => testDlg.close();

document.getElementById('test-form').addEventListener('submit', async e => {
  e.preventDefault();
  const item = load().find(s => s.id === testId);
  if (!item) return testDlg.close();
  testVerifyBtn.disabled = true;
  testVerifyBtn.textContent = 'Verifying…';
  let ok;
  try {
    ok = (await hash(testInput.value, item.salt)) === item.hash;
  } finally {
    testVerifyBtn.disabled = false;
    testVerifyBtn.textContent = 'Verify';
  }
  if (!ok) {
    testMsg.textContent = 'Incorrect.';
    testMsg.className = 'msg error';
    testMsg.hidden = false;
    return;
  }
  testMsg.hidden = true;
  testInputSection.hidden = true;
  testVerifyBtn.hidden = true;
  testGradeSection.hidden = false;
});

document.querySelectorAll('#test-grade-section .grade').forEach(btn => {
  btn.onclick = () => {
    const grade = parseInt(btn.dataset.grade, 10);
    const item = load().find(s => s.id === testId);
    if (!item) return testDlg.close();
    const updated = sm2(grade, item);
    const newItem = {
      ...item,
      ...updated,
      lastVerified: new Date().toISOString(),
      nextDue: dueFromNow(updated.interval),
    };
    save(load().map(s => s.id === testId ? newItem : s));
    testMsg.textContent = `Next check ${fmt(newItem.nextDue)}.`;
    testMsg.className = 'msg success';
    testMsg.hidden = false;
    testGradeSection.hidden = true;
    setTimeout(() => { testDlg.close(); render(); }, 1200);
  };
});

const menu = document.getElementById('menu');

function openMenu(id) {
  const item = load().find(s => s.id === id);
  if (!item) return;
  menu.dataset.id = id;
  document.getElementById('edit-title').textContent = item.name;
  document.getElementById('edit-name').value = item.name;
  menu.showModal();
}

function render() {
  const list = load().sort((a, b) => {
    const due = (isDue(b.nextDue) ? 1 : 0) - (isDue(a.nextDue) ? 1 : 0);
    return due !== 0 ? due : a.nextDue.localeCompare(b.nextDue);
  });
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  if (!list.length) {
    ul.innerHTML = '<li class="empty">No secrets yet.</li>';
    return;
  }
  for (const s of list) {
    const li = document.createElement('li');
    if (isDue(s.nextDue)) li.classList.add('due');
    li.innerHTML = `
      <span class="dot"></span>
      <div>
        <div class="name"></div>
        <div class="meta">${s.interval}d · next ${fmt(s.nextDue)}</div>
      </div>
      <div class="actions">
        <button class="ghost test">Test</button>
        <button class="ghost gear" aria-label="Edit">⚙️</button>
      </div>`;
    li.querySelector('.name').textContent = s.name;
    li.querySelector('.test').onclick = () => testSecret(s.id);
    li.querySelector('.gear').onclick = () => openMenu(s.id);
    ul.appendChild(li);
  }
}

document.getElementById('edit-form').addEventListener('submit', e => {
  const id = menu.dataset.id;
  const name = document.getElementById('edit-name').value.trim();
  if (!name) { e.preventDefault(); return; }
  save(load().map(s => s.id === id ? { ...s, name } : s));
  render();
});

document.getElementById('edit-cancel').onclick = () => menu.close();

const deleteIdle = document.getElementById('delete-idle');
const deleteConfirming = document.getElementById('delete-confirming');

function resetDelete() {
  deleteIdle.hidden = false;
  deleteConfirming.hidden = true;
}

document.getElementById('edit-delete').onclick = () => {
  deleteIdle.hidden = true;
  deleteConfirming.hidden = false;
};

document.getElementById('delete-no').onclick = resetDelete;

document.getElementById('delete-yes').onclick = () => {
  const id = menu.dataset.id;
  save(load().filter(s => s.id !== id));
  resetDelete();
  menu.close();
  render();
};

menu.addEventListener('close', resetDelete);

const importFile = document.getElementById('import-file');
const importDlg = document.getElementById('import-confirm');
const importText = document.getElementById('import-text');
let pendingImport = null;

const validImport = data => Array.isArray(data) && data.every(s =>
  s && typeof s.id === 'string' && typeof s.name === 'string' &&
  typeof s.salt === 'string' && typeof s.hash === 'string' &&
  typeof s.nextDue === 'string' &&
  (typeof s.interval === 'number' || typeof s.days === 'number')
);

document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `repass-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

document.getElementById('import-btn').onclick = () => importFile.click();

importFile.onchange = async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return; }
  if (!validImport(data)) return;
  pendingImport = data;
  const current = load().length;
  importText.textContent =
    `Replace ${current} ${current === 1 ? 'entry' : 'entries'} with ${data.length} from file?`;
  importDlg.showModal();
};

document.getElementById('import-cancel').onclick = () => importDlg.close();

document.getElementById('import-form').addEventListener('submit', () => {
  if (pendingImport) {
    save(pendingImport);
    render();
  }
});

importDlg.addEventListener('close', () => { pendingImport = null; });

const addDlg = document.getElementById('add-dialog');

document.getElementById('add-btn').onclick = () => {
  document.getElementById('add-dialog-form').reset();
  addDlg.showModal();
};

document.getElementById('add-dialog-cancel').onclick = () => addDlg.close();

document.getElementById('add-dialog-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('dialog-name').value.trim();
  const secret = document.getElementById('dialog-secret').value;
  if (!name || !secret) return;
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    await addSecret(name, secret);
    navigator.storage?.persist?.();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add';
  }
  e.target.reset();
  addDlg.close();
  render();
});

[menu, testDlg, importDlg, addDlg].forEach(dlg => {
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
});

testInput.addEventListener('input', () => {
  testMsg.hidden = true;
  testMsg.className = 'msg';
});

document.querySelectorAll('.eye').forEach(btn => {
  btn.onclick = () => {
    const input = document.getElementById(btn.dataset.target);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? 'Show' : 'Hide';
    btn.setAttribute('aria-label', showing ? 'Show secret' : 'Hide secret');
  };
});

render();

const versionEl = document.getElementById('version');
versionEl.textContent = `app ${APP_VERSION}`;

if ('serviceWorker' in navigator) {
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
  navigator.serviceWorker.register('sw.js').then(reg => reg.update());
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'version') {
      versionEl.textContent = `app ${APP_VERSION} · sw ${e.data.version}`;
    }
  });
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({ type: 'version?' });
  });
}
