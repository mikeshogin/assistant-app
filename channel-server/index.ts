#!/usr/bin/env bun

/**
 * Mobile App Channel Server for Claude Code
 *
 * MCP server that bridges a mobile app with Claude Code sessions.
 * Receives voice/text from mobile app via HTTP, pushes to Claude Code via channels.
 * Claude replies via tool call, server forwards back to mobile app via WebSocket.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const PORT = parseInt(process.env.CHANNEL_PORT || "8789");
const ALLOWED_TOKENS = new Set((process.env.ALLOWED_TOKENS || "").split(",").filter(Boolean));

// Connected WebSocket clients (mobile apps)
const clients = new Map<string, any>(); // userId -> ws

// Message queue for replies (when client reconnects)
const replyQueue = new Map<string, any[]>();

// MCP server (communicates with Claude Code via stdin/stdout)
// For now, we use HTTP bridge pattern instead of full MCP SDK
// Claude Code's Telegram plugin reads from inbox/ folder

const INBOX_DIR = `${process.env.HOME}/.claude/channels/mobile/inbox`;
const fs = await import("fs");
const path = await import("path");

// Ensure directories exist
fs.mkdirSync(INBOX_DIR, { recursive: true });

async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: "audio/webm" }), "voice.webm");
    formData.append("model", "whisper-large-v3");
    formData.append("language", "ru");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_API_KEY}` },
        body: formData,
    });

    if (!response.ok) throw new Error(`Groq: ${response.status}`);
    const result = await response.json() as any;
    return result.text || "";
}

// HTTP + WebSocket server
const server = Bun.serve({
    port: PORT,
    async fetch(req, server) {
        const url = new URL(req.url);

        // WebSocket upgrade for real-time replies
        if (url.pathname === "/ws") {
            const token = url.searchParams.get("token");
            if (!token || (!ALLOWED_TOKENS.has(token) && ALLOWED_TOKENS.size > 0)) {
                return new Response("forbidden", { status: 403 });
            }
            if (server.upgrade(req, { data: { token } })) {
                return undefined;
            }
            return new Response("upgrade failed", { status: 500 });
        }

        // POST /voice - receive voice message from mobile app
        if (req.method === "POST" && url.pathname === "/voice") {
            const token = req.headers.get("x-auth-token") || "";
            if (ALLOWED_TOKENS.size > 0 && !ALLOWED_TOKENS.has(token)) {
                return Response.json({ error: "forbidden" }, { status: 403 });
            }

            const formData = await req.formData();
            const audioFile = formData.get("audio") as Blob;
            if (!audioFile) return Response.json({ error: "no audio" }, { status: 400 });

            // Save audio
            const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
            const audioPath = path.join(INBOX_DIR, `${Date.now()}.webm`);
            fs.writeFileSync(audioPath, audioBuffer);

            // Transcribe
            let text = "";
            try {
                text = await transcribeAudio(audioBuffer);
            } catch (e: any) {
                return Response.json({ error: `transcription: ${e.message}` }, { status: 500 });
            }

            // Write message file for Claude Code to pick up
            const msgId = `${Date.now()}`;
            const msgPath = path.join(INBOX_DIR, `${msgId}.json`);
            fs.writeFileSync(msgPath, JSON.stringify({
                id: msgId,
                user_id: token || "mobile-user",
                text: text,
                audio_path: audioPath,
                timestamp: new Date().toISOString(),
                source: "mobile-app",
            }));

            return Response.json({ id: msgId, transcription: text });
        }

        // POST /text - receive text message
        if (req.method === "POST" && url.pathname === "/text") {
            const token = req.headers.get("x-auth-token") || "";
            if (ALLOWED_TOKENS.size > 0 && !ALLOWED_TOKENS.has(token)) {
                return Response.json({ error: "forbidden" }, { status: 403 });
            }

            const body = await req.json() as any;
            const msgId = `${Date.now()}`;
            const msgPath = path.join(INBOX_DIR, `${msgId}.json`);
            fs.writeFileSync(msgPath, JSON.stringify({
                id: msgId,
                user_id: token || "mobile-user",
                text: body.text || "",
                timestamp: new Date().toISOString(),
                source: "mobile-app",
            }));

            return Response.json({ id: msgId });
        }

        // POST /reply - Claude Code sends reply back (called by Claude)
        if (req.method === "POST" && url.pathname === "/reply") {
            const body = await req.json() as any;
            const userId = body.user_id || "mobile-user";

            // Send via WebSocket if connected
            const ws = clients.get(userId);
            if (ws) {
                ws.send(JSON.stringify({
                    type: "reply",
                    text: body.text,
                    timestamp: new Date().toISOString(),
                }));
            } else {
                // Queue for when they reconnect
                if (!replyQueue.has(userId)) replyQueue.set(userId, []);
                replyQueue.get(userId)!.push({
                    text: body.text,
                    timestamp: new Date().toISOString(),
                });
            }

            return Response.json({ sent: !!ws });
        }

        // GET /health
        if (url.pathname === "/health") {
            return Response.json({
                status: "ok",
                clients: clients.size,
                queued_replies: Array.from(replyQueue.entries()).map(([k, v]) => ({ user: k, count: v.length })),
            });
        }

        return new Response("not found", { status: 404 });
    },
    websocket: {
        open(ws: any) {
            const userId = ws.data.token;
            clients.set(userId, ws);
            console.log(`Client connected: ${userId}`);

            // Send queued replies
            const queued = replyQueue.get(userId);
            if (queued && queued.length > 0) {
                for (const reply of queued) {
                    ws.send(JSON.stringify({ type: "reply", ...reply }));
                }
                replyQueue.delete(userId);
            }
        },
        message(ws: any, message: any) {
            // Handle incoming WebSocket messages (text/voice)
            try {
                const data = JSON.parse(message.toString());
                if (data.type === "text") {
                    const msgId = `${Date.now()}`;
                    const msgPath = path.join(INBOX_DIR, `${msgId}.json`);
                    fs.writeFileSync(msgPath, JSON.stringify({
                        id: msgId,
                        user_id: ws.data.token,
                        text: data.text,
                        timestamp: new Date().toISOString(),
                        source: "mobile-app",
                    }));
                    ws.send(JSON.stringify({ type: "ack", id: msgId }));
                }
            } catch {}
        },
        close(ws: any) {
            clients.delete(ws.data.token);
            console.log(`Client disconnected: ${ws.data.token}`);
        },
    },
});

console.log(`Mobile channel server on http://localhost:${PORT}`);
console.log(`Inbox: ${INBOX_DIR}`);
console.log(`WebSocket: ws://localhost:${PORT}/ws?token=YOUR_TOKEN`);
