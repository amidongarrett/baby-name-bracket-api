const nodemailer = require('nodemailer');

/**
 * Send a 6-digit OTP to the given email address.
 * In development (no SMTP env vars), logs the code to stdout instead.
 *
 * @param {string} toEmail
 * @param {string} code
 */
async function sendOtpEmail(toEmail, code) {
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = process.env.SMTP_PORT;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@babynames.local';

  const hasSmtp = SMTP_HOST && SMTP_USER && SMTP_PASS;

  if (!hasSmtp) {
    console.log(`[DEV] OTP for ${toEmail}: ${code}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: toEmail,
    subject: 'Your Baby Name Bracket sign-in code',
    text: `Your sign-in code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, you can safely ignore this email.`,
  });
}

/**
 * Send an Owner 2 invite email containing a link to claim their bracket seat.
 * In development (no SMTP env vars), logs the link to stdout instead.
 *
 * @param {string} toEmail
 * @param {string} inviteCode
 */
async function sendInviteEmail(toEmail, inviteCode) {
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = process.env.SMTP_PORT;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@babynames.local';
  const APP_URL = process.env.APP_URL || 'http://localhost:3000';

  const inviteLink = `${APP_URL}/invite/${inviteCode}?role=owner2`;
  const hasSmtp = SMTP_HOST && SMTP_USER && SMTP_PASS;

  if (!hasSmtp) {
    console.log(`[DEV] Invite for ${toEmail}: ${inviteLink}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: EMAIL_FROM,
    to: toEmail,
    subject: "You've been invited to a Baby Name Bracket",
    text: `You've been invited to collaborate on a Baby Name Bracket!\n\nClick the link below to accept your invitation:\n${inviteLink}\n\nIf you did not expect this invitation, you can safely ignore this email.`,
  });
}

module.exports = { sendOtpEmail, sendInviteEmail };
