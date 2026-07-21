const express = require('express');
const http = require('http');
const url = require('url');
const ws = require('ws');
const { Server: SocketIoServer } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pty = require('node-pty');
const os = require('os');
const { ESLint } = require('eslint');

let setupWSConnection;
try {
  setupWSConnection = require('y-websocket/bin/utils').setupWSConnection;
} catch(e) {
  setupWSConnection = require('y-websocket').setupWSConnection;
}

const shell = os.platform() === 'win32' 
  ? 'powershell.exe' 
  : 'bash';

// Initialize ESLint instance (global reusable instance)
const eslintInstance = new ESLint({
  useEslintrc: false,
  overrideConfig: {
    env: {
      es2022: true,
      browser: true,
      node: true
    },
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    rules: {
      // Beginner mistakes
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      'eqeqeq': 'warn',
      'no-var': 'warn',
      'no-empty': 'warn',
      
      // Infinite loop detection
      'no-constant-condition': 'error',
      
      // Dead code
      'no-unreachable': 'error',
      
      // Security vulnerabilities
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      
      // Code quality
      'no-duplicate-case': 'error',
      'no-self-assign': 'warn',
      'no-useless-return': 'warn'
    }
  }
});


const app = express();
const port = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// API health route
app.get('/api/health', (req, res) => {
  res.json({
    status: "healthy",
    message: "DeepCode Backend is up on single port!"
  });
});

// Piston language map
const PISTON_LANG_MAP = {
  python:     { language: "python",     version: "3.10.0"  },
  javascript: { language: "javascript", version: "18.15.0" },
  cpp:        { language: "c++",        version: "10.2.0"  }
};

// Local code execution runner as fallback
const runCodeLocally = (language, code, stdin) => {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, 'temp_runs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    
    let filename, command, args;
    if (language === 'python') {
      filename = `main_${Date.now()}.py`;
      command = 'python';
      args = [path.join(tempDir, filename)];
    } else if (language === 'javascript') {
      filename = `main_${Date.now()}.js`;
      command = 'node';
      args = [path.join(tempDir, filename)];
    } else if (language === 'cpp') {
      filename = `main_${Date.now()}.cpp`;
    } else {
      return reject(new Error("Unsupported language for local runner"));
    }
    
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, code);

    if (language === 'cpp') {
      const exePath = path.join(tempDir, `main_${Date.now()}.exe`);
      const compile = spawn('g++', ['-o', exePath, filePath]);
      let compileStderr = '';
      compile.stderr.on('data', (data) => {
        compileStderr += data.toString();
      });
      compile.on('close', (exitCode) => {
        try { fs.unlinkSync(filePath); } catch(e){}
        if (exitCode !== 0) {
          return resolve({
            stdout: '',
            stderr: compileStderr || 'Compilation failed',
            exitCode: exitCode,
            status: 'Runtime Error'
          });
        }
        runProcess(exePath, [], stdin, () => {
          try { fs.unlinkSync(exePath); } catch(e){}
        }, resolve);
      });
      return;
    }

    runProcess(command, args, stdin, () => {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }, resolve);
  });
};

const runProcess = (command, args, stdin, cleanup, resolve) => {
  const child = spawn(command, args);
  let stdout = '';
  let stderr = '';
  
  if (stdin) {
    child.stdin.write(stdin);
    child.stdin.end();
  }
  
  child.stdout.on('data', (data) => {
    stdout += data.toString();
  });
  
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  
  const timeout = setTimeout(() => {
    child.kill();
    cleanup();
    resolve({
      stdout,
      stderr: stderr + '\n[Execution Timeout Error]',
      exitCode: 124,
      status: 'Runtime Error'
    });
  }, 5000);

  child.on('close', (exitCode) => {
    clearTimeout(timeout);
    cleanup();
    resolve({
      stdout,
      stderr,
      exitCode: exitCode ?? 0,
      status: exitCode === 0 ? 'Success' : 'Runtime Error'
    });
  });
  
  child.on('error', (err) => {
    clearTimeout(timeout);
    cleanup();
    resolve({
      stdout: '',
      stderr: `Local runner error: ${err.message}`,
      exitCode: 127,
      status: 'Runtime Error'
    });
  });
};

