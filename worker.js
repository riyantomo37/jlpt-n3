// JLPT Guide 満点コース — Cloudflare Worker
// Only job: proxy POST /api/groq to Groq, injecting the GROQ_API_KEY secret.
// All other requests (index.html, etc.) are served by Cloudflare Static Assets.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/groq") {
      // Only POST is allowed.
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }
      if (!env.GROQ_API_KEY) {
        return json({ error: "GROQ_API_KEY secret not configured on the Worker" }, 500);
      }

      let payload;
      try {
        payload = await request.json();
      } catch (e) {
        return json({ error: "Invalid JSON body" }, 400);
      }

      try {
        const groqRes = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + env.GROQ_API_KEY,
          },
          body: JSON.stringify(payload),
        });

        // Pass Groq's response straight back to the browser.
        const body = await groqRes.text();
        return new Response(body, {
          status: groqRes.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return json({ error: "Upstream request to Groq failed", detail: String(e) }, 502);
      }
    }

    // Everything else -> static assets (index.html).
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
