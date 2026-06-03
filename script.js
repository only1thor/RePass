const APP_VERSION = 'v5';
const KEY = 'repass_secrets';
const b64 = bytes => btoa(String.fromCharCode(...bytes));

const load = () => JSON.parse(localStorage.getItem(KEY) || '[]');
const save = list => localStorage.setItem(KEY, JSON.stringify(list));

const randomSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

async function hash(secret, salt) {
  const data = new TextEncoder().encode(secret + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return b64(new Uint8Array(buf));
}

const nextDue = days => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

const isDue = iso => new Date(iso) <= new Date();

const fmt = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

async function addSecret(name, secret, days) {
  const salt = randomSalt();
  const list = load();
  list.push({
    id: crypto.randomUUID(),
    name,
    days,
    salt,
    hash: await hash(secret, salt),
    nextDue: nextDue(days),
  });
  save(list);
}

const testDlg = document.getElementById('test');
const testMsg = document.getElementById('test-msg');
const testInput = document.getElementById('test-input');
let testId = null;

function testSecret(id) {
  const item = load().find(s => s.id === id);
  if (!item) return;
  testId = id;
  document.getElementById('test-title').textContent = item.name;
  testInput.value = '';
  testMsg.hidden = true;
  testMsg.className = 'msg';
  testDlg.showModal();
}

document.getElementById('test-cancel').onclick = () => testDlg.close();

document.getElementById('test-form').addEventListener('submit', async e => {
  e.preventDefault();
  const item = load().find(s => s.id === testId);
  if (!item) return testDlg.close();
  const ok = (await hash(testInput.value, item.salt)) === item.hash;
  if (!ok) {
    testMsg.textContent = 'Incorrect.';
    testMsg.className = 'msg error';
    testMsg.hidden = false;
    return;
  }
  const list = load().map(s => s.id === testId ? { ...s, nextDue: nextDue(s.days) } : s);
  save(list);
  testMsg.textContent = 'Verified. Next check ' + fmt(list.find(s => s.id === testId).nextDue) + '.';
  testMsg.className = 'msg success';
  testMsg.hidden = false;
  setTimeout(() => { testDlg.close(); render(); }, 1200);
});

const menu = document.getElementById('menu');

function openMenu(id) {
  const item = load().find(s => s.id === id);
  if (!item) return;
  menu.dataset.id = id;
  document.getElementById('edit-title').textContent = item.name;
  document.getElementById('edit-name').value = item.name;
  document.getElementById('edit-days').value = item.days;
  menu.showModal();
}

function render() {
  const list = load();
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
        <div class="meta">Every ${s.days}d · next ${fmt(s.nextDue)}</div>
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
  const days = parseInt(document.getElementById('edit-days').value, 10);
  if (!name || !days || days < 1) { e.preventDefault(); return; }
  save(load().map(s => s.id === id
    ? { ...s, name, days, nextDue: days !== s.days ? nextDue(days) : s.nextDue }
    : s));
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

document.getElementById('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('name').value.trim();
  const secret = document.getElementById('secret').value;
  const days = parseInt(document.getElementById('interval').value, 10);
  if (!name || !secret) return;
  await addSecret(name, secret, days);
  navigator.storage?.persist?.();
  e.target.reset();
  render();
});

render();

const versionEl = document.getElementById('version');
versionEl.textContent = `app ${APP_VERSION}`;

if ('serviceWorker' in navigator) {
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
