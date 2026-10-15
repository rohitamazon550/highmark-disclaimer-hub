# Adobe IMS Login POC

## Setup

Edit the exported constants at the top of `scripts/ims.js`. Use a public
**OAuth Single Page App** credential, not a confidential OAuth Web App credential
or a service-account credential. Never put a client secret in EDS. Environment is
`prod`. Replace both test-origin placeholders with the real preview origin.

`AdobeID,openid` is an example, not a verified scope grant for your credential.
Check Developer Console > credential > Scopes. To obtain name/email, request the
allowed `profile,email` scopes as appropriate. Adobe documents an additional
`read_organizations` scope requirement for the App Builder validator in certain
integrations. Verify availability before adding it. A federated email domain
should route the enterprise account through your IdP; federation and account
selection depend on your organization's configuration, not this block.

Register this default redirect URI on the SPA credential:

```text
https://<branch>--<site>--<org>.aem.page/ims-callback.html
```

The SDK's logout redirects to the origin root, so allow that too. A narrowly
scoped Console redirect URI pattern is:

```text
^https://<branch>--<site>--<org>\.aem\.page/(ims-callback\.html)?$
```

Substitute real values and escape any regex metacharacters in them. Register
each preview branch explicitly, rather than authorizing all of `aem.page`.
If the credential UI has an allowed-domain/origin field, add the exact preview
hostname/origin there too; it does not replace redirect URI validation.

The requested HTTP test origin is `http://localhost:3000`, but current Adobe
documentation requires HTTPS redirects for SPA credentials, including localhost.
Do not assume HTTP works with a legacy credential. This implementation explicitly
rejects HTTP sign-in. `aem up` can still serve code/content on port 3000.
For authentication, use the HTTPS preview site or a reverse proxy/tunnel with a
trusted certificate in front of `aem up`. For example, proxy to 3000 using an
available HTTPS port such as `https://localhost:3443`. Register
`https://localhost:3443/ims-callback.html` and `https://localhost:3443/` and the
pattern `^https://localhost:3443/(ims-callback\.html)?$`. Add that exact HTTPS
origin to the action's allowlist as well. Do not disable TLS validation. An HTTPS
tunnel hostname works similarly. These external changes are not made here.

## Login on Every Page

The shared `scripts/scripts.js` page initializer inserts the Login block above
page content automatically. No authored Login table is required. If a page
already contains a Login block, it is reused without adding another one.
Remove an existing authored Login table to use the automatic top-of-page position.
Fragments are not given their own automatic login blocks. Header, footer, and
global styles are unchanged. Pages remain public; this is not an access gate.

Start your normal local content proxy from this project:

```sh
npx -y @adobe/aem-cli up --no-open --port 3000
```

Use another port if occupied, and update all origin/redirect registrations if
that changes the externally visible origin. The Login block is inserted in the
browser, so it will not appear in the source `.plain.html` response unless authored.

## Implementation and Storage

`initIms()` loads the IMS library only when the Login block initializes.
The exports are `initIms`, `signIn`, `signOut`, `isSignedIn`, `getToken`,
`getProfile`, and `subscribe(listener)` (returns an unsubscribe function).
Subscriptions receive identity, busy/error state, expiry, and only an eight-character
token prefix, never a full token. `getToken()` returns the unexpired access token
or `null`. `getProfile()` is async and uses the IMS profile endpoint directly.

The current IMS script is
`https://auth.services.adobe.com/imslib/imslib.min.js`. Verified against the
served Adobe library: `client_id`, `scope`, `environment`, `redirect_uri`,
`autoCheckToken`, `useLocalStorage`, `logsEnabled`, `onReady`, and `onError`.
`useLocalStorage: false` ALONE selects session storage for tokens. Here
`autoCheckToken: false` disables SDK token initialization/automatic restore and
selects SDK token memory storage. We do not hand our token to the SDK, call its
token-producing APIs, or use its storage-backed profile API.

