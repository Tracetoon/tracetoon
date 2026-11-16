import { describe, expect, test } from 'bun:test';
import { cloudNote, cloudSessions } from '../src/digest/cloud.ts';

describe('cloud agent commits', () => {
  // Trailer recorded from a Claude Code on the web commit.
  const url = 'https://claude.ai/code/session_01CwpWp7sf2XCqBRa2KPga4S';
  const commit = (sha: string, trailers: Record<string, string[]>) => ({ sha, trailers });

  test('groups commits by the Claude Code on the web session they name', () => {
    const sessions = cloudSessions([
      commit('973375ea5490', { 'Claude-Session': [url], 'Co-Authored-By': ['Claude'] }),
      commit('1234567890ab', { 'claude-session': [url] }),
      commit('abcdefabcdef', {}),
    ]);
    expect(sessions).toEqual([
      {
        agent: 'Claude Code on the web',
        id: 'session_01CwpWp7sf2XCqBRa2KPga4S',
        url,
        commits: ['973375e', '1234567'],
        fetch: 'claude --teleport session_01CwpWp7sf2XCqBRa2KPga4S',
      },
    ]);
  });

  test('ignores a trailer that is not a Claude session link', () => {
    expect(
      cloudSessions([
        commit('973375ea5490', { 'Claude-Session': ['https://example.com/x'] }),
      ]),
    ).toEqual([]);
  });

  test('the note names the commits, the session and the command', () => {
    const [s] = cloudSessions([commit('973375ea5490', { 'Claude-Session': [url] })]);
    const note = cloudNote(s!);
    expect(note).toContain('973375e');
    expect(note).toContain(url);
    expect(note).toContain('`claude --teleport session_01CwpWp7sf2XCqBRa2KPga4S`');
  });
});
