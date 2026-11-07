import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir } from "./testing/cleanup.ts";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "../scripts/control-omb.ts";

let fixture: VerificationServer;
let home = "";
let base = "";
let titleFile = "";
let titleDump = "";
const evidence: unknown[] = [];

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const result = { status: response.status, body: text ? JSON.parse(text) : null };
  if (method !== "GET") evidence.push({ method, path, body, result });
  return result;
};

const control = async (...args: string[]) => {
  const result = await runControlOmb([...args, "--url", base]);
  evidence.push({ command: args, result });
  return result;
};

const taskTitle = async (botId: string, threadId: string): Promise<string | undefined> => {
  const bot = (await api("GET", "/api/bots?messages=0")).body.bots.find((candidate: { id: string }) => candidate.id === botId);
  return bot?.tasks?.find((task: { threadId: string }) => task.threadId === threadId)?.title;
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-regenerate-title-"));
  titleFile = join(home, "title.txt");
  titleDump = join(home, "title-dump.json");
  fixture = await launchVerificationServer({
    ...process.env, FAKE_CLAUDE_TEXT_DUMP: titleDump, FAKE_CLAUDE_TEXT_FILE: titleFile,
  });
  base = fixture.info.url;
  evidence.push({ fixture: fixture.info });
}, 30_000);

