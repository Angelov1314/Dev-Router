const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, exec, execSync } = require("child_process");

const PORT = 4000;

// ── Port conflict detection ──

function getUsedPorts() {
  try {
    const output = execSync("lsof -iTCP -sTCP:LISTEN -n -P", { encoding: "utf-8", timeout: 5000 });
    const lines = output.trim().split("\n").slice(1); // skip header
    const ports = {};
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;
      const command = parts[0];
      const pid = parseInt(parts[1]);
      const nameField = parts[8]; // e.g. *:3000 or 127.0.0.1:5173
      const portMatch = nameField.match(/:(\d+)$/);
      if (!portMatch) continue;
      const port = parseInt(portMatch[1]);
      if (port < 1024) continue; // skip system ports
      if (!ports[port]) {
        ports[port] = { port, pid, command };
      }
    }
    return ports;
  } catch {
    return {};
  }
}

function detectDefaultPort(project) {
  // Determine the port the dev server will try to use
  const devScript = (project.devScript || "").toLowerCase();
  const pkgPath = path.join(project.cwd || project.path, "package.json");

  // Next.js: default 3000
  if (devScript.includes("next dev") || devScript.includes("next start")) {
    // Check for --port flag
    const portFlag = devScript.match(/--port\s+(\d+)|-p\s+(\d+)/);
    if (portFlag) return parseInt(portFlag[1] || portFlag[2]);
    return 3000;
  }

  // Vite: default 5173
  if (devScript.includes("vite")) {
    const portFlag = devScript.match(/--port\s+(\d+)/);
    if (portFlag) return parseInt(portFlag[1]);
    return 5173;
  }

  // Create React App / react-scripts: default 3000
  if (devScript.includes("react-scripts")) return 3000;

  // Astro: default 4321
  if (devScript.includes("astro")) return 4321;

  // Nuxt: default 3000
  if (devScript.includes("nuxt")) return 3000;

  // Flask: default 5000
  if (project.type === "python" && devScript.includes("flask")) return 5000;

  // Django: default 8000
  if (project.type === "python" && devScript.includes("manage.py")) return 8000;

  // Generic: try to detect --port in script
  const genericPort = devScript.match(/(?:--port|-p)\s+(\d+)/);
  if (genericPort) return parseInt(genericPort[1]);

  // Fallback: npm web project defaults
  if (project.type === "npm" && project.hasWeb) return 3000;

  return null;
}
const PROJECT_DIRS = [
  { path: "/Users/jerry/Claude/Projects", label: "Projects" },
  { path: path.resolve(__dirname, ".."), label: "Claude" },
  { path: "/Users/jerry/Desktop/projects", label: "Desktop" },
];

// Track running processes: { [projectName]: { proc, port, logs[] } }
const running = {};

