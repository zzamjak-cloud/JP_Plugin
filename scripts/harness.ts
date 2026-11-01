// Node 테스트 하네스: Tauri 없이 기능 TS를 실제 PhotoCraft 제어 포트에 붙여 실행한다.
// 사용: PCPORT=7981 PCTOKEN=/path/token PCROOT=/path/root npx tsx scripts/harness.ts scripts/tests/foo.ts
// 테스트 스크립트에서 globalThis.__JP_DIALOG_ANSWERS__ = [...] 로 다이얼로그 응답을 순서대로 지정한다.
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const port = Number(process.env.PCPORT ?? 7981);
const tokenFile = process.env.PCTOKEN ?? "";
const root = process.env.PCROOT ?? process.cwd();

let sock: net.Socket | null = null;
let buf = "";
let nextId = 1;
const waiting = new Map<number, (v: any) => void>();

function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: "127.0.0.1", port }, async () => {
      sock = s;
      const r = await send("auth", { token: fs.readFileSync(tokenFile, "utf8").trim() });
      if (!r.ok) reject(new Error("auth failed"));
      else resolve();
    });
    s.setEncoding("utf8");
    s.on("data", (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const msg = JSON.parse(line);
        waiting.get(msg.id)?.(msg);
        waiting.delete(msg.id);
      }
    });
    s.on("error", reject);
    s.on("close", () => (sock = null));
  });
}

function send(method: string, params: any): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    sock!.write(JSON.stringify({ id, method, params }) + "\n");
  });
}

async function pcCall(method: string, params: any) {
  if (!sock) await connect();
  if (process.env.JP_TRACE) console.log("→", method, JSON.stringify(params).slice(0, 300));
  const r = await send(method, params ?? {});
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

const b64 = (b: Buffer) => b.toString("base64");
const handlers: Record<string, (a: any) => any> = {
  pc_call: (a) => pcCall(a.method, a.params),
  pc_status: async () => ({ connected: true, running: true, config: { appPath: "", port, root }, error: null }),
  pc_launch: async () => {},
  pc_quit: async () => {},
  pc_set_config: async () => {},
  fs_read_text: (a) => fs.readFileSync(a.path, "utf8"),
  fs_read_base64: (a) => b64(fs.readFileSync(a.path)),
  fs_write_text: (a) => (fs.mkdirSync(path.dirname(a.path), { recursive: true }), fs.writeFileSync(a.path, a.text)),
  fs_write_base64: (a) => (fs.mkdirSync(path.dirname(a.path), { recursive: true }), fs.writeFileSync(a.path, Buffer.from(a.data, "base64"))),
  fs_list_dir: (a) =>
    fs
      .readdirSync(a.path, { withFileTypes: true })
      .map((e) => {
        const p = path.join(a.path, e.name);
        const st = fs.statSync(p);
        return { name: e.name, path: p, isDir: e.isDirectory(), size: st.size, modifiedMs: st.mtimeMs };
      })
      .sort((x, y) => x.name.localeCompare(y.name)),
  fs_mkdir: (a) => fs.mkdirSync(a.path, { recursive: true }),
  fs_exists: (a) => fs.existsSync(a.path),
  fs_remove: (a) => fs.rmSync(a.path, { recursive: true, force: true }),
  fs_rename: (a) => (fs.mkdirSync(path.dirname(a.to), { recursive: true }), fs.renameSync(a.from, a.to)),
  fs_copy: (a) => (fs.mkdirSync(path.dirname(a.to), { recursive: true }), fs.copyFileSync(a.from, a.to)),
  fs_temp_dir: (a) => {
    const d = path.join(a.root, ".jp_plugin_tmp");
    fs.mkdirSync(d, { recursive: true });
    return d;
  },
  reveal_path: () => {},
};

(globalThis as any).__JP_DIALOG_ANSWERS__ = [];
(globalThis as any).__JP_LOG__ = [] as string[];
(globalThis as any).__JP_TRANSPORT__ = {
  async invoke(cmd: string, args: any = {}) {
    const h = handlers[cmd];
    if (!h) {
      const ext = (globalThis as any).__JP_EXTRA_HANDLERS__?.[cmd];
      if (ext) return ext(args);
      throw new Error(`harness: no handler for ${cmd}`);
    }
    return h(args);
  },
  async dialog(kind: string, options: any) {
    if (kind === "message") {
      console.log("[alert]", options.text);
      (globalThis as any).__JP_LOG__.push(String(options.text));
      return;
    }
    const q = (globalThis as any).__JP_DIALOG_ANSWERS__ as any[];
    if (!q.length) throw new Error(`harness: no answer queued for dialog ${kind}`);
    return q.shift();
  },
};

// localStorage 대체 (기능 코드의 프리셋 저장용)
if (!(globalThis as any).localStorage) {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

const target = process.argv[2];
if (!target) {
  console.error("usage: harness.ts <script.ts>");
  process.exit(2);
}
try {
  await import(pathToFileURL(path.resolve(target)).href);
  sock?.end();
  process.exit(0);
} catch (e) {
  console.error("FAILED:", e);
  sock?.end();
  process.exit(1);
}
