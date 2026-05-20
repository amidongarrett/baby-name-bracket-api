/**
 * Shared utility for identifying test-user email addresses.
 * Emails matching this pattern bypass OTP and receive full active-bracket visibility.
 */
const TEST_EMAIL_RE = /^test\+.+@amidonlabs\.com$/i;

module.exports = { TEST_EMAIL_RE };
