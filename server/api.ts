import type { Plugin, Connect } from "vite";
import path from "node:path";
import { handle, openDatabase } from "./storage";
import { documentCommand } from './documents';
export function localApi(): Plugin {
  const dbPath = path.resolve(
    process.env.UNIDESK_DEV_DB ?? ".local/unidesk.db",
  );
  let db: ReturnType<typeof openDatabase> | undefined;
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== "/api/local") return next();
    const origin = req.headers.origin;
    if (
      req.method !== "POST" ||
      req.headers["x-unidesk-local"] !== "1" ||
      (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 140_000_000)
          throw Error("Use the desktop app for files larger than 100 MB.");
      }
      const { command, args } = JSON.parse(body) as {
        command: string;
        args: Record<string, unknown>;
      };
      db ??= openDatabase(dbPath);
      const value = ['document_preview','document_extract','document_probe'].includes(command) ? await documentCommand(db,command,args) : handle(db, command, args, dbPath);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ value: value ?? null }));
    } catch (e) {
      console.error("[UniDesk local operation]", e);
      res.writeHead(400, { "Content-Type": "application/json" });
      const message = e instanceof Error ? e.message : "Operation failed";
      res.end(
        JSON.stringify({
          error: message.includes("UNIQUE constraint")
            ? "This name or folder is already in use. Choose another."
            : message.includes("FOREIGN KEY")
              ? "A related item no longer exists. Refresh and try again."
              : message,
        }),
      );
    }
  };
  return {
    name: "unidesk-local",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
