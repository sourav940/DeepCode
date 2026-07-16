import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { 
  Play, 
  Terminal, 
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
  const [activeTab, setActiveTab] = useState('terminal'); // 'terminal' | 'problems'
  
  // WebSocket references (Day 1 logic)
  const terminalWs = useRef(null);
  const collabWs = useRef(null);

  // Health check and WebSocket init
  useEffect(() => {
    checkHealth();
    connectWebSockets();

    return () => {
      if (terminalWs.current) terminalWs.current.close();
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
    // 1. Connect to Terminal WebSocket on path '/terminal'
    setTerminalStatus('connecting');
    logToTerminal('system', 'Connecting to Terminal socket path "/terminal"...');
    
    const wsTerm = new WebSocket(`${WS_URL}/terminal`);
    terminalWs.current = wsTerm;

    wsTerm.onopen = () => {
      setTerminalStatus('connected');
      logToTerminal('success', 'Terminal WebSocket: Connected successfully.');
    };

    wsTerm.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'output') {
          logToTerminal('output', payload.data);
        } else {
          logToTerminal('output', event.data);
        }
      } catch (e) {
        logToTerminal('output', event.data);
      }
    };

    wsTerm.onerror = () => {
      setTerminalStatus('disconnected');
      logToTerminal('error', 'Terminal WebSocket: Connection error.');
    };

    wsTerm.onclose = () => {
      setTerminalStatus('disconnected');
      logToTerminal('system', 'Terminal WebSocket: Connection closed.');
    };

    // 2. Connect to Collab WebSocket on path '/collab'
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

  // Day 1 Echo Run Code fallback
  const runCodeWebSocket = () => {
    logToTerminal('input', `> Running code snippet via /terminal socket...`);
    if (terminalWs.current && terminalWs.current.readyState === WebSocket.OPEN) {
      terminalWs.current.send(editorCode);
    } else {
      logToTerminal('error', 'Unable to run code: Terminal WebSocket is not connected.');
    }
  };

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
    if (terminalWs.current) terminalWs.current.close();
    if (collabWs.current) collabWs.current.close();
    connectWebSockets();
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
                  Terminal (ws://)
                </button>
                <button 
                  onClick={() => setActiveTab('problems')}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: activeTab === 'problems' ? 'var(--text-active)' : 'var(--text-secondary)',
                    fontWeight: activeTab === 'problems' ? 600 : 400,
                    fontSize: '12px',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: '0 4px',
                    borderBottom: activeTab === 'problems' ? '2px solid var(--accent-color)' : 'none'
                  }}
                >
                  Problems
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
              {activeTab === 'terminal' && (
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

              {activeTab === 'problems' && (
                <div style={{ padding: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)' }}>
                    <CheckCircle2 size={16} />
                    <span>No errors or warnings detected in workspace! Day 2 builds clean.</span>
                  </div>
                </div>
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
