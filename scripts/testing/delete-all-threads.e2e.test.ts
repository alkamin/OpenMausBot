import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { launchVerificationServer, runControlOmb } from "../control-omb.ts";
import { api, type Bot } from "@/state/store";
import { allThreadRows, deleteAllThreads, deleteAllThreadsCopy } from "../../src/components/BotMenuDelete";

vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), api: vi.fn() }));

it("deletes ordinary conversations and their hidden routine runs together, leaving one persisted empty thread", async () => {
  const fixture = await launchVerificationServer();
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const request = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      ...options, headers: { "content-type": "application/json", origin: fixture.info.url },
    });
    const value = await response.json();
    expect(response.ok, `${options.method ?? "GET"} ${path}: ${JSON.stringify(value)}`).toBe(true);
    if (options.method && options.method !== "GET") evidence.push({ path, ...options, status: response.status, result: value });
    return value;
  };
  const post = (path: string, body?: unknown) => request(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const control = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]);
  const bots = async (): Promise<Bot[]> => (await request("/api/bots?messages=0")).bots;
  try {
    expect((await control("doctor") as { ok: boolean }).ok).toBe(true);
    const { bot } = await post("/api/bots");
    const otherBots = await bots();
    const otherThreads = otherBots.filter((candidate) => candidate.id !== bot.id).map((candidate) => ({ id: candidate.id, tasks: candidate.tasks }));
    const { task } = await post(`/api/bots/${bot.id}/tasks`, { title: "Saved conversation" });
    await request(`/api/bots/${bot.id}/tasks/${task.threadId}`, { method: "PATCH", body: JSON.stringify({ pinned: true, archivedAt: Date.now() }) });
    const { routine } = await post("/api/routines", {
      name: "Deletion report", prompt: "Report this run's state.", botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    });
    for (let index = 0; index < 2; index++) {
      const { run } = await post(`/api/routines/${routine.id}/run`);
      await expect.poll(async () => (await request("/api/routines")).runs.find((candidate: { id: string }) => candidate.id === run.id)?.status,
        { timeout: 20_000 }).toBe("completed");
      const finished = (await request("/api/routines")).runs.find((candidate: { id: string }) => candidate.id === run.id);
      evidence.push(await control("wait", "--bot", bot.id, "--task", finished.threadId));
      evidence.push(await control("messages", "--bot", bot.id, "--task", finished.threadId, "--limit", "10"));
    }
    const before = (await bots()).find((candidate) => candidate.id === bot.id)!;
    expect(before.tasks).toHaveLength(4);
    expect(before.tasks!.filter((task) => task.routineRunId)).toHaveLength(2);
    expect(deleteAllThreadsCopy(allThreadRows(before)).title).toBe("Delete all threads (4)?");
    vi.mocked(api).mockImplementation(request);
    const dispatch = vi.fn();

    await deleteAllThreads(before, dispatch);

    expect(dispatch).toHaveBeenLastCalledWith({ type: "notice", notice: { kind: "note", botName: null, text: "Deleted: 4." } });
    const after = (await bots()).find((candidate) => candidate.id === bot.id)!;
    expect(after.tasks).toHaveLength(1);
    expect(before.tasks!.map((task) => task.threadId)).not.toContain(after.threadId);
    expect(after.tasks![0]).toMatchObject({ threadId: after.threadId, title: "New thread" });
    const messages = await control("messages", "--bot", bot.id, "--task", after.threadId, "--limit", "10") as { messages: unknown[] };
    expect(messages.messages).toEqual([]);
    const saved: Bot[] = JSON.parse(readFileSync(join(fixture.info.dataDir, "bots.json"), "utf8"));
    expect(saved.find((candidate) => candidate.id === bot.id)?.tasks?.map((task) => task.threadId)).toEqual([after.threadId]);
    expect((await bots()).filter((candidate) => candidate.id !== bot.id).map((candidate) => ({ id: candidate.id, tasks: candidate.tasks }))).toEqual(otherThreads);
    evidence.push({ before, after, messages });
  } finally {
    vi.mocked(api).mockReset();
    const evidencePath = `${fixture.info.logPath}.delete-all-threads.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ logPath: fixture.info.logPath, evidencePath }));
    await fixture.close();
  }
}, 60_000);
