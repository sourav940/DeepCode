import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  const [rightTab, setRightTab] = useState('terminal'); // 'terminal' | 'output'
  
  // Multi-terminal state
  const [terminals, setTerminals] = useState([
    { id: 'term-1', name: 'Terminal 1' }
  ]);
  const [activeTerminalId, setActiveTerminalId] = useState('term-1');

  // WebSocket references (Day 1 logic)
  const collabWs = useRef(null);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const debounceTimer = useRef(null);
  const activeLangRef = useRef(language);

  useEffect(() => {
    activeLangRef.current = language;
  }, [language]);

  const [diagnostics, setDiagnostics] = useState([]);

  // Per-instance refs map:
  // terminalInstancesRef.current[termId] = {
  //   xterm: Terminal,
  //   fitAddon: FitAddon,
  //   ws: WebSocket,
  //   container: div DOM ref
  // }
  const terminalInstancesRef = useRef({});
  const terminalContainersRef = useRef({});

  // Health check and WebSocket init
  useEffect(() => {
    checkHealth();
    connectWebSockets();

    return () => {
      if (collabWs.current) collabWs.current.close();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
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

  const initTerminal = useCallback((termId) => {
    // Prevent double init
    if (terminalInstancesRef.current[termId]?.xterm) return;
    
    const container = terminalContainersRef.current[termId];
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Fira Code, monospace',
      theme: {
        background: '#0d0d0d',
        foreground: '#00ff00',
        cursor: '#00ff00',
      },
      scrollback: 1000,
      convertEol: true
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    setTimeout(() => fitAddon.fit(), 100);

    // WebSocket with sessionId
    const backendUrl = import.meta.env.VITE_BACKEND_URL 
      || 'http://localhost:3000';
    const wsUrl = `${backendUrl.replace('http', 'ws')}/terminal?sessionId=${termId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setTerminalStatus('connected');
      term.writeln('\x1b[32mDeepCode Terminal Ready\x1b[0m');
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onclose = () => {
      term.writeln('\r\n\x1b[31mDisconnected\x1b[0m');
      if (Object.keys(terminalInstancesRef.current).length === 1) {
        setTerminalStatus('disconnected');
      }
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    // Store instance
    terminalInstancesRef.current[termId] = {
      xterm: term,
      fitAddon,
      ws,
      handleResize
    };
  }, []);

  useEffect(() => {
    // Small delay for DOM to render
    const timer = setTimeout(() => {
      initTerminal('term-1');
    }, 200);
    
    return () => {
      clearTimeout(timer);
      // Cleanup all terminals
      Object.entries(terminalInstancesRef.current).forEach(([id, instance]) => {
        instance.xterm?.dispose();
        instance.ws?.close();
        window.removeEventListener('resize', instance.handleResize);
      });
      terminalInstancesRef.current = {};
    };
  }, []);

  const addTerminal = () => {
    const newId = `term-${Date.now()}`;
    const newName = `Terminal ${terminals.length + 1}`;
    
    setTerminals(prev => [...prev, { id: newId, name: newName }]);
    setActiveTerminalId(newId);
    
    // Init after DOM renders new container
    setTimeout(() => initTerminal(newId), 100);
  };

  const switchTerminal = (termId) => {
    setActiveTerminalId(termId);
    // Fit after becoming visible
    setTimeout(() => {
      terminalInstancesRef.current[termId]?.fitAddon?.fit();
    }, 50);
  };

  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    setEditorCode(DEFAULT_CODE[newLang]);
    setOutput('// Output will appear here...');
    
    setDiagnostics([]);
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        monacoRef.current.editor.setModelMarkers(model, 'eslint', []);
      }
    }
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

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  const runLint = useCallback(async (code, lang) => {
    if (lang !== 'javascript') {
      if (editorRef.current && monacoRef.current) {
        monacoRef.current.editor.setModelMarkers(
          editorRef.current.getModel(), 'eslint', []
        );
      }
      setDiagnostics([]);
      return;
    }

    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BACKEND_URL || 
          'http://localhost:3000'}/api/lint`,
        { code, language: lang }
      );

      if (lang !== activeLangRef.current) return;

      const results = response.data;
      setDiagnostics(results);

      if (editorRef.current && monacoRef.current) {
        const model = editorRef.current.getModel();
        if (!model) return;

        const monaco = monacoRef.current;
        const markers = results.map(d => ({
          startLineNumber: d.line,
          startColumn: d.column,
          endLineNumber: d.endLine || d.line,
          endColumn: d.endColumn || Number.MAX_SAFE_INTEGER,
          message: `${d.message} (${d.ruleId})`,
          severity: d.severity === 2
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning
        }));

        monaco.editor.setModelMarkers(
          model,
          'eslint',
          markers
        );
      }
    } catch (err) {
      console.error('[Lint]', err.message);
    }
  }, []);

  const handleEditorChange = (value) => {
    const newCode = value || '';
    setEditorCode(newCode);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      runLint(newCode, language);
    }, 500);
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
                onChange={handleEditorChange}
                onMount={handleEditorDidMount}
                theme="vs-dark"
                options={{
                  fontSize: 14,
                  fontFamily: 'Fira Code, monospace',
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true
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
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              
              {/* Tab bar */}
              <div style={{ display: 'flex', alignItems: 'center', 
                            borderBottom: '1px solid #1e2433',
                            backgroundColor: '#07090c' }}>
                
                {/* Main tabs: Terminal | Output */}
                <button onClick={() => setRightTab('terminal')}
                  style={{ 
                    backgroundColor: 'transparent',
                    border: 'none',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontWeight: rightTab === 'terminal' ? 'bold' : 'normal',
                    color: rightTab==='terminal' ? '#6366f1' : '#64748b' 
                  }}>
                  Terminal
                </button>
                <button onClick={() => setRightTab('output')}
                  style={{ 
                    backgroundColor: 'transparent',
                    border: 'none',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontWeight: rightTab === 'output' ? 'bold' : 'normal',
                    color: rightTab==='output' ? '#6366f1' : '#64748b' 
                  }}>
                  Output
                </button>
                <button onClick={() => setRightTab('problems')}
                  style={{ 
                    backgroundColor: 'transparent',
                    border: 'none',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontWeight: rightTab === 'problems' ? 'bold' : 'normal',
                    color: rightTab==='problems' ? '#6366f1' : '#64748b'
                  }}>
                  Problems {diagnostics.length > 0 
                    ? `(${diagnostics.length})` : ''}
                </button>
                
                {/* Terminal instance tabs (only when Terminal tab active) */}
                {rightTab === 'terminal' && (
                  <>
                    {terminals.map(term => (
                      <button
                        key={term.id}
                        onClick={() => switchTerminal(term.id)}
                        style={{
                          backgroundColor: activeTerminalId === term.id ? '#1e2433' : 'transparent',
                          border: '1px solid #1e2433',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          color: activeTerminalId === term.id ? '#10b981' : '#64748b',
                          fontSize: '11px',
                          padding: '2px 8px',
                          marginRight: '4px'
                        }}>
                        {term.name}
                      </button>
                    ))}
                    {/* Add new terminal button */}
                    <button
                      onClick={addTerminal}
                      title="New Terminal"
                      style={{ 
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#6366f1', 
                        fontWeight: 'bold',
                        padding: '2px 8px' 
                      }}>
                      +
                    </button>
                  </>
                )}
                
                {/* Run Code button — right side */}
                <button
                  onClick={handleRunCode}
                  disabled={isRunning}
                  style={{ 
                    marginLeft: 'auto',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 'bold',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    opacity: isRunning ? 0.6 : 1,
                    marginRight: '8px'
                  }}>
                  {isRunning ? '⏳ Running...' : '▶ Run Code'}
                </button>
              </div>

              {/* Terminal containers — ALL mounted, toggle visibility */}
              <div style={{ 
                flex: 1, 
                display: rightTab === 'terminal' ? 'block' : 'none',
                position: 'relative' 
              }}>
                {terminals.map(term => (
                  <div
                    key={term.id}
                    ref={el => terminalContainersRef.current[term.id] = el}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: activeTerminalId === term.id ? 'block' : 'none',
                      backgroundColor: '#0d0d0d'
                    }}
                  />
                ))}
              </div>

              {/* Output tab */}
              {rightTab === 'output' && (
                <pre style={{
                  flex: 1,
                  fontFamily: 'Fira Code, monospace',
                  color: output.startsWith('❌') ? '#ef4444' : '#10b981',
                  whiteSpace: 'pre-wrap',
                  padding: '12px',
                  overflow: 'auto',
                  margin: 0
                }}>
                  {output}
                </pre>
              )}

              {/* Problems tab content */}
              {rightTab === 'problems' && (
                <div style={{
                  height: '100%',
                  overflow: 'auto',
                  padding: '8px',
                  fontFamily: 'Fira Code, monospace',
                  fontSize: '12px'
                }}>
                  {diagnostics.length === 0 ? (
                    <div style={{ color: '#10b981', padding: '8px' }}>
                      ✅ No issues found
                    </div>
                  ) : (
                    diagnostics.map((d, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          editorRef.current?.revealLineInCenter(d.line);
                          editorRef.current?.setPosition({
                            lineNumber: d.line,
                            column: d.column
                          });
                        }}
                        style={{
                          display: 'flex',
                          gap: '8px',
                          padding: '4px 8px',
                          marginBottom: '2px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          backgroundColor: 'rgba(255,255,255,0.03)',
                          borderLeft: `3px solid ${
                            d.severity === 2 ? '#ef4444' : '#f59e0b'
                          }`
                        }}
                      >
                        <span style={{
                          color: d.severity === 2 ? '#ef4444' : '#f59e0b',
                          minWidth: '55px',
                          fontSize: '11px'
                        }}>
                          {d.severity === 2 ? '● Error' : '⚠ Warn'}
                        </span>
                        <span style={{ color: '#cbd5e1', flex: 1 }}>
                          {d.message}
                        </span>
                        <span style={{ color: '#475569', fontSize: '11px' }}>
                          Ln {d.line}
                        </span>
                      </div>
                    ))
                  )}
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
