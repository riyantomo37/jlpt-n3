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
      let contents = [];

      for (const m of messages) {
        const text = String(m.content == null ? "" : m.content);
        if (m.role === "system") {
          systemParts.push({ text: text });
        } else {
          const role = m.role === "assistant" ? "model" : "user";
          contents.push({ role: role, parts: [{ text: text }] });
        }
      }

      // Gemini menolak kalau:
      //  - contents diawali role "model" (giliran pertama harus "user")
      //  - ada dua role sama berturut-turut
      // Jadi kita bersihkan dulu.
      // 1) Buang pesan "model" di awal sampai ketemu "user".
      while (contents.length && contents[0].role === "model") {
        contents.shift();
      }
      // 2) Gabungkan role yang sama bila berurutan.
      const merged = [];
      for (const c of contents) {
        const last = merged[merged.length - 1];
        if (last && last.role === c.role) {
          last.parts[0].text += "\n" + c.parts[0].text;
        } else {
          merged.push({ role: c.role, parts: [{ text: c.parts[0].text }] });
        }
      }
      contents = merged;

      // Kalau kosong (mis. cuma ada sapaan model), kasih placeholder user.
      if (!contents.length) {
        contents = [{ role: "user", parts: [{ text: "Halo" }] }];
      }

      const geminiBody = {
        contents: contents,
        generationConfig: {
          temperature: typeof payload.temperature === "number" ? payload.temperature : 0.7,
          // Plafon tinggi supaya jawaban tidak terpotong. Model gemini-2.5-flash
          // mendukung hingga 65535; 8192 sudah sangat lega untuk app ini.
          maxOutputTokens: payload.max_tokens || 8192,
          // Default: matikan "thinking" (thinkingBudget:0) karena pada gemini-2.5-flash
          // token thinking dihitung terhadap maxOutputTokens dan sering bikin jawaban
          // kosong/terpotong kalau maxOutputTokens-nya pas-pasan.
          // Untuk request yang butuh kreativitas lebih (mis. bikin soal tata bahasa/distraktor
          // yang mengecoh), caller bisa kirim payload.thinkingBudget (dan max_tokens lebih besar
          // supaya sisa token buat jawaban tetap cukup).
          thinkingConfig: { thinkingBudget: typeof payload.thinkingBudget === "number" ? payload.thinkingBudget : 0 },
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

        if (!text) {
          // Bisa kejadian kalau diblokir safety / finishReason bukan STOP.
          let reason = "";
          try { reason = data.candidates[0].finishReason || ""; } catch (e) {}
          return groqStyle("Gemini tidak mengembalikan teks" + (reason ? " (finishReason: " + reason + ")" : ""), 502);
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

// Balas dalam format yang index.html mengerti, baik saat sukses maupun error.
// index.html membaca d.choices[0].message.content (untuk ditampilkan)
// dan d.error.message (saat res tidak ok), jadi kita sediakan keduanya.
function groqStyle(message, status) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: "⚠️ " + message } }],
    error: { message: message, code: status },
  }), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
