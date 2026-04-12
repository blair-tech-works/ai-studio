'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  sendDraftingMessage,
  synthesizePRD,
  createPRD,
  type DraftingMessage,
  type PRDGrade,
} from '@/lib/api';

type Phase = 'brainstorm' | 'grilling' | 'synthesizing' | 'review';

const STORAGE_KEY = 'ai-studio-prd-drafting-session';

interface SavedSession {
  phase: Phase;
  brainDump: string;
  messages: DraftingMessage[];
  suggestsFinalize: boolean;
  prdTitle: string;
  prdContent: string;
  grade: PRDGrade | null;
  savedAt: string;
}

function saveSession(data: Omit<SavedSession, 'savedAt'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
  } catch {}
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function clearSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export default function NewPRDPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('brainstorm');
  const [brainDump, setBrainDump] = useState('');
  const [messages, setMessages] = useState<DraftingMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestsFinalize, setSuggestsFinalize] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);

  // Synthesis results
  const [prdTitle, setPrdTitle] = useState('');
  const [prdContent, setPrdContent] = useState('');
  const [grade, setGrade] = useState<PRDGrade | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = loadSession();
    if (saved && saved.messages.length > 0) {
      setPhase(saved.phase === 'synthesizing' ? 'grilling' : saved.phase); // don't restore mid-synthesis
      setBrainDump(saved.brainDump);
      setMessages(saved.messages);
      setSuggestsFinalize(saved.suggestsFinalize);
      setPrdTitle(saved.prdTitle);
      setPrdContent(saved.prdContent);
      setGrade(saved.grade);
      setResumed(true);
    }
  }, []);

  // Save session on every meaningful state change
  useEffect(() => {
    if (messages.length > 0 || phase !== 'brainstorm') {
      saveSession({ phase, brainDump, messages, suggestsFinalize, prdTitle, prdContent, grade });
    }
  }, [phase, messages, suggestsFinalize, prdTitle, prdContent, grade, brainDump]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (phase === 'grilling' && !loading) {
      inputRef.current?.focus();
    }
  }, [phase, loading]);

  async function startSession() {
    if (!brainDump.trim()) return;
    setError(null);

    const humanMsg: DraftingMessage = { role: 'human', content: brainDump.trim() };
    const newMessages = [humanMsg];
    setMessages(newMessages);
    setPhase('grilling');
    setLoading(true);

    try {
      const res = await sendDraftingMessage({ messages: newMessages, phase: 'brainstorm' });
      const pmMsg: DraftingMessage = { role: 'pm', content: res.message };
      setMessages([...newMessages, pmMsg]);
      setSuggestsFinalize(res.suggestsFinalize);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    setError(null);

    const humanMsg: DraftingMessage = { role: 'human', content: input.trim() };
    const newMessages = [...messages, humanMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await sendDraftingMessage({ messages: newMessages, phase: 'grilling' });
      const pmMsg: DraftingMessage = { role: 'pm', content: res.message };
      setMessages([...newMessages, pmMsg]);
      setSuggestsFinalize(res.suggestsFinalize);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get PM response');
    } finally {
      setLoading(false);
    }
  }

  async function handleFinalize() {
    setError(null);
    setPhase('synthesizing');

    try {
      const res = await synthesizePRD({ messages });
      setPrdTitle(res.title);
      setPrdContent(res.content);
      setGrade(res.grade);
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to synthesize PRD');
      setPhase('grilling');
    }
  }

  async function saveDraft() {
    setError(null);
    setLoading(true);

    try {
      await createPRD({
        title: prdTitle,
        content: prdContent,
        status: 'draft',
      });
      clearSession();
      router.push('/prds');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save PRD');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const scoreColor = (score: number) =>
    score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400';

  const statusColor = (status: string) =>
    status === 'covered'
      ? 'bg-green-500/20 text-green-400 border-green-500/50'
      : status === 'partially_covered'
        ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50'
        : 'bg-red-500/20 text-red-400 border-red-500/50';

  const statusLabel = (status: string) =>
    status === 'covered' ? 'Covered' : status === 'partially_covered' ? 'Partial' : 'Missing';

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/prds')}
          className="text-gray-400 hover:text-white text-sm mb-4 inline-block"
        >
          &larr; Back to PRDs
        </button>
        <h1 className="text-3xl font-bold text-white">Create PRD</h1>
        <p className="text-gray-400 mt-1">
          {phase === 'brainstorm' && 'Brain dump your idea. The PM agent will help flesh it out.'}
          {phase === 'grilling' && 'The PM agent is asking questions to strengthen your PRD.'}
          {phase === 'synthesizing' && 'Synthesizing your conversation into a structured PRD...'}
          {phase === 'review' && 'Review your synthesized PRD and its coverage grade.'}
        </p>
      </div>

      {/* Session restored banner */}
      {resumed && (
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded flex items-center justify-between">
          <p className="text-sm text-blue-400">Session restored from where you left off.</p>
          <button
            onClick={() => {
              clearSession();
              setPhase('brainstorm');
              setBrainDump('');
              setMessages([]);
              setSuggestsFinalize(false);
              setPrdTitle('');
              setPrdContent('');
              setGrade(null);
              setResumed(false);
            }}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 bg-dark-border rounded"
          >
            Start Fresh
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Phase: Brain Dump */}
      {phase === 'brainstorm' && (
        <div>
          <textarea
            value={brainDump}
            onChange={(e) => setBrainDump(e.target.value)}
            placeholder="Describe your product idea, feature, or problem. Don't worry about structure — just get your thoughts down. The PM agent will help organize and identify gaps..."
            className="w-full min-h-[250px] bg-dark-card border border-dark-border rounded-lg p-4 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-y text-sm leading-relaxed"
            autoFocus
          />
          <div className="flex justify-end mt-4">
            <button
              onClick={startSession}
              disabled={!brainDump.trim()}
              className="px-6 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Start Session with PM
            </button>
          </div>
        </div>
      )}

      {/* Phase: Grilling Chat */}
      {phase === 'grilling' && (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 260px)' }}>
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'human' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'human'
                      ? 'bg-blue-500 text-white'
                      : 'bg-dark-card border border-dark-border text-gray-200'
                  }`}
                >
                  {msg.role === 'pm' && (
                    <p className="text-xs text-blue-400 font-medium mb-1.5">PM Agent</p>
                  )}
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-dark-card border border-dark-border rounded-lg px-4 py-3">
                  <p className="text-xs text-blue-400 font-medium mb-1.5">PM Agent</p>
                  <div className="flex space-x-1.5">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-dark-border pt-4">
            <div className="flex gap-3">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Answer the PM's questions..."
                rows={2}
                disabled={loading}
                className="flex-1 bg-dark-card border border-dark-border rounded-lg px-4 py-2.5 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none text-sm disabled:opacity-50"
              />
              <div className="flex flex-col gap-2">
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>
                <button
                  onClick={handleFinalize}
                  disabled={loading || messages.length < 2}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    suggestsFinalize
                      ? 'bg-green-500 text-white hover:bg-green-600 ring-2 ring-green-400/50'
                      : 'bg-dark-border text-gray-400 hover:text-white hover:bg-dark-card'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  Finalize
                </button>
              </div>
            </div>
            {suggestsFinalize && (
              <p className="text-xs text-green-400 mt-2">
                PM suggests the PRD has good coverage. Click Finalize when ready.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Phase: Synthesizing */}
      {phase === 'synthesizing' && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-400">PM is synthesizing your PRD...</p>
          <p className="text-gray-500 text-sm mt-1">This may take 15-30 seconds</p>
        </div>
      )}

      {/* Phase: Review */}
      {phase === 'review' && (
        <div className="space-y-6">
          {/* Grade Card */}
          {grade && (
            <div className="card border border-dark-border rounded-lg p-6">
              <div className="flex items-start gap-6">
                {/* Score */}
                <div className="text-center">
                  <p className={`text-5xl font-bold ${scoreColor(grade.overallScore)}`}>
                    {grade.overallScore}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">/ 100</p>
                </div>

                {/* Categories */}
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-white mb-3">Coverage Grade</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {grade.categories.map((cat, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusColor(cat.status)}`}
                        >
                          {statusLabel(cat.status)}
                        </span>
                        <span className="text-xs text-gray-400 truncate" title={cat.notes}>
                          {cat.name}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-3">{grade.summary}</p>
                </div>
              </div>
            </div>
          )}

          {/* PRD Content */}
          <div className="card border border-dark-border rounded-lg p-6">
            <h2 className="text-xl font-bold text-white mb-4">{prdTitle}</h2>
            <div className="prose prose-invert prose-sm max-w-none text-gray-300 whitespace-pre-wrap leading-relaxed">
              {prdContent}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setPhase('grilling')}
              className="px-4 py-2 bg-dark-border text-gray-400 rounded-lg text-sm hover:text-white hover:bg-dark-card transition-colors"
            >
              Back to Chat
            </button>
            <button
              onClick={saveDraft}
              disabled={loading}
              className="px-6 py-2.5 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors"
            >
              {loading ? 'Saving...' : 'Save as Draft'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
