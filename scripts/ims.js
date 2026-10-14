export const IMS_CLIENT_ID = 'd2c9776f81744fa99418cf2b2709e68f';
export const IMS_SCOPE = 'AdobeID,openid';
export const IMS_ENVIRONMENT = 'prod';
export const IMS_ORG_ID = '107121BF637764C60A495FA5@AdobeOrg';
export const WHOAMI_URL = '<WHOAMI_URL>';
export const TEST_ORIGINS = [
  'https://main--highmark-disclaimer-hub--rohitamazon550.aem.page',
  'http://localhost:3000',
];

const IMS_LIBRARY = 'https://auth.services.adobe.com/imslib/imslib.min.js';
const IMS_BASE = 'https://ims-na1.adobelogin.com';
const REDIRECT_URI = new URL('/ims-callback.html', window.location.origin).href;
const listeners = new Set();
let initialization;
let accessToken = null;
let expiresAt = 0;
let profile = null;
let expiryTimer;
let busy = false;
let message = '';
let generation = 0;

export function getToken() {
  return expiresAt > Date.now() ? accessToken : null;
}

export function isSignedIn() {
  return Boolean(getToken());
}

function notify() {
  const token = getToken();
  const state = {
    signedIn: Boolean(token),
    profile,
    expiresAt,
    tokenPrefix: token ? token.slice(0, 8) : '',
    busy,
    message,
  };
  listeners.forEach((listener) => listener(state));
}

export function subscribe(listener) {
  listeners.add(listener);
  notify();
  return () => listeners.delete(listener);
}

function clearIdentity() {
  generation += 1;
  accessToken = null;
  expiresAt = 0;
  profile = null;
  clearTimeout(expiryTimer);
}

export async function getProfile() {
  const token = getToken();
  if (!token) return null;
  if (profile) return profile;
  const currentGeneration = generation;
  const url = new URL('/ims/profile/v1', IMS_BASE);
  url.searchParams.set('client_id', IMS_CLIENT_ID);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, client_id: IMS_CLIENT_ID },
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Unable to retrieve your IMS profile.');
  const result = await response.json();
  if (generation !== currentGeneration || getToken() !== token) return null;
  profile = result;
  return profile;
}

