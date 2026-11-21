/**
 * How to run a long Tracetoon command (check, review run) as one blocking
 * call. Codex's exec tool returns after its yield time (at most 30 s for
 * `exec_command`) whether or not the command printed anything, and each
 * empty `write_stdin` poll is a full model call that re-reads the whole
 * context; one long wait (empty polls may wait up to 300 s) avoids that.
 * Claude Code's Bash moves a call to the background after its timeout
 * (120 s by default).
 */
export const BLOCKING_RULE =
  'Run it as ONE blocking call and wait for it to exit: Claude Code: a foreground Bash call with `timeout: 600000`; Codex: `exec_command` with `yield_time_ms: 30000`, then, while it still runs, `write_stdin` with empty `chars` and `yield_time_ms: 300000` (or, in an `exec` script, start it with `// @exec: {"yield_time_ms": 900000}` and loop on `write_stdin` until it exits); never poll with short waits, never `sleep` loops, and do no other work in between. It prints nothing until it is done, then one summary.';

/** Every other Tracetoon command finishes within seconds: on Codex give it `yield_time_ms: 30000` so it returns once, finished. */
export const QUICK_RULE =
  'On Codex give every tracetoon command `yield_time_ms: 30000` (it returns as soon as the command exits), so no command needs a poll.';
