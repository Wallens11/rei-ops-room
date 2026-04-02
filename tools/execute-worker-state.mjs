import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, "..");
export const executeWorkerPidFile = path.join(projectRoot, ".execute-worker.pid");
export const executeWorkerLogFile = path.join(projectRoot, ".execute-worker.log");
export const executeWorkerStateFile = path.join(projectRoot, ".execute-worker-state.json");
export const executeRunsDir = path.join(projectRoot, ".execute-runs");

export async function readExecuteWorkerState() {
  try {
    const text = await fs.readFile(executeWorkerStateFile, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeExecuteWorkerState(state = {}) {
  await fs.mkdir(projectRoot, {
    recursive: true
  });
  await fs.writeFile(
    executeWorkerStateFile,
    `${JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function clearExecuteWorkerState() {
  await fs.rm(executeWorkerStateFile, {
    force: true
  });
}
