/**
 * How to run a long Tracetoon command (check, review run) as one blocking
 * call. Codex's exec tool returns after its yield time (at most 30 s for
 * `exec_command`) whether or not the command printed anything, and each
 * empty `write_stdin` poll is a full model call that re-reads the whole
 * context; one long wait (empty polls may wait up to 300 s) avoids that.
 * Claude Code's Bash moves a long call to the background (seen after
 * 180 s even with a 600 s timeout); the same command run again waits on the
 * run lock (workflow/runLock.ts) and prints the first one's result.
 */
export const BLOCKING_RULE =
  'Run it as ONE blocking call and wait for it to exit: Claude Code: a foreground Bash call with `timeout: 600000` (if Claude Code moves it to the background anyway, run the same command again in the foreground: it waits for the running one and prints its result; never start another long tracetoon command on this run meanwhile); Codex: `exec_command` with `yield_time_ms: 30000`, then, while it still runs, `write_stdin` with empty `chars` and `yield_time_ms: 300000` (or, in an `exec` script, start it with `// @exec: {"yield_time_ms": 900000}` and loop on `write_stdin` until it exits); never poll with short waits, never `sleep` loops, and do no other work in between. It prints nothing until it is done, then one summary.';

/** Every other Tracetoon command finishes within seconds: on Codex give it `yield_time_ms: 30000` so it returns once, finished. */
export const QUICK_RULE =
  'On Codex give every tracetoon command `yield_time_ms: 30000` (it returns as soon as the command exits), so no command needs a poll.';

/** finish and the other long commands, for an agent whose calls may be moved to the background. */
export const LONG_RULE =
  'finish, each check and every other long command below are blocking calls: on Claude Code a foreground Bash call with `timeout: 600000`; if one is moved to the background anyway, run that same command again in the foreground (it waits for the running one and prints its result), and never start a different long command (another finish, digest, render or publish) on this run meanwhile.';
