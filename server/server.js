#!/usr/bin/env bun

import { serve } from "bun";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";

const PORT = parseInt(process.env.PORT || "8095");
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const UPLOAD_DIR = "/tmp/assistant-uploads";

// Ensure upload directory exists
await mkdir(UPLOAD_DIR, { recursive: true });

// Conversation history (in-memory, per session)
const conversations = new Map();

async function transcribeAudio(audioPath) {
    // Use Groq Whisper API for transcription
    const audioData = await readFile(audioPath);
    const formData = new FormData();
    formData.append("file", new Blob([audioData], { type: "audio/webm" }), "voice.webm");
    formData.append("model", "whisper-large-v3");
    formData.append("language", "ru");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
    }

    const result = await response.json();
    return result.text || "";
}

async function getAssistantResponse(text, sessionId) {
    // Get or create conversation history
    if (!conversations.has(sessionId)) {
        conversations.set(sessionId, []);
    }
    const history = conversations.get(sessionId);

    // Add user message
    history.push({ role: "user", content: text });

    // Keep last 20 messages for context
    const messages = history.slice(-20);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
            model: "claude-sonnet-4-6-20260320",
            max_tokens: 1024,
            system: "You are a helpful assistant. Respond concisely in the same language as the user. If the user speaks Russian, respond in Russian.",
            messages: messages,
        }),
    });

    if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status}`);
    }

    const result = await response.json();
    const assistantText = result.content?.[0]?.text || "No response";

    // Add assistant message to history
    history.push({ role: "assistant", content: assistantText });

    return assistantText;
}

const server = serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);

        // Serve static files
        if (req.method === "GET") {
            let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
            const publicDir = join(import.meta.dir, "..", "public");

            try {
                const file = await readFile(join(publicDir, filePath));
                const ext = filePath.split(".").pop();
                const mimeTypes = {
                    html: "text/html",
                    js: "application/javascript",
                    json: "application/json",
                    css: "text/css",
                    png: "image/png",
                    svg: "image/svg+xml",
                };
                return new Response(file, {
                    headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" },
                });
            } catch {
                return new Response("Not found", { status: 404 });
            }
        }

        // Handle voice upload
        if (req.method === "POST" && url.pathname === "/api/voice") {
            try {
                const formData = await req.formData();
                const audioFile = formData.get("audio");

                if (!audioFile) {
                    return Response.json({ error: "No audio file" }, { status: 400 });
                }

                // Save audio to temp file
                const tempPath = join(UPLOAD_DIR, `${Date.now()}.webm`);
                const arrayBuffer = await audioFile.arrayBuffer();
                await writeFile(tempPath, Buffer.from(arrayBuffer));

                // Transcribe
                const transcription = await transcribeAudio(tempPath);

                // Clean up
                await unlink(tempPath).catch(() => {});

                if (!transcription.trim()) {
                    return Response.json({
                        transcription: "",
                        response: "Could not transcribe audio. Please try again.",
                    });
                }

                // Get session ID from cookie or generate
                const sessionId = req.headers.get("cookie")?.match(/session=([^;]+)/)?.[1] ||
                    Math.random().toString(36).slice(2);

                // Get assistant response
                const response = await getAssistantResponse(transcription, sessionId);

                return Response.json(
                    { transcription, response },
                    {
                        headers: {
                            "Set-Cookie": `session=${sessionId}; Path=/; HttpOnly; SameSite=Strict`,
                        },
                    }
                );
            } catch (err) {
                console.error("Error:", err);
                return Response.json({ error: err.message }, { status: 500 });
            }
        }

        // Health check
        if (url.pathname === "/health") {
            return Response.json({ status: "ok" });
        }

        return new Response("Method not allowed", { status: 405 });
    },
});

console.log(`Assistant server running on http://localhost:${PORT}`);