Authorization uses the documented `/ims/authorize/v2` PKCE code flow and
`/ims/token/v3`, with a random state and verifier in the opener's memory only.
The callback relays only code/state/error, checks the target origin, and clears
its query string. The opener checks origin, source window, and state before
exchanging a code. No ID token claims are used as proof of identity.
Profile data comes from an authenticated `/ims/userinfo/v2` request, documented
in Adobe's IMS API reference. Its `name` (or `given_name` and `family_name`) is
mapped to the displayed name. Adobe documents `profile` as required for name
claims and `email` for email claims. If those scopes are not granted, login may
succeed without either field; ask the credential administrator to confirm access.
Tokens never enter URLs or application logs.
No application code writes localStorage, sessionStorage, or cookies. The Adobe
library itself may probe/use browser storage for its own bookkeeping; Adobe/IdP
session cookies are outside our control. This is not a zero-storage SDK promise.

Silent restore makes one hidden-iframe PKCE request with `prompt=none`. With an
existing consented IMS session it can restore without interaction. Otherwise,
or if third-party cookies, frame policies, or federation prevent it, it times out
after eight seconds and offers interactive sign-in. There is no redirect loop or
persistent local token. Expiry clears the token and profile; sign-in is required
again. Logout clears memory first, attempts token revocation, then invokes the
IMS SDK's session logout redirect. Corporate IdP SSO may remain active even after
Adobe logout. Interactive callbacks also use a same-origin BroadcastChannel
named with the random authorization state, allowing completion when popup/COOP
policies sever the opener. The verifier and token remain in the original page's
memory; no storage is added. Without BroadcastChannel, opener isolation still
causes an error. Closing the popup can leave the page waiting until the
three-minute authorization timeout when the channel fallback is active.

## CSP

This project's existing `head.html` contains:

```text
script-src 'nonce-aem' 'strict-dynamic' 'unsafe-inline' http: https:; base-uri 'self'; object-src 'none'; frame-src 'self' https:; require-trusted-types-for 'script';
```

There is no `default-src` or `connect-src` restriction in that file. Under
`strict-dynamic`, the trusted bootstrap can load IMS dynamically. The loader
creates a `loginpoc-ims` Trusted Types policy accepting ONLY the exact IMS library
URL. The smallest change for the checked-in policy is therefore **no CSP edit**.
An additional deployed HTTP policy could still be more restrictive; inspect
actual response headers in DevTools on the preview site and on the callback.
The static callback must be reachable as HTML, not redirected into content auth.

For a restrictive deployed policy, the exact base hosts this implementation uses are:

| Directive | Sources |
| --- | --- |
| script-src | `'self'`, existing nonce/strict-dynamic bootstrap trust, `https://auth.services.adobe.com` if using host allowlists |
| connect-src | `'self'`, `https://ims-na1.adobelogin.com`, `https://<namespace>.adobeioruntime.net` (or the exact deployed action URL origin) |
| frame-src | `'self'`, `https://ims-na1.adobelogin.com` |
| trusted-types | `loginpoc-ims` if policy names are restricted |

The SDK's session logout additionally navigates to
`https://adobeid-na1.services.adobe.com` and
`https://ims-na1.adobelogin.com`; allow the former in `connect-src` if future SDK
features use its session checks. No broad `*.adobe.com` allowlist is needed.
An enterprise IdP redirect may require an additional frame host for silent
restore; it cannot be named without your federation configuration. Interactive
popup/top-level navigation is not controlled by `frame-src`.

The local policy comes from `head.html` with `move-to-http-header="true"`.
Externally managed policies live in the EDS site Configuration Service custom
headers via tools.aem.live / the Headers Editor or
`/config/{org}/sites/{site}/headers.json`. Preserve other directives; multiple CSP
policies intersect, so adding a second permissive policy does not relax a
restrictive one. Do not add obsolete repository configuration files.

## Protected API

After deploying, set `WHOAMI_URL` to the public **secured sequence** URL printed
by App Builder, without `.json`, query parameters, or an intermediate redirect.
The button sends `Authorization: Bearer ...` and `x-gw-ims-org-id` with the full
`@AdobeOrg` suffix, and no cookies. The UI distinguishes 401, 403, configuration,
and transport/CORS failures. If CORS hides a gateway-generated rejection, the
browser exposes a network error rather than its HTTP status; use DevTools/curl.

