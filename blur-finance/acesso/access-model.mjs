export const PLAY_TEST_URL = 'https://play.google.com/apps/internaltest/4700079020651211475';
export const INVITE_URL = 'https://camilablur.com/blur-finance/acesso/';
export function accessView(user, status) {
  if (!user) return 'sign_in';
  if (!user.emailVerified) return 'verify_email';
  if (!status) return 'loading';
  if (!['none','pending','approved','denied'].includes(status.status)) throw Error('invalid_status');
  if (status.status === 'approved') return status.playReady === true ? 'ready' : 'approved_waiting_play';
  return status.status === 'none' ? 'request' : status.status;
}
export function approvedCsv(pages) {
  const emails = new Set();
  const add = email => {
    if (typeof email !== 'string' || !/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) throw Error('invalid_email');
    emails.add(email.toLowerCase());
  };
  for (const page of pages) {
    add(page.ownerEmail);
    for (const row of page.requests) if (row.status === 'approved') add(row.email);
  }
  return [...emails].sort().join('\n') + '\n';
}
