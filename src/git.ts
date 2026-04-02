import * as path from "path";
import { execSync } from "child_process";

export function gitMemoryLog(memoryDir: string, limit: number = 20): string[] {
  try {
    // Check if directory is in a git repo
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: memoryDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    const relPath = path.relative(gitRoot, memoryDir);
    const log = execSync(
      `git log --oneline --diff-filter=ACDMR --name-status -n ${limit} -- "${relPath}"`,
      { cwd: gitRoot, encoding: "utf-8", timeout: 10000 }
    );
    return log
      .split("\n")
      .filter((l) => l.trim().length > 0);
  } catch {
    return ["(not in a git repository or no history)"];
  }
}

export function gitMemoryDiff(memoryDir: string, since?: string): string {
  try {
    const gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd: memoryDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    const relPath = path.relative(gitRoot, memoryDir);
    const sinceArg = since ? `--since="${since}"` : "--since='7 days ago'";
    const diff = execSync(`git log ${sinceArg} --stat -- "${relPath}"`, {
      cwd: gitRoot,
      encoding: "utf-8",
      timeout: 10000,
    });
    return diff || "(no changes in period)";
  } catch {
    return "(not in a git repository)";
  }
}
