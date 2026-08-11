import { test } from "node:test";
import assert from "node:assert/strict";
import { isDirectedAtBot, stripMention } from "@/lib/telegram/listener";
import type { TelegramMessage } from "@/lib/integrations/telegram";

function makeMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return { message_id: 1, chat: { id: -100 }, from: { id: 999, is_bot: false, username: "sinan" }, ...overrides };
}

test("isDirectedAtBot: true when the message text mentions the bot's username", () => {
  const msg = makeMessage({ text: "hey @omnia_cfo_bot what was profit last week?" });
  assert.equal(isDirectedAtBot(msg, "omnia_cfo_bot", 8925348474), true);
});

test("isDirectedAtBot: mention matching is case-insensitive", () => {
  const msg = makeMessage({ text: "hey @Omnia_CFO_Bot what was profit last week?" });
  assert.equal(isDirectedAtBot(msg, "omnia_cfo_bot", 8925348474), true);
});

test("isDirectedAtBot: true when replying to a message the bot itself sent", () => {
  const msg = makeMessage({
    text: "and by store?",
    reply_to_message: { message_id: 5, chat: { id: -100 }, from: { id: 8925348474, is_bot: true, username: "omnia_cfo_bot" } },
  });
  assert.equal(isDirectedAtBot(msg, "omnia_cfo_bot", 8925348474), true);
});

test("isDirectedAtBot: false for an unrelated message with no mention and no reply", () => {
  const msg = makeMessage({ text: "picking up the KSA batch now" });
  assert.equal(isDirectedAtBot(msg, "omnia_cfo_bot", 8925348474), false);
});

test("isDirectedAtBot: false when replying to someone else's message", () => {
  const msg = makeMessage({
    text: "on it",
    reply_to_message: { message_id: 5, chat: { id: -100 }, from: { id: 111, is_bot: false, username: "yaseen" } },
  });
  assert.equal(isDirectedAtBot(msg, "omnia_cfo_bot", 8925348474), false);
});

test("isDirectedAtBot: false when text is undefined (e.g. a photo with no caption)", () => {
  const msg = makeMessage({ text: undefined });
  assert.equal(isDirectedAtBot(msg, "omnia_cfo_bot", 8925348474), false);
});

test("stripMention: removes the @mention and trims surrounding whitespace", () => {
  assert.equal(stripMention("@omnia_cfo_bot what was profit last week?", "omnia_cfo_bot"), "what was profit last week?");
  assert.equal(stripMention("what was profit last week? @omnia_cfo_bot", "omnia_cfo_bot"), "what was profit last week?");
});

test("stripMention: is case-insensitive and removes all occurrences", () => {
  assert.equal(stripMention("@Omnia_CFO_Bot hi @omnia_cfo_bot", "omnia_cfo_bot"), "hi");
});
