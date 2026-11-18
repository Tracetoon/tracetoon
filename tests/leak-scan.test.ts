import { describe, expect, test } from 'bun:test';
import { scanComment } from '@showtail/agent-traces/share/comment';
import { scanPrText } from '../src/commands/publish.ts';

// The link GitHub stored for an earlier comic upload (from PR #155's body).
const ATTACHMENT =
  '![comic](https://github.com/user-attachments/assets/29ce935f-3968-44ec-8d30-42725ffc1fe9)';

describe('leak scan of PR text', () => {
  test("GitHub's attachment links are not taken for secrets", () => {
    // The opaque-token filter alone flags the UUID; that is what blocked updates.
    expect(scanComment(ATTACHMENT).length).toBeGreaterThan(0);
    expect(scanPrText(ATTACHMENT)).toEqual([]);
    expect(
      scanPrText(`Intro\n\n${ATTACHMENT}\n\n${ATTACHMENT.replace('29ce', '30df')}\n`),
    ).toEqual([]);
  });

  test('a secret beside an attachment link is still found', () => {
    expect(
      scanPrText(`${ATTACHMENT}\nConfig: api_key = sk-live-abcdefghijklmnop1234567890\n`)
        .length,
    ).toBeGreaterThan(0);
  });

  test('only the exact attachment shape is set aside', () => {
    // Anything appended to the UUID, or another host, is scanned as before.
    const longer = ATTACHMENT.replace(
      '42725ffc1fe9',
      '42725ffc1fe9Zk3j9QpL2xV8nM4tR7wY1',
    );
    expect(scanPrText(longer).length).toBeGreaterThan(0);
    const other = ATTACHMENT.replace('github.com', 'example.com');
    expect(scanPrText(other)).toEqual(scanComment(other));
  });
});
