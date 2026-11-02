# Integrate the Explorer

The supported reusable boundary is an iframe plus a JSON command client. This
keeps the current floating UI intact and lets another application choose which
capabilities to expose. The runtime is not yet a same-document component SDK.

The working example is `examples/embed/`. Run `npm run dev` and open
`http://127.0.0.1:8095/examples/embed/`, or open the same path on your deployed site.
It reads the model catalog for this project, discovers component IDs and runtime
capabilities, supports
tour controls and camera bookmarks, and demonstrates disconnect/remount.

The example's model selector is built from this project's configuration. When
pointing it at another deployment, supply that deployment's model IDs in the host
configuration; `getCapabilities` describes the currently loaded model, not a
remote project catalog.

## Minimal host

Bundle `src/explorer/embed-client.js` and its `embed-bridge.js` dependency with
your host. A separate host does not need Three.js. Use your own actual Explorer
address in the code below:

```js
import { createExplorerClient } from './explorer/embed-client.js';

const explorer = new URL('https://OWNER.github.io/REPOSITORY/');
explorer.searchParams.set('embed', '1');
explorer.searchParams.set('parentOrigin', window.location.origin);
const iframe = document.createElement('iframe');
iframe.title = 'Assembly Explorer';
iframe.src = explorer.href;
document.querySelector('#viewer').append(iframe);

const client = createExplorerClient({ iframe, origin: explorer.origin });
const handshake = await client.ready;
// A handshake can arrive while geometry is still loading.
const unsubscribe = client.subscribe(event => {
  if (event.type === 'stateChanged') console.log('Explorer state:', event.payload);
});
const capabilities = await client.request('getCapabilities');
const state = await client.request('getState');
// Discover stable component IDs with getChildren; do not infer IDs from labels.
```

All requests resolve to a terminal envelope. Check `payload.status` before using
`payload.result`; a rejected command does not imply success. Wait for the public
lifecycle to become ready before issuing actions that need geometry. Use
`getCapabilities` to build controls, rather than merely hiding unavailable buttons
after they fail. Protocol and command details are in [the API reference](api.md).

## Lifecycle

Subscribe once per mounted client. On teardown, request `dispose` if the peer is
available, remove the subscription, call `client.close()` and remove the iframe.
The example's `lifecycle.js` demonstrates bounded cleanup and remount. Each new
iframe negotiates a fresh session; delayed messages from an old one are ignored.
A request timeout asks the peer to cancel, but does not prove the operation never
ran. Read authoritative state before retrying.

## Host boundaries

The transport validates exact origin, source window, protocol and session.
`parentOrigin` explicitly selects the host; it is routing permission, not user
authentication or a security boundary for private geometry. Host code never
receives raw meshes, renderer internals or executable script commands. Project
feature policy remains the upper bound even when host options request more.

A server or agent tool can wrap this API in its own browser integration. This
repository does not ship a remote MCP endpoint, backend, account system or
cross-device persistence. Camera bookmarks are JSON and can be stored by the
host; they restore only to the exact compatible model revision.