function detectProjectType(dirPath, dirName) {
  const pkgPath = path.join(dirPath, "package.json");
  const reqPath = path.join(dirPath, "requirements.txt");
  const pyprojectPath = path.join(dirPath, "pyproject.toml");
  const godotPath = path.join(dirPath, "project.godot");
  const mainPy = path.join(dirPath, "main.py");
  const appPy = path.join(dirPath, "app.py");
  const serverPy = path.join(dirPath, "server.py");
  const managePy = path.join(dirPath, "manage.py");

  // Node/npm project with dev script
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts && pkg.scripts.dev) {
        return {
          type: "npm",
          displayName: pkg.name || dirName,
          command: "npm",
          args: ["run", "dev"],
          devScript: `npm run dev → ${pkg.scripts.dev}`,
          icon: "npm",
          hasWeb: true,
        };
      }
      // npm start fallback
      if (pkg.scripts && pkg.scripts.start) {
        return {
          type: "npm",
          displayName: pkg.name || dirName,
          command: "npm",
          args: ["run", "start"],
          devScript: `npm start → ${pkg.scripts.start}`,
          icon: "npm",
          hasWeb: true,
        };
      }
    } catch {}
  }

  // Python projects
  if (fs.existsSync(reqPath) || fs.existsSync(pyprojectPath)) {
    // Detect entry point
    let entryFile = null;
    let devScript = "";
    if (fs.existsSync(appPy)) { entryFile = "app.py"; }
    else if (fs.existsSync(serverPy)) { entryFile = "server.py"; }
    else if (fs.existsSync(mainPy)) { entryFile = "main.py"; }
    else if (fs.existsSync(managePy)) { entryFile = "manage.py"; }

    // Check for __main__.py (runnable package)
    const mainMod = path.join(dirPath, "__main__.py");
    if (fs.existsSync(mainMod)) {
      return {
        type: "python",
        displayName: dirName,
        command: "python3",
        args: ["-m", dirName],
        cwd: path.dirname(dirPath), // run from parent so module resolves
        devScript: `python3 -m ${dirName}`,
        icon: "python",
        hasWeb: false,
      };
    }

    if (entryFile) {
      const isWeb = entryFile === "app.py" || entryFile === "server.py" || entryFile === "manage.py";
      return {
        type: "python",
        displayName: dirName,
        command: "python3",
        args: [entryFile],
        devScript: `python3 ${entryFile}`,
        icon: "python",
        hasWeb: isWeb,
      };
    }

    // No clear entry point but has requirements
    return {
      type: "python",
      displayName: dirName,
      command: null,
      args: [],
      devScript: "No entry point detected",
      icon: "python",
      hasWeb: false,
      noRun: true,
    };
  }

  // Godot project
  if (fs.existsSync(godotPath)) {
    return {
      type: "godot",
      displayName: dirName,
      command: "open",
      args: ["-a", "Godot", dirPath],
      devScript: "Open in Godot Editor",
      icon: "godot",
      hasWeb: false,
    };
  }

  // Check for nested package.json (e.g. neural/neural-net/)
  try {
    const subdirs = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const sub of subdirs) {
      if (!sub.isDirectory()) continue;
      const subPkg = path.join(dirPath, sub.name, "package.json");
      if (fs.existsSync(subPkg)) {
        const pkg = JSON.parse(fs.readFileSync(subPkg, "utf-8"));
        if (pkg.scripts && pkg.scripts.dev) {
          return {
            type: "npm",
            displayName: pkg.name || `${dirName}/${sub.name}`,
            command: "npm",
            args: ["run", "dev"],
            cwd: path.join(dirPath, sub.name),
            devScript: `npm run dev → ${pkg.scripts.dev}`,
            icon: "npm",
            hasWeb: true,
          };
        }
      }
    }
  } catch {}

  // Static HTML project (has index.html at root)
  const indexHtml = path.join(dirPath, "index.html");
  if (fs.existsSync(indexHtml)) {
    return {
      type: "static",
      displayName: dirName,
      command: "open",
      args: [indexHtml],
      devScript: "Static HTML → open index.html",
      icon: "static",
      hasWeb: false, // opens directly, no port
      isStatic: true,
    };
  }

  return null;
}

function scanProjects() {
  const projects = [];
  for (const dir of PROJECT_DIRS) {
    if (!fs.existsSync(dir.path)) continue;
    const entries = fs.readdirSync(dir.path, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "dev-router" || entry.name === "Projects") continue;
      const dirPath = path.join(dir.path, entry.name);
      const info = detectProjectType(dirPath, entry.name);
      if (!info) continue;
      // Use label:name as unique key to avoid collisions across dirs
      const uniqueName = `${dir.label}::${entry.name}`;
      projects.push({
        name: uniqueName,
        folderName: entry.name,
        group: dir.label,
        displayName: info.displayName,
        devScript: info.devScript,
        path: dirPath,
        type: info.type,
        command: info.command,
        args: info.args,
        cwd: info.cwd || dirPath,
        icon: info.icon,
        isStatic: info.isStatic || false,
        hasWeb: info.hasWeb,
        noRun: info.noRun || false,
      });
    }
  }
  return projects;
}

function detectPort(logLine) {
  const patterns = [
    /https?:\/\/localhost:(\d+)/,
    /https?:\/\/127\.0\.0\.1:(\d+)/,
    /https?:\/\/0\.0\.0\.0:(\d+)/,
    /port\s+(\d+)/i,
    /Running on.*:(\d{4,5})/,
    /:(\d{4,5})\s*$/,
  ];
  for (const p of patterns) {
    const m = logLine.match(p);
    if (m) {
      const port = parseInt(m[1]);
      if (port >= 1024 && port <= 65535) return port;
    }
  }
  return null;
}

