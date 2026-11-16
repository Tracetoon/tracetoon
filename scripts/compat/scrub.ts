/**
 * Diagnostics from compatibility runs are uploaded as build artifacts. A
 * free-plan agent puts its account's email in hook payloads (Cursor's
 * `user_email`), so addresses are replaced before anything leaves the runner.
 */
export function scrubEmails(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
}
