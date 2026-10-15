const parameters = new URLSearchParams(window.location.search);
const recipient = window.opener || (window.parent !== window ? window.parent : null);
const result = {
  type: 'loginpoc-ims',
  code: parameters.get('code'),
  state: parameters.get('state'),
  error: parameters.get('error'),
};
window.history.replaceState(null, '', window.location.pathname);
const status = document.querySelector('[role="status"]');
let channel;
if (result.state && window.BroadcastChannel) {
  channel = new window.BroadcastChannel(`loginpoc-ims-${result.state}`);
  channel.onmessage = (event) => {
    if (event.data?.type !== 'loginpoc-ims-ack' || event.data.state !== result.state) return;
    channel.close();
    status.textContent = 'Adobe response received. Return to the site.';
    window.close();
  };
  channel.postMessage(result);
  setTimeout(() => channel.close(), 180000);
}
if (recipient) {
  recipient.postMessage(result, window.location.origin);
}
if (recipient || channel) {
  status.textContent = 'Adobe response sent to the sign-in page. If this window stays open, return to that page to check the error or restart sign-in.';
} else {
  status.textContent = 'The sign-in page is no longer open. Return to the site and sign in again.';
}