// POST /api/execute route
app.post('/api/execute', async (req, res) => {
  const { code, language, stdin = "" } = req.body;
  
  const langConfig = PISTON_LANG_MAP[language];
  if (!langConfig) {
    return res.status(400).json({ error: "Unsupported language" });
  }

  try {
    // Attempt calling public Piston API
    const response = await axios.post("https://emkc.org/api/v2/piston/execute", {
      language: langConfig.language,
      version: langConfig.version,
      files: [{ name: "main", content: code }],
      stdin,
      run_timeout: 3000,
      compile_timeout: 10000
    });

    const result = response.data.run;
    res.json({
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.code,
      status: result.code === 0 ? "Success" : "Runtime Error"
    });
  } catch (pistonError) {
    console.warn("Piston API request failed (likely whitelist restricted), falling back to local runner. Error:", pistonError.message);
    try {
      // Fallback: Run code locally on server using installed compilers/interpreters
      const localResult = await runCodeLocally(language, code, stdin);
      res.json(localResult);
    } catch (localError) {
      console.error("Local runner failed:", localError.message);
      res.status(500).json({ error: localError.message });
    }
  }
});

// POST /api/lint route
app.post('/api/lint', async (req, res) => {
  const { code, language } = req.body;

  // Empty code check
  if (!code || !code.trim()) {
    return res.json([]);
  }

  // Only lint JavaScript — Python/C++ return empty
  if (language && language !== 'javascript') {
    return res.json([]);
  }

  try {
    const results = await eslintInstance.lintText(code);
    const messages = results[0]?.messages || [];

    const diagnostics = messages.map(msg => ({
      line: msg.line,
      column: msg.column,
      endLine: msg.endLine,
      endColumn: msg.endColumn,
      severity: msg.severity,    // 1=warning, 2=error
      message: msg.message,
      ruleId: msg.ruleId         // which rule fired
    }));

    res.json(diagnostics);

  } catch (error) {
    // Parse error (invalid JS syntax) — return as diagnostic
    res.json([{
      line: 1,
      column: 1,
      severity: 2,
      message: `Parse error: ${error.message}`,
      ruleId: 'parse-error'
    }]);
  }
});

// Wrap Express app with native HTTP server
const server = http.createServer(app);

// Attach socket.io onto the server at /socket.io path
const io = new SocketIoServer(server, {
  path: '/socket.io',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Handle socket.io connection logic
io.on('connection', (socket) => {
  console.log(`[Socket.io] WebRTC signaling connection established: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket.io] WebRTC signaling disconnected: ${socket.id}`);
  });
});

const activeTerminalSessions = {};
// Structure per entry:
// activeTerminalSessions[sessionId] = {
//   ptyProcess: pty instance,
//   cleanupTimer: setTimeout reference | null
// }

const wssTerminal = new ws.Server({ noServer: true });
const wssYjs = new ws.Server({ noServer: true });
const wssStatus = new ws.Server({ noServer: true });

