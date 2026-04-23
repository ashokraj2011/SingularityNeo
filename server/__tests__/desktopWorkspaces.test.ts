// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  query: vi.fn(),
}));

import { query } from "../db";
import { upsertDesktopWorkspaceMapping } from "../desktopWorkspaces";

const queryMock = vi.mocked(query);

const rowResult = <T>(rows: T[]) =>
  ({
    rows,
    rowCount: rows.length,
    command: "",
    oid: 0,
    fields: [],
  }) as any;

const tempDirectories: string[] = [];

const createTempDirectory = () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "singularityneo-desktop-workspaces-"),
  );
  tempDirectories.push(directory);
  return directory;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("desktop workspace mappings", () => {
  it("treats a missing working directory as ready to clone", async () => {
    const root = createTempDirectory();
    const workingDirectory = path.join(root, "rule-engine");
    const nowIso = new Date().toISOString();

    queryMock.mockResolvedValueOnce(rowResult([])).mockResolvedValueOnce(
      rowResult([
        {
          id: "DWM-1",
          executor_id: "exec-1",
          user_id: "user-1",
          capability_id: "CAP-1",
          repository_id: "REPO-1",
          local_root_path: root,
          working_directory_path: workingDirectory,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ]),
    );

    const mapping = await upsertDesktopWorkspaceMapping({
      executorId: "exec-1",
      userId: "user-1",
      capabilityId: "CAP-1",
      repositoryId: "REPO-1",
      localRootPath: root,
      workingDirectoryPath: workingDirectory,
    });

    expect(mapping.localRootPath).toBe(root);
    expect(mapping.workingDirectoryPath).toBe(workingDirectory);
    expect(mapping.validation).toMatchObject({
      code: "WORKING_DIRECTORY_PENDING",
      valid: true,
    });
  });

  it("derives the local root from the working directory when omitted", async () => {
    const parentDirectory = createTempDirectory();
    const workingDirectory = path.join(parentDirectory, "untitled");
    const nowIso = new Date().toISOString();

    queryMock.mockResolvedValueOnce(rowResult([])).mockResolvedValueOnce(
      rowResult([
        {
          id: "DWM-2",
          executor_id: "exec-1",
          user_id: "user-1",
          capability_id: "CAP-1",
          repository_id: "REPO-1",
          local_root_path: parentDirectory,
          working_directory_path: workingDirectory,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ]),
    );

    const mapping = await upsertDesktopWorkspaceMapping({
      executorId: "exec-1",
      userId: "user-1",
      capabilityId: "CAP-1",
      repositoryId: "REPO-1",
      workingDirectoryPath: workingDirectory,
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1]?.[1]?.[5]).toBe(parentDirectory);
    expect(mapping.localRootPath).toBe(parentDirectory);
    expect(mapping.validation).toMatchObject({
      code: "WORKING_DIRECTORY_PENDING",
      valid: true,
    });
  });
});