afterAll(async () => {
  if (fixture) {
    const evidencePath = `${fixture.info.logPath}.thread-titles.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath: fixture.info.logPath, evidencePath }));
    await fixture.close();
  }
  if (home) await removeTempDir(home);
});

describe("Thread topic labels and title regeneration", { timeout: 60_000 }, () => {
  let botId = "";
  let threadId = "";

  it("enables topic summaries without an explicit feature setting", async () => {
    const stored = JSON.parse(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8"));
    expect(stored.features).not.toHaveProperty("llmThreadTitles");
    expect((await api("GET", "/api/config")).body.features.llmThreadTitles).toBe(true);
  });

  it("summarizes new direct and channel chats into persisted topic labels by default", async () => {
    writeFileSync(titleFile, "Fix session expiry\n");
    const { bot } = (await api("POST", "/api/bots", { name: "Topic labels" })).body;
    await api("PATCH", `/api/bots/${bot.id}`, { memoryUpkeep: false });
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "Could you help me? Every login hangs after the session expires." });
    expect(sent.status).toBe(202);
    await expect.poll(() => taskTitle(bot.id, sent.body.threadId), { timeout: 10_000 }).toBe("Fix session expiry");
    await control("wait", "--bot", bot.id, "--task", sent.body.threadId, "--timeout", "20");
    await control("messages", "--bot", bot.id, "--task", sent.body.threadId, "--limit", "10");
    const prompt = JSON.parse(readFileSync(titleDump, "utf8")).prompt;
    expect(prompt).toContain("Summarize the topic or goal for a sidebar label");
    expect(prompt).toContain("Every login hangs after the session expires");

    writeFileSync(titleFile, "Plan product launch\n");
    const { group } = (await api("POST", "/api/groups", {
      name: "Launch team", memberIds: [bot.id],
      setup: { bulletin: "", defaultResponder: { kind: "member", botId: bot.id } },
    })).body;
    expect((await api("POST", `/api/groups/${group.id}/messages`, { text: "I was thinking we should prepare a plan for our product launch." })).status).toBe(202);
    await expect.poll(async () => {
      const state = (await api("GET", "/api/bots?messages=0")).body;
      const current = state.groups.find((candidate: { id: string }) => candidate.id === group.id);
      return current?.tasks?.find((task: { threadId: string }) => task.threadId === group.threadId)?.title;
    }, { timeout: 10_000 }).toBe("Plan product launch");
    await expect.poll(async () => (await api("GET", "/api/bots?messages=0")).body.groups.find((candidate: { id: string }) => candidate.id === group.id)?.working,
      { timeout: 20_000 }).toBeFalsy();
    evidence.push({ channel: (await api("GET", "/api/bots?messages=0")).body.groups.find((candidate: { id: string }) => candidate.id === group.id) });
    const savedBots = JSON.parse(readFileSync(join(fixture.info.dataDir, "bots.json"), "utf8"));
    expect(savedBots.find((candidate: { id: string }) => candidate.id === bot.id).tasks)
      .toEqual(expect.arrayContaining([expect.objectContaining({ threadId: sent.body.threadId, title: "Fix session expiry" })]));
  });

  it("preserves a topic label chosen by the person when the first message arrives", async () => {
    const { bot } = (await api("POST", "/api/bots", { name: "Custom label" })).body;
    await api("PATCH", `/api/bots/${bot.id}`, { memoryUpkeep: false });
    const { task } = (await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Release checklist" })).body;
    rmSync(titleDump, { force: true });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Help prepare a product launch", threadId: task.threadId })).status).toBe(202);
    await control("wait", "--bot", bot.id, "--task", task.threadId, "--timeout", "20");
    expect(await taskTitle(bot.id, task.threadId)).toBe("Release checklist");
    expect(existsSync(titleDump)).toBe(false);
  });

  it("names a renamed thread from its recent conversation, without tool output", async () => {
    const bot = (await api("POST", "/api/bots", {
      modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, requireAvailableModel: true,
    })).body.bot;
    botId = bot.id;
    expect((await api("PATCH", `/api/bots/${botId}`, { memoryUpkeep: false })).status).toBe(200);
    rmSync(titleFile, { force: true });
    const sent = await api("POST", `/api/bots/${botId}/messages`, { text: "every login hangs after the session expires" });
    expect(sent.status).toBe(202);
    threadId = sent.body.threadId;
    await expect.poll(async () => {
      const page = (await api("GET", `/api/threads/${threadId}/messages?limit=50`)).body;
      const current = (await api("GET", "/api/bots?messages=0")).body.bots.find((candidate: { id: string }) => candidate.id === botId);
      return !current?.busy && (page?.messages ?? []).some((message: { role: string; kind: string }) => message.role === "bot" && message.kind === "text");
    }, { timeout: 20_000, interval: 150 }).toBe(true);
    await expect.poll(() => existsSync(titleDump), { timeout: 10_000 }).toBe(true);
    expect(await taskTitle(botId, threadId)).toBe("every login hangs after the session expires");
    rmSync(titleDump, { force: true });

    expect((await api("PATCH", `/api/bots/${botId}/tasks/${threadId}`, { title: "My name for it" })).status).toBe(200);
    writeFileSync(titleFile, "\"Session expiry login hang.\"\n");
    const regenerated = await api("POST", `/api/bots/${botId}/tasks/${threadId}/title`);
    expect(regenerated.status).toBe(200);
    expect(regenerated.body.task.title).toBe("Session expiry login hang");
    expect(await taskTitle(botId, threadId)).toBe("Session expiry login hang");

    const seen = JSON.parse(readFileSync(titleDump, "utf8"));
    expect(seen.prompt).toContain("Conversation:\n");
    expect(seen.prompt).toContain("User: every login hangs after the session expires\nBot: hello from fake claude");
    expect(seen.prompt).not.toContain("echo hi");
  });

  it("keeps the current title and says so when the one-shot fails or answers something unusable", async () => {
    writeFileSync(titleFile, "__FAIL__");
    const failed = await api("POST", `/api/bots/${botId}/tasks/${threadId}/title`);
    expect(failed.status).toBe(502);
    expect(failed.body.error).toMatch(/couldn't generate a title/);
    writeFileSync(titleFile, "This answer rambles on far too long to ever be a thread title");
    const unusable = await api("POST", `/api/bots/${botId}/tasks/${threadId}/title`);
    expect(unusable.status).toBe(502);
    expect(await taskTitle(botId, threadId)).toBe("Session expiry login hang");
  });

  it("refuses a thread with nothing to name it from, and an unknown one", async () => {
    const fresh = (await api("POST", `/api/bots/${botId}/tasks`, {})).body.task;
    const empty = await api("POST", `/api/bots/${botId}/tasks/${fresh.threadId}/title`);
    expect(empty.status).toBe(409);
    expect(empty.body.error).toMatch(/no messages/);
    expect((await api("POST", `/api/bots/${botId}/tasks/no-such-thread/title`)).status).toBe(404);
  });

  it("is refused once generated titles are switched off", async () => {
    expect((await api("PATCH", "/api/config", { features: { llmThreadTitles: false } })).status).toBe(200);
    expect((await api("GET", "/api/config")).body.features.llmThreadTitles).toBe(false);
    writeFileSync(titleFile, "Anything at all");
    const off = await api("POST", `/api/bots/${botId}/tasks/${threadId}/title`);
    expect(off.status).toBe(409);
    expect(await taskTitle(botId, threadId)).toBe("Session expiry login hang");
    const { task } = (await api("POST", `/api/bots/${botId}/tasks`, {})).body;
    rmSync(titleDump, { force: true });
    expect((await api("POST", `/api/bots/${botId}/messages`, { text: "Keep excerpt labels when explicitly disabled", threadId: task.threadId })).status).toBe(202);
    await control("wait", "--bot", botId, "--task", task.threadId, "--timeout", "20");
    expect(await taskTitle(botId, task.threadId)).toBe("Keep excerpt labels when explicitly disabled");
    expect(existsSync(titleDump)).toBe(false);
  });
});
