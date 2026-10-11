// Offline play (Discussion #57): start a local metagame and deploy server, then the game against
// 127.0.0.1. The page talks to it through a small contract agreed with the runtime's author:
//   start(username?), stop(), status(), and a status event on every change.
// A first start with no local account stops at "needs-username"; start(username) then goes on.
//
// THIS FILE IS A MOCK. It walks through the phases with timers so the launcher's UI can be built
// and reviewed before the real runtime exists; the real implementation replaces OfflineMock and
// keeps the OfflineRuntime interface.

import { promises as fsp } from "node:fs";
import type { ActionResult, OfflineStatus } from "../shared/types";
import { isValidUsername } from "../shared/username";

export interface OfflineRuntime {
  start(username?: string): Promise<OfflineStatus>;
  stop(): Promise<OfflineStatus>;
  status(): OfflineStatus;
  onChange(fn: (s: OfflineStatus) => void): void;
  // A portable backup of the offline player data (it must restore on another PC or Windows user,
  // so the local identity is carried or reissued by the runtime). Both are refused while active.
  exportSave(file: string): Promise<ActionResult>;
  importSave(file: string): Promise<ActionResult>;
}

const MOCK_SAVE_FORMAT = "dauntless-revived-offline-save";

export class OfflineMock implements OfflineRuntime {
  private current: OfflineStatus = { phase: "stopped" };
  private account: string | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private listeners: ((s: OfflineStatus) => void)[] = [];

  status(): OfflineStatus {
    return this.current;
  }

  onChange(fn: (s: OfflineStatus) => void): void {
    this.listeners.push(fn);
  }

  async start(username?: string): Promise<OfflineStatus> {
    const busy = this.current.phase !== "stopped" && this.current.phase !== "error" && this.current.phase !== "needs-username";
    if (busy) return this.current;
    if (username !== undefined) {
      if (!isValidUsername(username)) return this.set({ phase: "needs-username", error: { code: "username_invalid" } });
      this.account = username;
    }
    this.clear();
    const steps: [number, OfflineStatus][] = [
      [0, { phase: "preparing" }],
      [700, { phase: "starting-metagame", progress: 0.25 }],
      [1500, { phase: "starting-deploy", progress: 0.55 }],
    ];
    if (this.account === null) {
      steps.push([2400, { phase: "needs-username" }]);
    } else {
      steps.push([2400, { phase: "launching-game", progress: 0.85 }], [3400, { phase: "running" }]);
      // The mock's "game" closes by itself after a while, like a player quitting.
      steps.push([15000, { phase: "stopping" }], [16200, { phase: "stopped" }]);
    }
    for (const [at, s] of steps) this.timers.push(setTimeout(() => this.set(s), at));
    return this.set({ phase: "preparing" });
  }

  // Never closes a running game: while it launches or runs, the stack stays and this is refused
  // ("busy"); when the game exits the runtime cleans up by itself (running, stopping, stopped).
  async stop(): Promise<OfflineStatus> {
    if (this.current.phase === "stopped") return this.current;
    if (this.current.phase === "launching-game" || this.current.phase === "running") return { ...this.current, error: { code: "busy" } };
    this.clear();
    this.timers.push(setTimeout(() => this.set({ phase: "stopped" }), 900));
    return this.set({ phase: "stopping" });
  }

  private active(): boolean {
    return this.current.phase !== "stopped" && this.current.phase !== "error";
  }

  async exportSave(file: string): Promise<ActionResult> {
    if (this.active()) return { ok: false, error: { code: "busy" } };
    await fsp.writeFile(file, JSON.stringify({ format: MOCK_SAVE_FORMAT, version: 1, mock: true, username: this.account }, null, 2));
    return { ok: true };
  }

  async importSave(file: string): Promise<ActionResult> {
    if (this.active()) return { ok: false, error: { code: "busy" } };
    let data: unknown;
    try {
      data = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      return { ok: false, error: { code: "offline_save_invalid" } };
    }
    const save = data as { format?: unknown; username?: unknown };
    if (save?.format !== MOCK_SAVE_FORMAT) return { ok: false, error: { code: "offline_save_invalid" } };
    this.account = typeof save.username === "string" && isValidUsername(save.username) ? save.username : null;
    return { ok: true };
  }

  private clear(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private set(s: OfflineStatus): OfflineStatus {
    this.current = s;
    for (const fn of this.listeners) fn(s);
    return s;
  }
}
