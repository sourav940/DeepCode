import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { 
  Play, 
  RefreshCw, 
  Layers, 
  Users, 
  FolderTree, 
  Search, 
  Settings, 
  HelpCircle, 
  CheckCircle2, 
  XCircle,
  Code2,
  FileCode,
  TerminalSquare
} from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

// Convert http/https URL to ws/wss dynamically
const getWsUrl = (backendUrl) => {
  try {
    const parsed = new URL(backendUrl);
    const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${parsed.host}`;
  } catch (e) {
    return backendUrl.replace(/^http/, 'ws');
  }
};
const WS_URL = getWsUrl(BACKEND_URL);

const DEFAULT_CODE = {
  python: `# DeepCode Python Sandbox\nprint("Hello from DeepCode!")\n\nfor i in range(5):\n    print(f"Line {i+1}")`,
  javascript: `// DeepCode JS Sandbox\nconsole.log("Hello from DeepCode!");\n\nfor(let i=1; i<=5; i++) {\n  console.log(\`Line \${i}\`);\n}`
};

export default function App() {
  const [language, setLanguage] = useState('python');
  const [output, setOutput] = useState('// Output will appear here...');
  const [isRunning, setIsRunning] = useState(false);
  const [editorCode, setEditorCode] = useState(DEFAULT_CODE.python);
  
  // Connection states (Day 1 logic)
  const [apiStatus, setApiStatus] = useState('connecting'); // 'connected' | 'disconnected' | 'connecting'
  const [terminalStatus, setTerminalStatus] = useState('connecting');
  const [collabStatus, setCollabStatus] = useState('connecting');
  
  const [terminalLogs, setTerminalLogs] = useState([
    { type: 'system', text: 'Initializing DeepCode Workspace...' },
    { type: 'system', text: 'Day 2 System diagnostics running...' }
  ]);
  const [activeTab, setActiveTab] = useState('output'); // 'terminal' | 'output'
  
  // WebSocket references (Day 1 logic)
  const collabWs = useRef(null);

  // Refs for xterm (Day 3 logic)
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const terminalWsRef = useRef(null);

  // Health check and WebSocket init
  useEffect(() => {
    checkHealth();
    connectWebSockets();

    return () => {
      if (collabWs.current) collabWs.current.close();
    };
  }, []);

  const checkHealth = async () => {
    setApiStatus('connecting');
    try {
      const response = await axios.get(`${BACKEND_URL}/api/health`);
      if (response.data && response.data.status === 'healthy') {
        setApiStatus('connected');
        logToTerminal('system', `API Health Check: Connected. Message: "${response.data.message}"`);
      } else {
        setApiStatus('disconnected');
      }
    } catch (err) {
      setApiStatus('disconnected');
      logToTerminal('error', 'API Health Check: Failed to reach backend API endpoint /api/health');
    }
  };

  const connectWebSockets = () => {
    // Connect to Collab WebSocket on path '/collab'
    setCollabStatus('connecting');
    logToTerminal('system', 'Connecting to Collab socket path "/collab"...');
    
    const wsCollab = new WebSocket(`${WS_URL}/collab`);
    collabWs.current = wsCollab;

    wsCollab.onopen = () => {
      setCollabStatus('connected');
      logToTerminal('success', 'Collab WebSocket: Connected successfully.');
    };

    wsCollab.onmessage = (event) => {
      logToTerminal('collab', `[Collab Event] ${event.data}`);
    };

    wsCollab.onerror = () => {
      setCollabStatus('disconnected');
      logToTerminal('error', 'Collab WebSocket: Connection error.');
    };

    wsCollab.onclose = () => {
      setCollabStatus('disconnected');
      logToTerminal('system', 'Collab WebSocket: Connection closed.');
    };
  };

  const logToTerminal = (type, text) => {
    setTerminalLogs(prev => [...prev, { type, text, timestamp: new Date().toLocaleTimeString() }]);
  };

  const [reconnectKey, setReconnectKey] = useState(0);

  // Day 3: Separate useEffect for xterm terminal setup
  useEffect(() => {
    // Wait for ref to be available
    if (!terminalRef.current) return;
    
    // Prevent double init in React StrictMode
    if (xtermRef.current) return;

    // Initialize xterm
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Fira Code, monospace',
      theme: {
        background: '#0d0d0d',
        foreground: '#00ff00',
        cursor: '#00ff00',
        selection: 'rgba(0, 255, 0, 0.2)'
      },
      scrollback: 1000,
      convertEol: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    // Small delay for proper sizing
    setTimeout(() => fitAddon.fit(), 100);
    
    xtermRef.current = term;

    // Connect to backend /terminal WebSocket
    const wsUrl = `${(import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000')
      .replace('http', 'ws')}/terminal`;
    
    const termWs = new WebSocket(wsUrl);
    terminalWsRef.current = termWs;

    termWs.onopen = () => {
      console.log('[xterm] Terminal WebSocket connected');
      setTerminalStatus('connected');
      setActiveTab('terminal');
      term.writeln('\x1b[32mDeepCode Terminal Ready\x1b[0m');
      term.writeln('\x1b[90mConnected to backend shell...\x1b[0m');
    };

    // Backend PTY data → xterm display
    termWs.onmessage = (event) => {
      term.write(event.data);
    };

    termWs.onclose = () => {
      setTerminalStatus('disconnected');
      term.writeln('\r\n\x1b[31mTerminal disconnected\x1b[0m');
    };

    termWs.onerror = () => {
      setTerminalStatus('disconnected');
    };

    // User typing → backend PTY
    term.onData((data) => {
      if (termWs.readyState === WebSocket.OPEN) {
        termWs.send(data);
      }
    });

    // Handle terminal resize
    term.onResize(({ cols, rows }) => {
      if (termWs.readyState === WebSocket.OPEN) {
        termWs.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Handle window resize
    const handleResize = () => {
      if (fitAddon) fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      termWs.close();
      xtermRef.current = null;
    };
  }, [terminalRef.current, reconnectKey]);

  // Trigger resize of xterm container when activeTab changes to 'terminal'
  useEffect(() => {
    if (activeTab === 'terminal') {
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
    }
  }, [activeTab]);

  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    setEditorCode(DEFAULT_CODE[newLang]);
    setOutput('// Output will appear here...');
  };

  const handleRunCode = async () => {
    setIsRunning(true);
    setOutput('⏳ Running code...');
    try {
      const response = await axios.post(
        `${BACKEND_URL}/api/execute`,
        { code: editorCode, language, stdin: '' }
      );
      const { stdout, stderr, status } = response.data;
      if (stderr && stderr.trim()) {
        setOutput(`❌ Error:\n${stderr}`);
      } else {
        setOutput(`✅ ${status}\n\n${stdout}`);
      }
    } catch (err) {
      setOutput(`❌ Network Error: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const clearConsole = () => {
    setOutput('// Output will appear here...');
  };

  const reconnectAll = () => {
    checkHealth();
    if (collabWs.current) collabWs.current.close();
    connectWebSockets();
    setReconnectKey(prev => prev + 1);
  };

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: 'var(--bg-app)' }}>
      
      {/* 1. HEADER */}
      <header style={{
        height: 'var(--header-height)',
        borderBottom: '1px solid var(--border-color)',
        backgroundColor: 'var(--bg-sidebar)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        userSelect: 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Code2 size={24} style={{ color: 'var(--accent-color)' }} />
          <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '0.5px' }}>
            DeepCode <span style={{ fontWeight: 300, color: 'var(--text-secondary)' }}>Cloud IDE</span>
          </span>
          <span style={{
            fontSize: '11px',
            backgroundColor: 'var(--border-color)',
            color: 'var(--text-secondary)',
            padding: '2px 6px',
            borderRadius: '4px',
            marginLeft: '8px',
            fontWeight: 500
          }}>Day 2 Execution</span>
          
          <select 
            value={language} 
            onChange={(e) => handleLanguageChange(e.target.value)}
            style={{
              backgroundColor: '#1e2433',
              color: 'white',
              border: '1px solid #3b82f6',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '12px',
              outline: 'none',
              cursor: 'pointer',
              marginLeft: '12px'
            }}
          >
            <option value="python">Python 3</option>
            <option value="javascript">JavaScript (Node)</option>
          </select>
        </div>

        {/* Dynamic Service Status Indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          
          {/* API Health */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>REST API:</span>
            <span className={`status-indicator ${apiStatus}`}></span>
            <span style={{ 
              fontWeight: 500, 
              color: apiStatus === 'connected' ? 'var(--text-active)' : 'var(--text-secondary)',
              fontSize: '12px'
            }}>
              {apiStatus.toUpperCase()}
            </span>
          </div>

          {/* Terminal Socket */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Terminal WS:</span>
            <span className={`status-indicator ${terminalStatus}`}></span>
            <span style={{ 
              fontWeight: 500, 
              color: terminalStatus === 'connected' ? 'var(--text-active)' : 'var(--text-secondary)',
              fontSize: '12px'
            }}>
              {terminalStatus.toUpperCase()}
            </span>
          </div>

          {/* Collab Socket */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Collab WS:</span>
            <span className={`status-indicator ${collabStatus}`}></span>
            <span style={{ 
              fontWeight: 500, 
              color: collabStatus === 'connected' ? 'var(--text-active)' : 'var(--text-secondary)',
              fontSize: '12px'
            }}>
              {collabStatus.toUpperCase()}
            </span>
          </div>

          {/* Reconnect button */}
          <button 
            onClick={reconnectAll}
            style={{
              backgroundColor: 'transparent',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--border-color)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            title="Retry connections"
          >
            <RefreshCw size={14} />
            <span>Reconnect</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN CORE LAYOUT */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Toolbar (Sidebar) */}
        <div style={{
          width: 'var(--sidebar-width)',
          backgroundColor: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '16px 0',
          justifyContent: 'space-between',
          userSelect: 'none'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center', width: '100%' }}>
            
            {/* Active Icon indicator */}
            <div style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              borderLeft: '2px solid var(--accent-color)',
              color: 'var(--text-active)',
              cursor: 'pointer'
            }} title="Explorer">
              <FolderTree size={22} />
            </div>

            <div style={{ color: 'var(--text-secondary)', cursor: 'pointer', transition: 'color 0.2s' }} 
                 onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-active)'}
                 onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                 title="Search">
              <Search size={22} />
            </div>

            <div style={{ color: 'var(--text-secondary)', cursor: 'pointer', transition: 'color 0.2s' }}
                 onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-active)'}
                 onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                 title="Collaboration Sync">
              <Users size={22} />
            </div>

            <div style={{ color: 'var(--text-secondary)', cursor: 'pointer', transition: 'color 0.2s' }}
                 onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-active)'}
                 onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                 title="Layers & Infrastructure">
              <Layers size={22} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
            <div style={{ color: 'var(--text-secondary)', cursor: 'pointer' }} title="Settings">
              <Settings size={22} />
            </div>
            <div style={{ color: 'var(--text-secondary)', cursor: 'pointer' }} title="Help">
              <HelpCircle size={22} />
            </div>
          </div>
        </div>

        {/* Workspace Split Layout */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          
          {/* LEFT PANE: MONACO EDITOR */}
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            backgroundColor: 'var(--bg-editor)',
            borderRight: '1px solid var(--border-color)'
          }}>
            {/* Editor tab header */}
            <div style={{ 
              height: '35px', 
              backgroundColor: 'var(--bg-sidebar)', 
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '12px'
            }}>
              <div style={{
                backgroundColor: 'var(--bg-editor)',
                height: '100%',
                padding: '0 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderTop: '2px solid var(--accent-color)',
                fontSize: '13px',
                fontWeight: 500
              }}>
                <FileCode size={14} style={{ color: language === 'javascript' ? '#f7df1e' : '#e28743' }} />
                <span>{language === 'javascript' ? 'main.js' : 'main.py'}</span>
              </div>
            </div>
            
            {/* Editor workspace */}
            <div style={{ flex: 1, paddingTop: '10px' }}>
              <Editor
                height="100%"
                language={language}
                value={editorCode}
                onChange={(value) => setEditorCode(value || '')}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontFamily: 'Fira Code',
                  lineNumbers: 'on',
                  automaticLayout: true,
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            </div>
          </div>

          {/* RIGHT PANE: TERMINAL PANEL */}
          <div style={{ 
            width: '45%', 
            display: 'flex', 
            flexDirection: 'column', 
            backgroundColor: 'var(--bg-panel)' 
          }}>
            
            {/* Terminal Actions Bar */}
            <div style={{
              height: '35px',
              backgroundColor: 'var(--bg-sidebar)',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px',
              userSelect: 'none'
            }}>
              <div style={{ display: 'flex', gap: '16px', height: '100%' }}>
                <button 
                  onClick={() => setActiveTab('terminal')}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: activeTab === 'terminal' ? 'var(--text-active)' : 'var(--text-secondary)',
                    fontWeight: activeTab === 'terminal' ? 600 : 400,
                    fontSize: '12px',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: '0 4px',
                    borderBottom: activeTab === 'terminal' ? '2px solid var(--accent-color)' : 'none'
                  }}
                >
                  Terminal
                </button>
                <button 
                  onClick={() => setActiveTab('output')}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: activeTab === 'output' ? 'var(--text-active)' : 'var(--text-secondary)',
                    fontWeight: activeTab === 'output' ? 600 : 400,
                    fontSize: '12px',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: '0 4px',
                    borderBottom: activeTab === 'output' ? '2px solid var(--accent-color)' : 'none'
                  }}
                >
                  Output
                </button>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={clearConsole}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                >
                  Clear Console
                </button>
                
                <button
                  onClick={handleRunCode}
                  disabled={isRunning}
                  className="btn-run"
                  style={{
                    backgroundColor: 'var(--success)',
                    color: '#fff',
                    border: 'none',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    padding: '4px 10px',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
                    opacity: isRunning ? 0.6 : 1
                  }}
                  onMouseEnter={(e) => {
                    if (!isRunning) e.currentTarget.style.backgroundColor = 'var(--success-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isRunning) e.currentTarget.style.backgroundColor = 'var(--success)';
                  }}
                >
                  <Play size={12} fill="#fff" />
                  <span>{isRunning ? '⏳ Running...' : '▶ Run Code'}</span>
                </button>
              </div>
            </div>

            {/* Terminal Console Windows */}
            <div style={{
              flex: 1,
              backgroundColor: '#07090d',
              overflow: 'hidden'
            }}>
              {/* Terminal Tab Container (always mounted for xterm to load) */}
              <div 
                ref={terminalRef}
                style={{
                  height: '100%',
                  width: '100%',
                  backgroundColor: '#0d0d0d',
                  padding: '4px',
                  display: activeTab === 'terminal' ? 'block' : 'none'
                }}
              />

              {/* Output Tab Container */}
              {activeTab === 'output' && (
                <pre style={{
                  fontFamily: 'Fira Code, monospace',
                  color: output.startsWith('❌') ? '#ef4444' : '#10b981',
                  whiteSpace: 'pre-wrap',
                  padding: '12px',
                  margin: 0,
                  height: '100%',
                  overflow: 'auto'
                }}>
                  {output}
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. STATUS BAR (FOOTER) */}
      <footer style={{
        height: 'var(--statusbar-height)',
        backgroundColor: 'var(--bg-statusbar)',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        userSelect: 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            backgroundColor: 'var(--accent-color)',
            color: '#fff',
            padding: '0 8px',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            fontWeight: 600
          }}>
            SYSTEM: OK
          </div>
          <span>Workspace: sourav940/DeepCode</span>
          <span>Branch: main</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span>Ln 1, Col 1</span>
          <span>Spaces: 4</span>
          <span>UTF-8</span>
          <span>{language === 'javascript' ? 'JavaScript (Node)' : 'Python 3.10'}</span>
        </div>
      </footer>
    </div>
  );
}