Prefer the SPA credential in the same organization and App Builder
project/workspace when Console supports that credential for the enabled APIs.
Same-project placement is a conservative setup recommendation, not a documented
universal acceptance guarantee. The validator also checks Adobe Exchange/product
authorization. A separate client that authenticates successfully is not thereby
authorized to invoke this app. Ask your Adobe administrator to confirm the
client's entitlement and allowed scopes; no Console access was available here.

## Manual Tests

1. Configure real constants in both projects, authorize redirects/scopes, deploy
   only whoami, and preview any page. Use HTTPS for login.
2. In a fresh browser session, confirm the silent check falls back, the real
   sign-in button is available, and no identity is displayed.
3. Sign in with the federated Adobe enterprise account; verify name/email,
   consent handling, and the status region. Cancel/deny once to check recovery.
4. Reload. With third-party session access allowed, expect silent restore.
   With third-party cookies or frames blocked, expect a usable sign-in button.
   Confirm application tokens are absent from local/session storage and cookies;
   SDK bookkeeping is separate. Debug must show at most eight token characters.
5. Call protected API. Expect matching IMS user ID, email/name when returned by
   IMS, and server timestamp. Check both headers and the preflight in DevTools.
6. Exercise an expired/revoked token using an isolated HTTP test client. Expect
   401 rejection, or a CORS transport error if the validator masks it. In the UI,
   wait for expiry or use a test-only short expiry response; identity/output
   must clear and the expired token must not be sent. Never paste tokens into
   issues, source, terminal command history, screenshots, or logs.
7. Test a valid but unauthorized org/client: expect 403 where exposed. Never
   treat changing the org header as permission to act in another organization.
8. Sign out, return from Adobe logout, and reload. Expect signed-out state unless
   corporate SSO establishes another Adobe session. Verify local identity and
   prior API output are cleared even when revocation cannot be reached.
9. Open the deployed action URL directly with no token, or use the curl command
   in the action README. Expect authentication rejection, never caller identity.
10. Test keyboard navigation, announced errors, narrow mobile width, popup
    blocking, network failure, and both configured browser origins for CORS.

## Evidence and Unverified Items

Reviewed on 2026-10-14:

- [Adobe Console implementation guide](https://developer.adobe.com/developer-console/docs/guides/authentication/UserAuthentication/implementation): SPA vs Web App, scopes, HTTPS redirects.
- [Adobe IMS API reference](https://developer.adobe.com/developer-console/docs/guides/authentication/UserAuthentication/ims): PKCE, prompt=none, code exchange, expiry seconds, revocation, identity scopes.
- [Adobe served IMS library](https://auth.services.adobe.com/imslib/imslib.min.js): actual config keys, memory-selection behavior, profile/v1, SDK logout implementation.
- [App Builder security](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/security/): validator sequence, org/product authorization, scope caveats.
- [EDS custom headers](https://www.aem.live/docs/custom-headers) and [Configuration Service](https://www.aem.live/docs/config-service-setup).

The IMS library documentation URL `/imslib/docs.html` returned 403. SDK-specific
keys/behavior were verified against the served source, not a successfully fetched
SDK reference page. The identity lookup now uses the Console API reference's
userinfo/v2 endpoint rather than the SDK's profile/v1. SDK logout behavior comes
from served source. Its unversioned CDN asset can change; recheck before production.
No real credential, Console scope grants, deployed action URL, Exchange
entitlements, IdP, production CSP headers, or authenticated EDS content source was
available. Therefore real login, silent SSO, logout, deployment, and gateway
rejection/CORS behavior remain manual acceptance gates, not verified successes.
The ordinary HTTP localhost origin cannot satisfy the documented SPA redirect
requirement without an HTTPS workaround. No dependencies were added or upgraded.

Local validation passed for dependency-free mocked IMS/action behavior: missing
tokens, CORS, verified identity projection, IMS rejections, silent fallback,
PKCE/state/source checks, expiry and logout after revocation failure. Browser
tests of the real block with a stubbed IMS module passed for literal profile
text, bearer/org headers, 401/403 messages, debug redaction, sign-out cleanup,
and desktop/mobile layout; screenshots were inspected. Editor diagnostics were
clear. ESLint/stylelint could not run because dependencies were absent and the
installation was skipped. A combined real-module/mocked-endpoint CSP browser
check timed out in test routing before document load, so CSP integration was
not verified by that test. No real Adobe authentication was performed.