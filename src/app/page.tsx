"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  timestamp: string;
  text: string;
  structuredData?: {
    title?: string;
    items: { label: string; value: string }[];
  };
}

interface AnalysisItem {
  label: string;
  value: string;
}

interface AnalysisData {
  title: string;
  items: AnalysisItem[];
}

function formatTextWithBold(text: string) {
  if (!text) return "";
  return text.split("\n").map((line, i) => {
    const parts = line.split("**");
    return (
      <React.Fragment key={i}>
        {parts.map((part, j) => {
          if (j % 2 === 1) {
            return (
              <strong key={j} className="font-bold text-zinc-100">
                {part}
              </strong>
            );
          }
          return part;
        })}
        {i < text.split("\n").length - 1 && <br />}
      </React.Fragment>
    );
  });
}

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("openrouter/auto");

  // Ref to abort in-flight fetch request (used by reset and stop button)
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
  };

  // Dynamic conversation state
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      timestamp: "Baru saja",
      text: "Halo! Saya adalah PRD Architect, partner penemu produk digital Anda. Mari kita rumuskan ide aplikasi Anda menjadi spesifikasi yang matang.\n\nUntuk memulai, ceritakan tentang ide kasar atau masalah apa yang ingin Anda selesaikan lewat aplikasi ini?",
    },
  ]);

  // Dynamic analysis dashboard state (sidebar / details panel)
  const [analysisData, setAnalysisData] = useState<AnalysisData>({
    title: "ANALYSIS TERSTRUKTUR",
    items: [
      {
        label: "Target Pengguna",
        value: "Belum teridentifikasi. Tulis ide aplikasi Anda untuk memulai.",
      },
      {
        label: "Masalah Utama",
        value: "Belum teridentifikasi. Ceritakan masalah yang ingin Anda selesaikan.",
      },
      {
        label: "Fitur MVP",
        value: "Belum dirumuskan.",
      },
    ],
  });

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom when a new message arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Helper function to extract and parse JSON from the assistant response safely
  const parseResponse = (rawText: string) => {
    let cleanText = rawText;
    let parsedAnalysis: AnalysisData | null = null;

    // Match ```json ... ``` blocks (flexible whitespace handling)
    const jsonRegex = /```json\s*([\s\S]*?)```/;
    const match = rawText.match(jsonRegex);

    if (match && match[1]) {
      const jsonStr = match[1].trim();
      if (process.env.NODE_ENV === "development") {
        console.debug("[PRD] Raw JSON block found:", jsonStr);
      }
      try {
        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

        // Support both { analysis: { title, items } } and { title, items } shapes
        const analysisRaw =
          parsed.analysis && typeof parsed.analysis === "object"
            ? (parsed.analysis as Record<string, unknown>)
            : typeof parsed.title === "string" && Array.isArray(parsed.items)
            ? parsed
            : null;

        if (analysisRaw && typeof analysisRaw.title === "string" && Array.isArray(analysisRaw.items)) {
          const validatedItems: AnalysisItem[] = [];
          for (const item of analysisRaw.items as unknown[]) {
            if (item && typeof item === "object") {
              const typedItem = item as Record<string, unknown>;
              if (typeof typedItem.label === "string" && typeof typedItem.value === "string") {
                validatedItems.push({ label: typedItem.label, value: typedItem.value });
              }
            }
          }
          if (validatedItems.length > 0) {
            parsedAnalysis = { title: analysisRaw.title, items: validatedItems };
            if (process.env.NODE_ENV === "development") {
              console.debug("[PRD] Analysis parsed successfully:", parsedAnalysis);
            }
          }
        } else {
          if (process.env.NODE_ENV === "development") {
            console.warn("[PRD] JSON found but missing expected shape { analysis: { title, items } }:", parsed);
          }
        }

        // Strip the JSON block from the visible chat text
        cleanText = rawText.replace(jsonRegex, "").trim();
      } catch (err) {
        console.error("[PRD] Failed to parse JSON block:", err);
      }
    } else {
      if (process.env.NODE_ENV === "development") {
        console.debug("[PRD] No JSON block found in response.");
      }
    }

    return { cleanText, parsedAnalysis };
  };

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    setErrorMsg(null);
    const userTimestamp = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const userMsgId = Date.now().toString();

    // Create user message
    const newUserMessage: Message = {
      id: userMsgId,
      role: "user",
      timestamp: userTimestamp,
      text: textToSend,
    };

    // Update state with user message
    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);
    setInputText("");
    setIsLoading(true);

    // Create a new AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Map message state to what the API endpoint expects (role and content)
      const payloadMessages = updatedMessages.map((msg) => ({
        role: msg.role,
        content: msg.text,
      }));

      const headers: Record<string, string> = { "Content-Type": "application/json" };

      const res = await fetch("/api/chat", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({ 
          messages: payloadMessages,
          model: selectedModel
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Gagal menghubungi API Server.");
      }

      if (data.message && data.message.content) {
        const rawResponse = data.message.content;
        const { cleanText, parsedAnalysis } = parseResponse(rawResponse);
        const aiTimestamp = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

        // Update sidebar items if the model returned new structured analysis
        if (parsedAnalysis) {
          setAnalysisData(parsedAnalysis);
        }

        // Add assistant message
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            timestamp: aiTimestamp,
            text: cleanText,
            structuredData: parsedAnalysis || undefined,
          },
        ]);
      } else {
        throw new Error("Format respons asisten tidak valid.");
      }
    } catch (err: unknown) {
      // Ignore abort errors — these are intentional cancellations
      if (err instanceof DOMException && err.name === "AbortError") {
        console.log("Request was cancelled.");
        return;
      }
      console.error("Error sending message:", err);
      const errorMessage = err instanceof Error ? err.message : "Koneksi terputus. Silakan coba lagi.";
      setErrorMsg(errorMessage);
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  // Stop the current in-flight AI request
  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  // Reset session + cancel any in-flight request
  const handleResetSession = useCallback(() => {
    // Cancel in-flight request first
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setInputText("");
    setErrorMsg(null);
    setMessages([
      {
        id: Date.now().toString(),
        role: "assistant",
        timestamp: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
        text: "Sesi telah direset. Mari kita rumuskan ide produk Anda yang baru. Ceritakan ide atau masalah apa yang ingin Anda selesaikan?",
      },
    ]);
    setAnalysisData({
      title: "ANALISIS TERSTRUKTUR",
      items: [
        { label: "Target Pengguna", value: "Belum teridentifikasi. Tulis ide aplikasi Anda untuk memulai." },
        { label: "Masalah Utama", value: "Belum teridentifikasi. Ceritakan masalah yang ingin Anda selesaikan." },
        { label: "Fitur MVP", value: "Belum dirumuskan." },
      ],
    });
  }, []);

  const handleQuickAction = (actionText: string) => {
    setInputText(actionText);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#09090b] text-zinc-100 font-sans antialiased">
      {/* BACKGROUND DECORATIVE GRADIENT */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[350px] bg-radial from-violet-500/5 via-transparent to-transparent pointer-events-none z-0" />

      {/* LEFT SIDEBAR (TECHNICAL WORKSPACE) */}
      <div
        className={`relative z-10 flex flex-col h-full border-r border-zinc-800 bg-[#0d0d10] transition-all duration-300 ${
          sidebarOpen ? "w-80" : "w-0 overflow-hidden border-r-0"
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isLoading ? "bg-amber-500 animate-pulse" : "bg-violet-500"}`} />
            <span className="font-mono text-xs uppercase tracking-wider text-zinc-400 font-semibold">
              Discovery Engine
            </span>
          </div>
          <span className="text-[10px] font-mono bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded border border-zinc-700/50 max-w-[100px] truncate" title={selectedModel}>
            {selectedModel.split("/")[1]?.split(":")[0] || "OpenRouter"}
          </span>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Active Session Metadata */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Active Dashboard
            </label>
            <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-850 hover:border-zinc-800 transition-colors">
              <h3 className="text-sm font-semibold text-zinc-200">
                {analysisData.title}
              </h3>
              <p className="text-xs text-zinc-400 mt-1">
                Data terperbarui otomatis dari analisis AI.
              </p>
            </div>
          </div>

          {/* Dynamic Analysis Items */}
          <div className="space-y-3">
            <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              Product Dimensions
            </label>
            <div className="space-y-3">
              {analysisData.items.map((item, idx) => (
                <div key={idx} className="p-3 rounded bg-zinc-900/25 border border-zinc-850 space-y-1">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
                    {item.label}
                  </div>
                  <div className="text-xs text-zinc-300 leading-relaxed pl-1.5 border-l border-violet-900/50">
                    {formatTextWithBold(item.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Project Details */}
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              API Connection
            </label>
            <div className="p-3 rounded-lg bg-zinc-900/20 border border-zinc-850 space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-[9px] font-mono text-zinc-500 block">
                  AI Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full bg-[#09090b] border border-zinc-850 rounded px-2 py-1 text-[11px] font-mono text-zinc-350 focus:outline-none focus:border-zinc-750 cursor-pointer"
                >
                  <option value="openrouter/auto">⚡ Auto Best Free (Recommended)</option>
                  <option value="qwen/qwen-2-7b-instruct:free">Qwen 2 7B Instruct (Free/Fast)</option>
                  <option value="mistralai/mistral-7b-instruct:free">Mistral 7B Instruct (Free/Fast)</option>
                  <option value="nvidia/nemotron-3-super:free">Nvidia Nemotron 3 Super (Free)</option>
                  <option value="z-ai/glm-4-5-air:free">GLM 4.5 Air (Free)</option>
                </select>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>Status:</span>
                <span className="font-mono text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Reset Button */}
        <div className="p-4 border-t border-zinc-800 bg-[#0a0a0c] space-y-2">
          {/* Stop button — only visible when AI is generating */}
          {isLoading && (
            <button
              onClick={handleStopGeneration}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-red-900/60 bg-red-950/30 hover:bg-red-950/50 text-xs font-medium text-red-400 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
              Stop Generating
            </button>
          )}
          <button
            onClick={handleResetSession}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-zinc-850 bg-zinc-900/40 hover:bg-zinc-850 text-xs font-medium text-zinc-300 transition-colors cursor-pointer"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Reset Session
          </button>
        </div>
      </div>

      {/* MAIN CONVERSATION PANEL */}
      <div className="flex flex-col flex-1 h-full z-10 relative bg-zinc-950/60 backdrop-blur-md">
        {/* Main Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/80 bg-zinc-950/90">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-md border border-zinc-800 hover:bg-zinc-900 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
              title="Toggle Sidebar"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
              </svg>
            </button>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-zinc-100">PRD Architect</h1>
                <span className="text-[10px] font-mono px-1.5 py-0.2 bg-violet-950/40 text-violet-400 border border-violet-850 rounded">
                  Live Engine
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5 font-sans">
                Interactive Product Discovery powered by OpenRouter AI
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const specs = JSON.stringify(analysisData, null, 2);
                const blob = new Blob([specs], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "prd-specifications.json";
                a.click();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/30 text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export Specs
            </button>
          </div>
        </header>

        {/* Error Notification Banner */}
        {errorMsg && (
          <div className="bg-red-950/30 border-b border-red-900/50 px-6 py-2.5 flex items-center justify-between text-xs text-red-400">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-red-400 hover:text-red-200 font-mono text-[10px]"
            >
              [Dismiss]
            </button>
          </div>
        )}

        {/* Conversation Message List Area */}
        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
          <div className="max-w-3xl mx-auto space-y-8">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {/* Avatar for AI */}
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded border border-zinc-850 bg-zinc-900/80 flex items-center justify-center text-xs font-bold text-violet-400 font-mono">
                    PA
                  </div>
                )}

                {/* Message Box */}
                <div className={`flex flex-col max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  {/* Timestamp & Name */}
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <span className="text-[10px] font-mono text-zinc-500">
                      {msg.role === "user" ? "You" : "PRD Architect"}
                    </span>
                    <span className="text-[9px] font-mono text-zinc-650">•</span>
                    <span className="text-[9px] font-mono text-zinc-500">{msg.timestamp}</span>
                  </div>

                  {/* Text bubble */}
                  <div
                    className={`rounded-lg px-4 py-3 text-sm leading-relaxed border transition-colors ${
                      msg.role === "user"
                        ? "bg-zinc-900 border-zinc-800 text-zinc-100"
                        : "bg-zinc-950/20 border-zinc-900 text-zinc-300"
                    }`}
                  >
                    {formatTextWithBold(msg.text)}
                  </div>

                  {/* Rendered inline structured data (if any) */}
                  {msg.structuredData && (
                    <div className="mt-3 w-full border border-zinc-800/80 bg-zinc-900/20 rounded-lg overflow-hidden">
                      <div className="bg-[#0e0e11] px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
                        <span className="text-[10px] font-mono text-zinc-400 font-semibold tracking-wider">
                          {msg.structuredData.title || "LATEST FINDINGS"}
                        </span>
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                      </div>
                      <div className="p-4 space-y-3.5">
                        {msg.structuredData.items.map((item, idx) => (
                          <div key={idx} className="space-y-1">
                            <h4 className="text-[11px] font-mono text-zinc-500 uppercase tracking-wide">
                              {item.label}
                            </h4>
                            <p className="text-xs text-zinc-300 pl-2 border-l border-violet-900/50">
                              {formatTextWithBold(item.value)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Avatar for User */}
                {msg.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded border border-zinc-850 bg-zinc-900/80 flex items-center justify-center text-xs font-bold text-zinc-450 font-mono">
                    U
                  </div>
                )}
              </div>
            ))}

            {/* Loading Skeleton */}
            {isLoading && (
              <div className="flex gap-4 justify-start">
                <div className="flex-shrink-0 w-8 h-8 rounded border border-zinc-850 bg-zinc-900/80 flex items-center justify-center text-xs font-bold text-violet-400 font-mono animate-pulse">
                  PA
                </div>
                <div className="flex flex-col max-w-[85%] items-start">
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <span className="text-[10px] font-mono text-zinc-500">PRD Architect</span>
                    <span className="text-[9px] font-mono text-zinc-650">•</span>
                    <span className="text-[9px] font-mono text-zinc-600">Thinking...</span>
                  </div>
                  <div className="rounded-lg px-4 py-3 border border-zinc-900 bg-zinc-950/20 text-zinc-500 text-xs font-mono space-y-1.5 w-64">
                    <div className="h-2 bg-zinc-800 rounded w-5/6 animate-pulse" />
                    <div className="h-2 bg-zinc-800 rounded w-full animate-pulse" />
                    <div className="h-2 bg-zinc-800 rounded w-2/3 animate-pulse" />
                  </div>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Input Text Box Area */}
        <div className="p-6 border-t border-zinc-800/80 bg-zinc-950/90 z-20">
          <div className="max-w-3xl mx-auto space-y-3">
            {/* Quick Actions Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              <button
                onClick={() => handleQuickAction("Target pengguna aplikasi saya adalah ")}
                className="flex-shrink-0 px-2.5 py-1 rounded bg-zinc-900/60 border border-zinc-850 hover:border-zinc-750 text-zinc-400 hover:text-zinc-200 transition-colors font-mono text-[10px] cursor-pointer"
              >
                + Define Target User
              </button>
              <button
                onClick={() => handleQuickAction("Masalah utama yang kami selesaikan adalah ")}
                className="flex-shrink-0 px-2.5 py-1 rounded bg-zinc-900/60 border border-zinc-850 hover:border-zinc-750 text-zinc-400 hover:text-zinc-200 transition-colors font-mono text-[10px] cursor-pointer"
              >
                + Define Core Problem
              </button>
              <button
                onClick={() => handleQuickAction("Fitur utama untuk MVP kami mencakup ")}
                className="flex-shrink-0 px-2.5 py-1 rounded bg-zinc-900/60 border border-zinc-850 hover:border-zinc-750 text-zinc-400 hover:text-zinc-200 transition-colors font-mono text-[10px] cursor-pointer"
              >
                + List Core MVP Features
              </button>
            </div>

            {/* Input field container */}
            <div className="relative border border-zinc-800 rounded-lg bg-zinc-900/20 focus-within:border-zinc-700 transition-colors">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ketikkan tanggapan Anda di sini... (tekan enter untuk mengirim)"
                className="w-full bg-transparent border-0 outline-none focus:ring-0 text-sm text-zinc-200 placeholder-zinc-500 py-3.5 pl-4 pr-12 resize-none h-16 min-h-[60px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage(inputText);
                  }
                }}
              />

              {/* Submit button */}
              <button
                disabled={!inputText.trim() || isLoading}
                onClick={() => handleSendMessage(inputText)}
                className="absolute right-3.5 bottom-3.5 p-1.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-violet-400 hover:border-violet-900/40 disabled:opacity-40 disabled:hover:text-zinc-400 disabled:hover:border-zinc-800 transition-all cursor-pointer"
                title="Send Message"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                </svg>
              </button>
            </div>

            {/* Status footer inside input area */}
            <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 px-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isLoading ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
                <span>
                  {isLoading
                    ? "PRD Architect sedang menganalisis..."
                    : "Terhubung via OpenRouter Server"}
                </span>
              </div>
              <span className="hidden sm:inline">Enter untuk mengirim • Shift + Enter untuk baris baru</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