// Set up Terminal socket event handlers
wssTerminal.on('connection', (ws, request) => {
  // Extract sessionId from URL query params
  const urlParams = new URL(
    request.url, 
    `http://${request.headers.host}`
  );
  const sessionId = urlParams.searchParams.get('sessionId') 
    || `session_${Date.now()}`;

  console.log(`[Terminal] Connection for session: ${sessionId}`);

  let ptyProcess;

  if (activeTerminalSessions[sessionId]) {
    // RECONNECT PATH — existing session resume karo
    const session = activeTerminalSessions[sessionId];
    
    // Cancel pending cleanup timer
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
      console.log(`[Terminal] Cancelled cleanup for: ${sessionId}`);
    }
    
    ptyProcess = session.ptyProcess;
    
    // Remove old listeners to prevent memory leak
    ptyProcess.removeAllListeners('data');
    
    console.log(`[Terminal] Resumed session: ${sessionId}`);
    
    // Notify client of reconnection
    if (ws.readyState === ws.OPEN) {
      ws.send('\r\n\x1b[33m[Session Resumed]\x1b[0m\r\n');
    }
    
  } else {
    // NEW SESSION PATH — fresh PTY spawn karo
    ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || process.cwd(),
      env: process.env
    });
    
    activeTerminalSessions[sessionId] = {
      ptyProcess,
      cleanupTimer: null
    };
    
    console.log(`[Terminal] New session: ${sessionId}, PID: ${ptyProcess.pid}`);
  }

  // PTY output → WebSocket (both new and resumed)
  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  // WebSocket messages → PTY
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'resize') {
        ptyProcess.resize(
          Math.max(1, parsed.cols),
          Math.max(1, parsed.rows)
        );
        return;
      }
    } catch {
      // Raw keystroke
    }
    ptyProcess.write(message.toString());
  });

  // Disconnect handler — delayed cleanup
  ws.on('close', () => {
    console.log(`[Terminal] WS closed for: ${sessionId}`);
    
    if (activeTerminalSessions[sessionId]) {
      // 2 minute grace period for reconnect
      activeTerminalSessions[sessionId].cleanupTimer = setTimeout(() => {
        console.log(`[Terminal] Cleaning up session: ${sessionId}`);
        try {
          activeTerminalSessions[sessionId].ptyProcess.kill();
        } catch(e) {}
        delete activeTerminalSessions[sessionId];
      }, 120000);
    }
  });

  ws.on('error', (err) => {
    console.error(`[Terminal] WS error for ${sessionId}:`, err.message);
    try { ptyProcess.kill(); } catch(e) {}
    delete activeTerminalSessions[sessionId];
  });
});

// Set up Collaboration socket event handlers
wssYjs.on('connection', (ws, request) => {
  try {
    // Extract room ID from URL query params
    // Frontend sends: ws://localhost:3000/collab?room=roomId
    const urlParams = new URL(
      request.url,
      `http://${request.headers.host}`
    );
    const roomId = urlParams.searchParams.get('room') 
      || 'deepcode-default-room';

    console.log(`[Collab] Client connected to room: ${roomId}`);

    // setupWSConnection handles ALL Yjs sync automatically
    // It manages document state, awareness, and sync messages
    setupWSConnection(ws, request, {
      docName: roomId,
      gc: true  // garbage collect unused docs from memory
    });

  } catch (error) {
    console.error('[Collab] setupWSConnection error:', error.message);
    ws.close();
  }
});

// Set up Status socket event handlers
wssStatus.on('connection', (ws, request) => {
  console.log(`[Status] Client connected to legacy status`);
  ws.send('Legacy Status connection established');
});

// Implement path-based protocol upgrades
server.on('upgrade', (request, socket, head) => {
  const { pathname } = url.parse(request.url);

  if (pathname === '/terminal') {
    wssTerminal.handleUpgrade(request, socket, head, (wsConnection) => {
      wssTerminal.emit('connection', wsConnection, request);
    });
  } else if (pathname === '/collab') {
    wssYjs.handleUpgrade(request, socket, head, (wsConnection) => {
      wssYjs.emit('connection', wsConnection, request);
    });
  } else if (pathname === '/status') {
    wssStatus.handleUpgrade(request, socket, head, (wsConnection) => {
      wssStatus.emit('connection', wsConnection, request);
    });
  } else {
    // Other upgrades (like socket.io) are left to be handled by their own listeners
  }
});

// Start the unified single port server
server.listen(port, () => {
  console.log(`[DeepCode Server] Listening on http://localhost:${port}`);
});