function loadLibrary() {
  return new Promise((resolve, reject) => {
    if (window.adobeIMS || window.adobeid) {
      reject(new Error('Another IMS integration already owns this page.'));
      return;
    }
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('IMS library timed out. Check CSP and network access.'));
    }, 15000);
    const fail = () => {
      clearTimeout(timer);
      reject(new Error('IMS library could not load. Check CSP and network access.'));
    };
    window.adobeid = {
      client_id: IMS_CLIENT_ID,
      scope: IMS_SCOPE,
      environment: IMS_ENVIRONMENT,
      redirect_uri: new URL('/', window.location.origin).href,
      autoCheckToken: false,
      useLocalStorage: false,
      logsEnabled: false,
      onReady: () => {
        clearTimeout(timer);
        resolve();
      },
      onError: fail,
    };
    try {
      const policy = window.trustedTypes?.createPolicy('loginpoc-ims', {
        createScriptURL: (url) => {
          if (url !== IMS_LIBRARY) throw new TypeError('Unexpected IMS script URL.');
          return url;
        },
      });
      script.src = policy ? policy.createScriptURL(IMS_LIBRARY) : IMS_LIBRARY;
      script.async = true;
      script.onerror = fail;
      document.head.append(script);
    } catch (error) {
      fail();
    }
  });
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function authorize(silent, popup) {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(verifier),
  )));
  const url = new URL('/ims/authorize/v2', IMS_BASE);
  url.search = new URLSearchParams({
    client_id: IMS_CLIENT_ID,
    scope: IMS_SCOPE,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    ...(silent ? { prompt: 'none' } : {}),
  }).toString();
  const frame = silent ? document.createElement('iframe') : null;
  if (frame) {
    frame.hidden = true;
    frame.title = 'Adobe session check';
    document.body.append(frame);
  }
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      let timeout;
      let closed;
      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(closed);
        window.removeEventListener('message', receive);
      };
      function receive(event) {
        if (event.origin !== window.location.origin
          || event.source !== (frame ? frame.contentWindow : popup)
          || event.data?.type !== 'loginpoc-ims'
          || event.data.state !== state) return;
        cleanup();
        if (event.data.error || typeof event.data.code !== 'string' || !event.data.code) {
          reject(new Error('Adobe sign-in was not completed.'));
        } else resolve(event.data.code);
      }
      window.addEventListener('message', receive);
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error(silent ? 'No restorable Adobe session.' : 'Adobe sign-in timed out.'));
      }, silent ? 8000 : 180000);
      if (popup) {
        closed = setInterval(() => {
          if (popup.closed) {
            cleanup();
            reject(new Error('The sign-in window was closed or isolated by browser policy.'));
          }
        }, 500);
        popup.location.href = url.href;
      } else frame.src = url.href;
    });
  } finally {
    frame?.remove();
    popup?.close();
  }
  const tokenUrl = new URL('/ims/token/v3', IMS_BASE);
  tokenUrl.searchParams.set('client_id', IMS_CLIENT_ID);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT_URI,
    }),
    credentials: 'omit',
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('IMS code exchange failed. Check the SPA credential and redirect URI.');
  const result = await response.json();
  const lifetime = Number(result.expires_in);
  if (typeof result.access_token !== 'string' || !result.access_token
    || !Number.isFinite(lifetime) || lifetime <= 0) {
    throw new Error('IMS returned an invalid token response.');
  }
  clearIdentity();
  accessToken = result.access_token;
  expiresAt = Date.now() + lifetime * 1000;
  expiryTimer = setTimeout(() => {
    clearIdentity();
    message = 'Your session expired. Sign in again.';
    notify();
  }, Math.min(lifetime * 1000, 2147483647));
  try {
    await getProfile();
    message = '';
  } catch (error) {
    message = 'Signed in, but your profile could not be loaded.';
  }
}

export function initIms() {
  if (initialization) return initialization;
  initialization = (async () => {
    busy = true;
    notify();
    try {
      if (IMS_CLIENT_ID.startsWith('<') || IMS_ORG_ID.startsWith('<')) {
        throw new Error('Configure IMS_CLIENT_ID and IMS_ORG_ID in scripts/ims.js.');
      }
      if (window.location.protocol !== 'https:') {
        throw new Error('Adobe SPA redirects require HTTPS. Use the preview origin or a trusted HTTPS localhost proxy.');
      }
      await loadLibrary();
      try {
        await authorize(true, null);
      } catch (error) {
        message = 'No Adobe session restored. Sign in to continue.';
      }
    } catch (error) {
      message = error.message;
      throw error;
    } finally {
      busy = false;
      notify();
    }
  })();
  return initialization;
}

export async function signIn() {
  if (busy) return;
  const popup = window.open('about:blank', 'loginpoc-adobe-signin', 'popup,width=600,height=750');
  if (!popup) throw new Error('Allow popups for this site to sign in.');
  busy = true;
  message = '';
  notify();
  try {
    await initIms();
    await authorize(false, popup);
  } catch (error) {
    popup.close();
    message = error.message;
    throw error;
  } finally {
    busy = false;
    notify();
  }
}

export async function signOut() {
  if (busy) return;
  busy = true;
  const token = getToken();
  clearIdentity();
  message = 'Signing out...';
  notify();
  try {
    if (token) {
      try {
        const url = new URL('/ims/revoke', IMS_BASE);
        url.searchParams.set('client_id', IMS_CLIENT_ID);
        await fetch(url, {
          method: 'POST',
          body: new URLSearchParams({ token }),
          credentials: 'omit',
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        message = 'Token revocation unavailable; ending the Adobe session.';
      }
    }
    window.adobeIMS.signOut();
  } catch (error) {
    message = 'Signed out locally. Adobe session logout could not be completed; retry after reloading.';
    throw new Error(message);
  } finally {
    busy = false;
    notify();
  }
}