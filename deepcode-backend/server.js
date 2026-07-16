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

// Instantiate two separate ws.Server instances with noServer: true
const wssTerminal = new ws.Server({ noServer: true });
const wssYjs = new ws.Server({ noServer: true });

// Set up Terminal socket event handlers
wssTerminal.on('connection', (wsConnection) => {
  console.log('[WebSocket] Terminal client connected.');
  
  wsConnection.on('message', (message) => {
    const messageString = message.toString();
    console.log(`[WebSocket] Terminal message received: ${messageString}`);
    // Simulate terminal execution output response
    const echoResponse = JSON.stringify({
      type: 'output',
      data: `[Terminal Output] Code executed successfully!\nResult of run:\n${messageString}\n`
    });
    wsConnection.send(echoResponse);
  });

  wsConnection.on('close', () => {
    console.log('[WebSocket] Terminal client disconnected.');
  });
});

// Set up Collaboration socket event handlers
wssYjs.on('connection', (wsConnection) => {
  console.log('[WebSocket] Collab client connected.');
  
  wsConnection.on('message', (message) => {
    const messageString = message.toString();
    console.log(`[WebSocket] Collab sync event: ${messageString}`);
    wsConnection.send(`[Collab Sync Echo] Received: ${messageString}`);
  });

  wsConnection.on('close', () => {
    console.log('[WebSocket] Collab client disconnected.');
  });
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
  } else {
    // Other upgrades (like socket.io) are left to be handled by their own listeners
  }
});

// Start the unified single port server
server.listen(port, () => {
  console.log(`[DeepCode Server] Listening on http://localhost:${port}`);
});
