export type OllamaRole = "system" | "user" | "assistant";

export type OllamaMessage = {
    role: OllamaRole;
    content: string;
};

export type OllamaChatOptions = {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
};

export type OllamaChatRequest = {
    host: string;
    model: string;
    messages: OllamaMessage[];
    options?: OllamaChatOptions;
    keep_alive?: string;
    timeout_ms?: number;
};

export type OllamaChatResponse = {
    content: string;
    model: string;
    duration_ms: number;
};

function normalize_host(host: string): string {
    const trimmed = host.trim();
    if (!trimmed) return "http://localhost:11434";
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export async function ollama_chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    const host = normalize_host(request.host);
    const timeout_ms = request.timeout_ms ?? 60_000;
    const controller = new AbortController();
    const started = Date.now();
    const timeout = setTimeout(() => controller.abort(), timeout_ms);

    try {
        const res = await fetch(`${host}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: request.model,
                messages: request.messages,
                stream: false,
                options: request.options,
                keep_alive: request.keep_alive,
            }),
            signal: controller.signal,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`ollama_http_${res.status}: ${text || res.statusText}`);
        }

        const data = (await res.json()) as {
            model?: string;
            message?: { content?: string };
        };
        const content = typeof data?.message?.content === "string" ? data.message.content : "";

        return {
            content,
            model: typeof data?.model === "string" ? data.model : request.model,
            duration_ms: Date.now() - started,
        };
    } finally {
        clearTimeout(timeout);
    }
}
