import { useState, useRef, useEffect, useCallback } from 'react';
import { AGENTS, AGENT_LIST } from './agents';
import { callAgent, routeRequest } from './api';
import { loadShows, saveShows, formatShowsForAgents } from './shows';
import './App.css';

const APP_PASSWORD = 'Norchester943';

const EMPTY_SHOW = { date: '', venue: '', city: '', state: '', showTimes: '', ticketLink: '', dealType: '', guarantee: '', notes: '' };

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => sessionStorage.getItem('heffron_auth') === 'true');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [apiKey, setApiKey] = useState(() => localStorage.getItem('heffron_api_key') || '');
  const [showKeyModal, setShowKeyModal] = useState(() => !localStorage.getItem('heffron_api_key'));
  const [keyInput, setKeyInput] = useState('');

  const [shows, setShows] = useState(loadShows);
  const [showsPanel, setShowsPanel] = useState(false);
  const [editingShow, setEditingShow] = useState(null);
  const [showForm, setShowForm] = useState(EMPTY_SHOW);

  const [selectedAgent, setSelectedAgent] = useState('DISPATCH');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipeline, setPipeline] = useState(null);
  const [activeAgents, setActiveAgents] = useState(new Set());

  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveApiKey = () => {
    if (!keyInput.trim()) return;
    localStorage.setItem('heffron_api_key', keyInput.trim());
    setApiKey(keyInput.trim());
    setShowKeyModal(false);
  };

  const addMessage = useCallback((msg) => {
    setMessages(prev => [...prev, { ...msg, id: Date.now() + Math.random() }]);
  }, []);

  const showContext = formatShowsForAgents(shows);

  const addShow = () => {
    if (!showForm.date || !showForm.venue || !showForm.city) return;
    const newShow = { ...showForm, id: Date.now() };
    const updated = [...shows, newShow].sort((a, b) => new Date(a.date) - new Date(b.date));
    setShows(updated);
    saveShows(updated);
    setShowForm(EMPTY_SHOW);
    setEditingShow(null);
  };

  const updateShow = () => {
    const updated = shows.map(s => s.id === editingShow ? { ...showForm, id: editingShow } : s);
    setShows(updated);
    saveShows(updated);
    setShowForm(EMPTY_SHOW);
    setEditingShow(null);
  };

  const deleteShow = (id) => {
    const updated = shows.filter(s => s.id !== id);
    setShows(updated);
    saveShows(updated);
  };

  const startEdit = (show) => {
    setEditingShow(show.id);
    setShowForm({ ...show });
  };

  const cancelEdit = () => {
    setEditingShow(null);
    setShowForm(EMPTY_SHOW);
  };

  const handleSubmit = async (text) => {
    const userText = text || input.trim();
    if (!userText || isProcessing) return;

    setInput('');
    setIsProcessing(true);

    addMessage({ role: 'user', content: userText });

    const agent = AGENTS[selectedAgent];

    if (selectedAgent === 'DISPATCH') {
      // DISPATCH mode: route to multiple agents
      await runDispatchWorkflow(userText);
    } else {
      // Direct agent mode: run single agent + gatekeeper
      await runSingleAgent(selectedAgent, userText);
    }

    setIsProcessing(false);
    setPipeline(null);
    setActiveAgents(new Set());
  };

  const runDispatchWorkflow = async (userText) => {
    // Step 1: Ask DISPATCH to route
    setPipeline({ steps: [{ agent: 'DISPATCH', status: 'active' }] });
    setActiveAgents(new Set(['DISPATCH']));

    addMessage({
      role: 'agent',
      agent: 'DISPATCH',
      content: 'Analyzing your request and building the activation plan...',
      isThinking: true,
    });

    const routing = await routeRequest(apiKey, userText, showContext);

    // Remove thinking message
    setMessages(prev => prev.filter(m => !m.isThinking));

    if (routing.error) {
      addMessage({ role: 'agent', agent: 'DISPATCH', content: `Error: ${routing.error}` });
      return;
    }

    // Show the activation plan
    const planText = formatActivationPlan(routing);
    addMessage({ role: 'agent', agent: 'DISPATCH', content: planText });

    // Step 2: Run each agent in sequence
    const agentResults = {};
    const agentsToRun = routing.agents || [];

    // Build pipeline display
    const pipelineSteps = agentsToRun.map(a => ({ agent: a, status: 'pending' }));
    pipelineSteps.push({ agent: 'GATEKEEPER', status: 'pending' });
    setPipeline({ steps: pipelineSteps });

    for (const codename of agentsToRun) {
      if (codename === 'GATEKEEPER') continue; // runs last

      setPipeline(prev => ({
        steps: prev.steps.map(s =>
          s.agent === codename ? { ...s, status: 'active' } : s
        )
      }));
      setActiveAgents(prev => new Set([...prev, codename]));

      const agentDef = AGENTS[codename];
      if (!agentDef) continue;

      const taskInfo = routing.sequence?.find(s => s.agent === codename);
      const agentPrompt = taskInfo
        ? `${userText}\n\nSpecific task: ${taskInfo.task}`
        : userText;

      addMessage({
        role: 'agent',
        agent: codename,
        content: `Working on it...`,
        isThinking: true,
      });

      const result = await callAgent(apiKey, codename, agentPrompt, showContext);

      setMessages(prev => prev.filter(m => !(m.isThinking && m.agent === codename)));

      agentResults[codename] = result;
      addMessage({ role: 'agent', agent: codename, content: result });

      setPipeline(prev => ({
        steps: prev.steps.map(s =>
          s.agent === codename ? { ...s, status: 'done' } : s
        )
      }));
    }

    // Step 3: GATEKEEPER review
    if (Object.keys(agentResults).length > 0) {
      setPipeline(prev => ({
        steps: prev.steps.map(s =>
          s.agent === 'GATEKEEPER' ? { ...s, status: 'active' } : s
        )
      }));
      setActiveAgents(prev => new Set([...prev, 'GATEKEEPER']));

      addMessage({
        role: 'agent',
        agent: 'GATEKEEPER',
        content: 'Reviewing all outputs...',
        isThinking: true,
      });

      const allContent = Object.entries(agentResults)
        .map(([agent, content]) => `--- ${agent} OUTPUT ---\n${content}`)
        .join('\n\n');

      const review = await callAgent(
        apiKey,
        'GATEKEEPER',
        `Review the following content outputs for brand compliance:\n\n${allContent}`,
        showContext
      );

      setMessages(prev => prev.filter(m => !(m.isThinking && m.agent === 'GATEKEEPER')));
      addMessage({ role: 'agent', agent: 'GATEKEEPER', content: review, isReview: true });

      setPipeline(prev => ({
        steps: prev.steps.map(s =>
          s.agent === 'GATEKEEPER' ? { ...s, status: 'done' } : s
        )
      }));
    }
  };

  const runSingleAgent = async (codename, userText) => {
    const pipelineSteps = [
      { agent: codename, status: 'active' },
      { agent: 'GATEKEEPER', status: 'pending' },
    ];
    setPipeline({ steps: pipelineSteps });
    setActiveAgents(new Set([codename]));

    addMessage({
      role: 'agent',
      agent: codename,
      content: 'Working on it...',
      isThinking: true,
    });

    const result = await callAgent(apiKey, codename, userText, showContext);

    setMessages(prev => prev.filter(m => !(m.isThinking && m.agent === codename)));
    addMessage({ role: 'agent', agent: codename, content: result });

    setPipeline(prev => ({
      steps: prev.steps.map(s =>
        s.agent === codename ? { ...s, status: 'done' } :
        s.agent === 'GATEKEEPER' ? { ...s, status: 'active' } : s
      )
    }));
    setActiveAgents(prev => new Set([...prev, 'GATEKEEPER']));

    // Auto-run GATEKEEPER unless we ARE the gatekeeper
    if (codename !== 'GATEKEEPER' && codename !== 'LEDGER' && codename !== 'DISPATCH') {
      addMessage({
        role: 'agent',
        agent: 'GATEKEEPER',
        content: 'Reviewing output...',
        isThinking: true,
      });

      const review = await callAgent(
        apiKey,
        'GATEKEEPER',
        `Review the following ${AGENTS[codename].name} output for brand compliance:\n\n${result}`,
        showContext
      );

      setMessages(prev => prev.filter(m => !(m.isThinking && m.agent === 'GATEKEEPER')));
      addMessage({ role: 'agent', agent: 'GATEKEEPER', content: review, isReview: true });
    }

    setPipeline(prev => ({
      steps: prev.steps.map(s => ({ ...s, status: 'done' }))
    }));
  };

  const formatActivationPlan = (routing) => {
    let plan = `### Mission Brief\n\n`;
    plan += `**Assessment:** ${routing.assessment || 'Processing request...'}\n\n`;
    plan += `**Agents Activating:** ${(routing.agents || []).join(' → ')}`;
    if (routing.agents?.length > 0) {
      plan += ` → GATEKEEPER`;
    }
    plan += `\n\n`;
    if (routing.sequence?.length) {
      plan += `**Sequence:**\n`;
      routing.sequence.forEach((step, i) => {
        plan += `${i + 1}. **${step.agent}** — ${step.task}\n`;
      });
    }
    if (routing.manual_tasks?.length) {
      plan += `\n**Manual Tasks:**\n`;
      routing.manual_tasks.forEach(t => {
        plan += `- ${t}\n`;
      });
    }
    return plan;
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaInput = (e) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const quickActions = [
    { label: 'Show in Cincinnati, April 5', agent: 'DISPATCH' },
    { label: 'Write a reel about phone settings', agent: 'CLIPSHOT' },
    { label: '10 content ideas this week', agent: 'PULSE' },
    { label: 'Promo kit: Zanies Nashville June 7', agent: 'MARQUEE' },
    { label: 'Parse a deal: $7500 guarantee + SOB', agent: 'LEDGER' },
  ];

  const handleLogin = () => {
    if (passwordInput === APP_PASSWORD) {
      sessionStorage.setItem('heffron_auth', 'true');
      setIsAuthenticated(true);
      setPasswordError('');
    } else {
      setPasswordError('Wrong password.');
      setPasswordInput('');
    }
  };

  const currentAgent = AGENTS[selectedAgent];

  if (!isAuthenticated) {
    return (
      <div className="app login-screen">
        <div className="login-box">
          <h1>HEFFRON</h1>
          <div className="login-subtitle">Command Center</div>
          <input
            type="password"
            placeholder="Enter password"
            value={passwordInput}
            onChange={e => setPasswordInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            autoFocus
          />
          {passwordError && <div className="login-error">{passwordError}</div>}
          <button className="modal-btn" onClick={handleLogin} disabled={!passwordInput}>
            Enter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* API Key Modal */}
      {showKeyModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Anthropic API Key</h2>
            <p>
              Enter your Anthropic API key to power the agents. Your key stays in your browser's local storage and is only sent directly to Anthropic's API.
            </p>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveApiKey()}
              autoFocus
            />
            <button className="modal-btn" onClick={saveApiKey} disabled={!keyInput.trim()}>
              Save & Start
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>HEFFRON</h1>
          <div className="subtitle">Command Center</div>
        </div>
        <div className="agent-list">
          <div className="agent-list-label">Agents</div>
          {AGENT_LIST.map(agent => (
            <button
              key={agent.codename}
              className={`agent-btn ${selectedAgent === agent.codename ? 'active' : ''}`}
              onClick={() => setSelectedAgent(agent.codename)}
            >
              <span className="agent-icon">{agent.icon}</span>
              <div className="agent-info">
                <div className="agent-name">{agent.name}</div>
                <div className="agent-codename">{agent.codename}</div>
              </div>
              <div className={`agent-indicator ${activeAgents.has(agent.codename) ? 'active' : ''}`} />
            </button>
          ))}
        </div>
        <div className="sidebar-footer">
          <button className="shows-toggle-btn" onClick={() => setShowsPanel(!showsPanel)}>
            📅 Shows ({shows.length})
          </button>
        </div>
      </aside>

      {/* Shows Panel */}
      {showsPanel && (
        <div className="shows-panel">
          <div className="shows-panel-header">
            <h2>Show Dates</h2>
            <button className="shows-close-btn" onClick={() => setShowsPanel(false)}>✕</button>
          </div>

          <div className="show-form">
            <div className="show-form-row">
              <input type="date" value={showForm.date} onChange={e => setShowForm({...showForm, date: e.target.value})} />
              <input placeholder="Venue" value={showForm.venue} onChange={e => setShowForm({...showForm, venue: e.target.value})} />
            </div>
            <div className="show-form-row">
              <input placeholder="City" value={showForm.city} onChange={e => setShowForm({...showForm, city: e.target.value})} />
              <input placeholder="State" value={showForm.state} onChange={e => setShowForm({...showForm, state: e.target.value})} />
            </div>
            <div className="show-form-row">
              <input placeholder="Show times (e.g. 7pm & 9:30pm)" value={showForm.showTimes} onChange={e => setShowForm({...showForm, showTimes: e.target.value})} />
              <input placeholder="Ticket link" value={showForm.ticketLink} onChange={e => setShowForm({...showForm, ticketLink: e.target.value})} />
            </div>
            <div className="show-form-row">
              <select value={showForm.dealType} onChange={e => setShowForm({...showForm, dealType: e.target.value})}>
                <option value="">Deal type...</option>
                <option value="Guarantee">Guarantee</option>
                <option value="SOB">Split Over Breakeven</option>
                <option value="GBOR">Gross Box Office Revenue</option>
                <option value="Door Deal">Door Deal</option>
                <option value="Aggregate Bonus">Aggregate Bonus</option>
                <option value="Travel Buyout">Travel Buyout</option>
              </select>
              <input placeholder="Guarantee $" type="number" value={showForm.guarantee} onChange={e => setShowForm({...showForm, guarantee: e.target.value})} />
            </div>
            <input className="show-form-full" placeholder="Notes" value={showForm.notes} onChange={e => setShowForm({...showForm, notes: e.target.value})} />
            <div className="show-form-actions">
              {editingShow ? (
                <>
                  <button className="modal-btn" onClick={updateShow}>Update</button>
                  <button className="show-cancel-btn" onClick={cancelEdit}>Cancel</button>
                </>
              ) : (
                <button className="modal-btn" onClick={addShow} disabled={!showForm.date || !showForm.venue || !showForm.city}>
                  Add Show
                </button>
              )}
            </div>
          </div>

          <div className="shows-list">
            {shows.length === 0 && <div className="shows-empty">No shows added yet.</div>}
            {shows.sort((a, b) => new Date(a.date) - new Date(b.date)).map(show => (
              <div key={show.id} className={`show-card ${new Date(show.date) < new Date(new Date().toDateString()) ? 'past' : ''}`}>
                <div className="show-card-date">{new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                <div className="show-card-venue">{show.venue}</div>
                <div className="show-card-location">{show.city}, {show.state}</div>
                {show.showTimes && <div className="show-card-detail">{show.showTimes}</div>}
                {show.dealType && <div className="show-card-detail">{show.dealType}{show.guarantee ? ` — $${Number(show.guarantee).toLocaleString()}` : ''}</div>}
                {show.notes && <div className="show-card-notes">{show.notes}</div>}
                <div className="show-card-actions">
                  <button onClick={() => startEdit(show)}>Edit</button>
                  <button onClick={() => deleteShow(show.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="main">
        {/* Top Bar */}
        <div className="topbar">
          <div className="topbar-agent">
            <span className="topbar-agent-icon">{currentAgent.icon}</span>
            <div>
              <div className="topbar-agent-name">{currentAgent.name}</div>
              <div className="topbar-agent-desc">{currentAgent.description}</div>
            </div>
          </div>
          <div className="topbar-status">
            <div className={`status-dot ${isProcessing ? 'processing' : ''}`} />
            {isProcessing ? 'Processing...' : 'Ready'}
          </div>
        </div>

        {/* Pipeline Display */}
        {pipeline && (
          <div className="pipeline fade-in">
            <div className="pipeline-title">Agent Pipeline</div>
            <div className="pipeline-steps">
              {pipeline.steps.map((step, i) => (
                <span key={step.agent}>
                  {i > 0 && <span className="pipeline-arrow"> → </span>}
                  <span className={`pipeline-step ${step.status}`}>
                    {AGENTS[step.agent]?.icon} {step.agent}
                    {step.status === 'active' && ' ⏳'}
                    {step.status === 'done' && ' ✓'}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div className="chat-area">
          {messages.length === 0 ? (
            <div className="chat-welcome fade-in">
              <div className="chat-welcome-icon">{currentAgent.icon}</div>
              <h2>
                {selectedAgent === 'DISPATCH'
                  ? 'What do you need?'
                  : `${currentAgent.name} Ready`}
              </h2>
              <p>
                {selectedAgent === 'DISPATCH'
                  ? 'Describe what you need and DISPATCH will activate the right agents. Or select a specific agent from the sidebar.'
                  : currentAgent.description}
              </p>
              <div className="quick-actions">
                {quickActions.map((qa, i) => (
                  <button
                    key={i}
                    className="quick-action-btn"
                    onClick={() => {
                      setSelectedAgent(qa.agent);
                      handleSubmit(qa.label);
                    }}
                  >
                    {AGENTS[qa.agent]?.icon} {qa.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`message message-${msg.role}`}>
                {msg.role === 'user' ? (
                  <div className="message-bubble">{msg.content}</div>
                ) : (
                  <div className="message-agent">
                    <div className="message-agent-icon" style={{
                      borderColor: AGENTS[msg.agent]?.color || 'var(--border)'
                    }}>
                      {AGENTS[msg.agent]?.icon || '🤖'}
                    </div>
                    <div className="message-content">
                      <div className="message-header">
                        <span className="agent-label">{AGENTS[msg.agent]?.name}</span>
                        <span className="codename-label">{msg.agent}</span>
                      </div>
                      {msg.isThinking ? (
                        <div className="message-bubble">
                          <div className="typing-indicator">
                            <div className="typing-dot" />
                            <div className="typing-dot" />
                            <div className="typing-dot" />
                          </div>
                        </div>
                      ) : (
                        <div className="message-bubble-wrapper">
                          <div className={`message-bubble ${msg.isReview ? 'gatekeeper-review' : ''}`}>
                            {msg.content}
                          </div>
                          <button
                            className="copy-btn"
                            onClick={(e) => {
                              copyToClipboard(msg.content);
                              e.target.textContent = 'Copied!';
                              e.target.classList.add('copied');
                              setTimeout(() => {
                                e.target.textContent = 'Copy';
                                e.target.classList.remove('copied');
                              }, 2000);
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input Area */}
        <div className="input-area">
          <div className="input-container">
            <div className="input-wrapper">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder={
                  selectedAgent === 'DISPATCH'
                    ? 'Tell DISPATCH what you need... (e.g., "I have a show in Cleveland next month")'
                    : `Ask ${currentAgent.name}...`
                }
                rows={1}
                disabled={isProcessing}
              />
            </div>
            <button
              className="send-btn"
              onClick={() => handleSubmit()}
              disabled={!input.trim() || isProcessing}
            >
              ↑
            </button>
          </div>
          <div className="input-hint">
            {selectedAgent === 'DISPATCH'
              ? 'DISPATCH auto-routes to the right agents • All content reviewed by GATEKEEPER'
              : `Direct mode: ${currentAgent.codename} • Enter to send, Shift+Enter for new line`}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
