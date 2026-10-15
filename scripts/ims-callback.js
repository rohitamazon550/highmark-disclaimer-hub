const parameters = new URLSearchParams(window.location.search);
const recipient = window.opener || (window.parent !== window ? window.parent : null);
const result = {
  type: 'loginpoc-ims',
  code: parameters.get('code'),
  state: parameters.get('state'),
  error: parameters.get('error'),
};
window.history.replaceState(null, '', window.location.pathname);
if (recipient) {
  recipient.postMessage(result, window.location.origin);
} else {
  document.querySelector('[role="status"]').textContent = 'The sign-in page is no longer open. Return to the site and sign in again.';
}