function startProject(name, forceStart) {
  if (running[name]) return { ok: true, status: "already running", port: running[name].port };

  const projects = scanProjects();
  const project = projects.find((p) => p.name === name);
  if (!project) return { ok: false, error: "Project not found" };
  if (project.noRun) return { ok: false, error: "No entry point detected" };

  // Check for port conflict
  const defaultPort = detectDefaultPort(project);
  if (defaultPort && !forceStart) {
    const usedPorts = getUsedPorts();
    if (usedPorts[defaultPort]) {
      return {
        ok: false,
        status: "port_conflict",
        defaultPort,
        conflict: usedPorts[defaultPort],
      };
    }
  }

  const proc = spawn(project.command, project.args, {
    cwd: project.cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: "0", BROWSER: "none", PYTHONUNBUFFERED: "1" },
  });

  const entry = { proc, port: null, logs: [], started: Date.now(), type: project.type, hasWeb: project.hasWeb, defaultPort };
  running[name] = entry;

  const handleOutput = (data) => {
    const line = data.toString();
    entry.logs.push(line);
    if (entry.logs.length > 200) entry.logs.shift();
    if (!entry.port && entry.hasWeb) {
      const port = detectPort(line);
      if (port) entry.port = port;
    }
  };

  proc.stdout.on("data", handleOutput);
  proc.stderr.on("data", handleOutput);
  proc.on("close", (code) => {
    entry.logs.push(`\n[Process exited with code ${code}]`);
    setTimeout(() => {
      if (running[name] === entry) delete running[name];
    }, 5000);
  });

  return { ok: true, status: "starting", defaultPort };
}

function stopProject(name) {
  const entry = running[name];
  if (!entry) return { ok: false, error: "Not running" };
  entry.proc.kill("SIGTERM");
  setTimeout(() => {
    try { entry.proc.kill("SIGKILL"); } catch {}
  }, 5000);
  delete running[name];
  return { ok: true };
}

function getStatus() {
  const projects = scanProjects();
  const usedPorts = getUsedPorts();
  return projects.map((p) => {
    const r = running[p.name];
    const defaultPort = detectDefaultPort(p);
    const portConflict = defaultPort && !r && usedPorts[defaultPort] ? usedPorts[defaultPort] : null;
    return {
      name: p.name,
      displayName: p.displayName,
      group: p.group,
      devScript: p.devScript,
      type: p.type,
      icon: p.icon,
      hasWeb: p.hasWeb,
      noRun: p.noRun,
      isStatic: p.isStatic,
      folderPath: p.path,
      running: !!r,
      port: r?.port || null,
      defaultPort,
      portConflict,
      uptime: r ? Math.floor((Date.now() - r.started) / 1000) : 0,
    };
  });
}

function getLogs(name) {
  const entry = running[name];
  if (!entry) return [];
  return entry.logs;
}

function serveHTML(res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fs.readFileSync(path.join(__dirname, "index.html"), "utf-8"));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getStatus()));
    return;
  }

  if (url.pathname === "/api/ports") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getUsedPorts()));
    return;
  }

  if (url.pathname === "/api/kill-port" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { port } = JSON.parse(body);
      const usedPorts = getUsedPorts();
      if (!usedPorts[port]) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "Port already free" }));
        return;
      }
      try {
        execSync(`kill -9 ${usedPorts[port].pid}`, { timeout: 5000 });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, killed: usedPorts[port] }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: `Failed to kill PID ${usedPorts[port].pid}` }));
      }
    });
    return;
  }

  if (url.pathname === "/api/start" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { name, forceStart } = JSON.parse(body);
      const result = startProject(name, forceStart);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (url.pathname === "/api/stop" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { name } = JSON.parse(body);
      const result = stopProject(name);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (url.pathname === "/api/logs") {
    const name = url.searchParams.get("name");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getLogs(name)));
    return;
  }

  if (url.pathname === "/api/open" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { port } = JSON.parse(body);
      exec(`open http://localhost:${port}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (url.pathname === "/api/folder" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const { path: folderPath } = JSON.parse(body);
      exec(`open "${folderPath}"`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  serveHTML(res);
});

server.listen(PORT, () => {
  console.log(`\n  Dev Router running at http://localhost:${PORT}\n`);
});

process.on("SIGINT", () => {
  console.log("\nShutting down all dev servers...");
  for (const name of Object.keys(running)) {
    try { running[name].proc.kill("SIGTERM"); } catch {}
  }
  process.exit(0);
});
process.on("SIGTERM", () => {
  for (const name of Object.keys(running)) {
    try { running[name].proc.kill("SIGTERM"); } catch {}
  }
  process.exit(0);
});
