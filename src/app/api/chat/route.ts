import { NextResponse } from "next/server";
import { z } from "zod";
import { isRateLimited } from "@/lib/rateLimit";
import { SYSTEM_DISCOVERY_PROMPT } from "@/config/prompts";

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
  }>;
  error?: {
    message?: string;
    code?: number | string;
  } | string;
}

// Zod schemas for strict request input validation
const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(6000),
});

const payloadSchema = z.object({
  messages: z.array(messageSchema).min(1).max(50),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    // CSRF Protection: Validate Origin matches Host if present (Enforced in production only)
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (process.env.NODE_ENV !== "development" && origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json(
            { error: "Forbidden: Cross-Origin request detected." },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Forbidden: Invalid origin header." },
          { status: 403 }
        );
      }
    }

    // Rate Limiting Protection (CWE-770 / DoS mitigation)
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
    // Check in-memory rate-limiter
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a minute and try again." },
        { status: 429 }
      );
    }

    // Safety: Ensure Request Body is Valid JSON
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request payload. Must be JSON." },
        { status: 400 }
      );
    }

    // Input Validation using Zod Schema (Defensive Coding)
    const parseResult = payloadSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Validation failed.", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { messages, model } = parseResult.data;

    // Server-side model whitelist — prevents use of arbitrary/paid models
    const ALLOWED_MODELS = [
      "openrouter/auto",
      "qwen/qwen-2-7b-instruct:free",
      "mistralai/mistral-7b-instruct:free",
      "nvidia/nemotron-3-super:free",
      "z-ai/glm-4-5-air:free",
    ];
    const selectedModel = (model && ALLOWED_MODELS.includes(model))
      ? model
      : "openrouter/auto";

    const apiKey = req.headers.get("x-openrouter-key") || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API Key OpenRouter tidak ditemukan. Harap masukkan API Key di sidebar atau konfigurasikan file .env.local di server." },
        { status: 400 }
      );
    }

    const systemPrompt = {
      role: "system" as const,
      content: SYSTEM_DISCOVERY_PROMPT,
    };

    const payloadMessages = [systemPrompt, ...messages];

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://prd-architect.local", 
        "X-Title": "PRD Architect",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: payloadMessages,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      return NextResponse.json(
        { error: `OpenRouter API error: ${response.status} - ${errorData}` },
        { status: response.status }
      );
    }

    const data = (await response.json()) as OpenRouterResponse;
    
    // Handle error payloads from OpenRouter
    if (data.error) {
      const errorMsg = typeof data.error === "object" && data.error && "message" in data.error && data.error.message 
        ? data.error.message 
        : typeof data.error === "string"
        ? data.error
        : JSON.stringify(data.error);
      return NextResponse.json(
        { error: `OpenRouter API error: ${errorMsg}` },
        { status: 400 }
      );
    }

    const assistantMessage = data.choices?.[0]?.message;

    if (!assistantMessage || typeof assistantMessage.content !== "string") {
      return NextResponse.json(
        { error: "Invalid response structure from OpenRouter API." },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: { role: "assistant", content: assistantMessage.content } });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    
    // Prevent information leakage in production by sending a generic message.
    let clientErrorMessage = "An internal error occurred.";
    if (process.env.NODE_ENV === "development" && error instanceof Error) {
      clientErrorMessage = error.message;
    }

    return NextResponse.json(
      { error: clientErrorMessage },
      { status: 500 }
    );
  }
}
