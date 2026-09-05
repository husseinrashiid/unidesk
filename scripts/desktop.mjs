import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const root = process.cwd();
const env = { ...process.env };
if (existsSync(path.join(root, ".local/cargo/bin/cargo.exe"))) {
  env.CARGO_HOME = path.join(root, ".local/cargo");
  env.RUSTUP_HOME = path.join(root, ".local/rustup");
  env.PATH = path.join(env.CARGO_HOME, "bin") + path.delimiter + env.PATH;
}
const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
    ...process.argv.slice(2),
  ],
  { env, stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
