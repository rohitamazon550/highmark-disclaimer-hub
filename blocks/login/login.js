import {
  initIms, signIn, signOut, getToken, subscribe, IMS_ORG_ID, WHOAMI_URL, CREATE_FRAGMENT_URL,
} from '../../scripts/ims.js';

export default async function decorate(block) {
  block.replaceChildren();
  const identity = document.createElement('p');
  const controls = document.createElement('div');
  controls.className = 'login-controls';
  const status = document.createElement('p');
  status.className = 'login-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Debug';
  const debug = document.createElement('pre');
  details.append(summary, debug);
  const output = document.createElement('pre');
  output.className = 'login-response';
  output.setAttribute('aria-label', 'Protected API response');
  output.hidden = true;
  let ready = false;
  let calling = false;
  let signedIn = false;

  function button(label, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', async () => {
      try {
        await action();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    controls.append(element);
    return element;
  }

  const signin = button('Sign in with Adobe ID', signIn);
  const signout = button('Sign out', signOut);
  const call = button('Call protected API', async () => {
    const token = getToken();
    if (!token) throw new Error('Your session expired. Sign in again.');
    if (WHOAMI_URL.startsWith('<')) throw new Error('Configure WHOAMI_URL after deploying whoami.');
    const url = new URL(WHOAMI_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('WHOAMI_URL must be an HTTPS action URL without credentials, query, or fragment.');
    }
    calling = true;
    call.disabled = true;
    signout.disabled = true;
    status.textContent = 'Calling protected API...';
    output.hidden = true;
    output.textContent = '';
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'x-gw-ims-org-id': IMS_ORG_ID },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!signedIn || getToken() !== token) return;
      if (response.status === 401) throw new Error('401: Authentication rejected or expired. Sign in again.');
      if (response.status === 403) {
        throw new Error('403: Access denied. Check the IMS organization, scopes, and App Builder authorization.');
      }
      if (!response.ok) throw new Error(`Protected API returned HTTP ${response.status}.`);
      const result = await response.json();
      if (!signedIn || getToken() !== token) return;
      output.textContent = JSON.stringify(result, null, 2);
      output.hidden = false;
      status.textContent = 'Protected API call succeeded.';
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('API request blocked or unreachable. Check CORS preflight, CSP, and the deployed URL.');
      }
      throw error;
    } finally {
      calling = false;
      call.disabled = !signedIn;
      signout.disabled = !signedIn;
    }
  });

  const text = document.createElement('input');
  text.type = 'text';
  text.maxLength = 2000;
  text.placeholder = 'Fragment text';
  text.setAttribute('aria-label', 'Fragment text');
  const create = button('Create fragment', async () => {
    const token = getToken();
    if (!token) throw new Error('Your session expired. Sign in again.');
    const value = text.value.trim();
    if (!value) throw new Error('Enter some text first.');
    calling = true;
    create.disabled = true;
    status.textContent = 'Creating fragment...';
    output.hidden = true;
    try {
      const response = await fetch(CREATE_FRAGMENT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-gw-ims-org-id': IMS_ORG_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: value.slice(0, 100), text: value }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`${response.status}: ${result.error || 'Request failed.'}`);
      output.textContent = JSON.stringify(result, null, 2);
      output.hidden = false;
      status.textContent = 'Fragment created.';
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('API request blocked or unreachable. Check CORS preflight, CSP, and the deployed URL.');
      }
      throw error;
    } finally {
      calling = false;
      create.disabled = !signedIn;
    }
  });
  controls.insertBefore(text, create);

  block.append(identity, controls, status, details, output);
  const unsubscribe = subscribe((state) => {
    signedIn = state.signedIn;
    const name = state.profile?.displayName || 'Adobe user';
    const email = state.profile?.email || 'email unavailable';
    identity.textContent = signedIn ? `Signed in as ${name} (${email})` : '';
    signin.hidden = signedIn;
    signout.hidden = !signedIn;
    call.hidden = !signedIn;
    text.hidden = !signedIn;
    create.hidden = !signedIn;
    create.disabled = state.busy || calling;
    details.hidden = !signedIn;
    signin.disabled = !ready || state.busy;
    signout.disabled = state.busy || calling;
    call.disabled = state.busy || calling;
    debug.textContent = signedIn
      ? `Token expires: ${new Date(state.expiresAt).toISOString()}\nToken prefix: ${state.tokenPrefix}` : '';
    if (!signedIn) {
      output.hidden = true;
      output.textContent = '';
    }
    status.textContent = state.busy ? 'Contacting Adobe...' : state.message;
  });
  const observer = new MutationObserver(() => {
    if (!block.isConnected) {
      unsubscribe();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    await initIms();
    ready = true;
    signin.disabled = false;
  } catch (error) {
    status.textContent = error.message;
  }
}