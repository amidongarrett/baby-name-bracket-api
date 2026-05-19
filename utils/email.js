const https = require('https');

/**
 * Send an email via the Resend HTTP API.
 * @param {string} apiKey - Resend API key (re_...)
 * @param {{ from: string, to: string, subject: string, text: string }} opts
 */
function resendSend(apiKey, { from, to, subject, text }) {
  const body = JSON.stringify({ from, to: [to], subject, text });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.resend.com',
        path: '/emails',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Resend API error ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a 6-digit OTP to the given email address.
 * In development (no SMTP_PASS env var), logs the code to stdout instead.
 *
 * @param {string} toEmail
 * @param {string} code
 */
async function sendOtpEmail(toEmail, code) {
  const SMTP_PASS = process.env.SMTP_PASS;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@babynames.local';

  if (!SMTP_PASS) {
    console.log(`[DEV] OTP for ${toEmail}: ${code}`);
    return;
  }

  await resendSend(SMTP_PASS, {
    from: EMAIL_FROM,
    to: toEmail,
    subject: 'Your Baby Name Bracket sign-in code',
    text: `Your sign-in code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, you can safely ignore this email.`,
  });
}

/**
 * Send an Owner 2 invite email containing a link to claim their bracket seat.
 * In development (no SMTP_PASS env var), logs the link to stdout instead.
 *
 * @param {string} toEmail
 * @param {string} inviteCode
 */
async function sendInviteEmail(toEmail, inviteCode) {
  const SMTP_PASS = process.env.SMTP_PASS;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@babynames.local';
  const APP_URL = process.env.APP_URL || 'http://localhost:3000';

  const inviteLink = `${APP_URL}/invite/${inviteCode}?role=owner2`;

  if (!SMTP_PASS) {
    console.log(`[DEV] Invite for ${toEmail}: ${inviteLink}`);
    return;
  }

  await resendSend(SMTP_PASS, {
    from: EMAIL_FROM,
    to: toEmail,
    subject: "You've been invited to a Baby Name Bracket",
    text: `You've been invited to collaborate on a Baby Name Bracket!\n\nClick the link below to accept your invitation:\n${inviteLink}\n\nIf you did not expect this invitation, you can safely ignore this email.`,
  });
}

/**
 * Send a bracket guest invite email containing a shareable link.
 * In development (no SMTP_PASS env var), logs the link to stdout instead.
 *
 * @param {string} toEmail
 * @param {string} shareLink
 * @param {string} bracketName
 */
async function sendBracketInviteEmail(toEmail, shareLink, bracketName) {
  const SMTP_PASS = process.env.SMTP_PASS;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@babynames.local';

  if (!SMTP_PASS) {
    console.log(`[DEV] Bracket invite for ${toEmail} (${bracketName}): ${shareLink}`);
    return;
  }

  await resendSend(SMTP_PASS, {
    from: EMAIL_FROM,
    to: toEmail,
    subject: "You've been invited to vote on a Baby Name Bracket",
    text: `You've been invited to vote on "${bracketName}"!\n\nClick the link below to view the bracket and cast your votes:\n${shareLink}\n\nIf you did not expect this invitation, you can safely ignore this email.`,
  });
}

module.exports = { sendOtpEmail, sendInviteEmail, sendBracketInviteEmail };
