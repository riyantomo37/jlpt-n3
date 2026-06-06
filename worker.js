// JLPT Guide 満点コース — Cloudflare Worker
// Job: terima request format Groq dari index.html di POST /api/groq,
// terjemahkan ke Google Gemini, lalu balikkan respons dalam format Groq
// supaya index.html tidak perlu diubah sama sekali.
// API key disimpan sebagai Secret GEMINI_API_KEY (tidak pernah masuk ke HTML/repo).

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  GEMINI_MODEL + ":generateContent";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/groq") {
      if (request.method !== "POST") {
        return groqStyle("Method not allowed", 405);
      }
      if (!env.GEMINI_API_KEY) {
        return groqStyle("GEMINI_API_KEY secret belum diset di Worker", 500);
      }

      let payload;
      try {
        payload = await request.json();
      } catch (e) {
        return groqStyle("Invalid JSON body", 400);
      }

      // --- Ubah format Groq (messages) -> format Gemini (contents) ---
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const systemParts = [];
      const contents = [];
      for (const m of messages) {
        if (m.role === "system") {
          systemParts.push({ text: String(m.content || "") });
        } else {
          contents.push({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: String(m.content || "") }],
          });
        }
      }

      const geminiBody = {
        contents: contents,
        generationConfig: {
          temperature: typeof payload.temperature === "number" ? payload.temperature : 0.7,
          maxOutputTokens: payload.max_tokens || 1024,
        },
      };
      if (systemParts.length) {
        geminiBody.system_instruction = { parts: systemParts };
      }

      try {
        const geminiRes = await fetch(GEMINI_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY,
          },
          body: JSON.stringify(geminiBody),
        });

        const data = await geminiRes.json();

        if (!geminiRes.ok) {
          const msg = (data && data.error && data.error.message) || "Gemini error";
          return groqStyle("Gemini: " + msg, geminiRes.status);
        }

        // --- Ambil teks balasan Gemini ---
        let text = "";
        try {
          const parts = data.candidates[0].content.parts;
          text = parts.map(function (p) { return p.text || ""; }).join("");
        } catch (e) {
          text = "";
        }

        // --- Bungkus ulang jadi format Groq supaya index.html bisa baca ---
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: text } }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return groqStyle("Gagal menghubungi Gemini: " + String(e), 502);
      }
    }

    // Selain /api/groq -> static assets (index.html dll).
    return env.ASSETS.fetch(request);
  },
};

// Balas dalam bentuk yang sama dengan respons Groq, supaya index.html
// (yang baca choices[0].message.content) tetap jalan walau ada error.
function groqStyle(message, status) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: "[Error] " + message } }],
    error: message,
  }), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
