// Formulaire de contact therapie-vr.fr -> Mailjet. Zéro dépendance (Node >= 20).
// Apache : ProxyPass "/mail" "http://localhost:11000/mail" (couvre aussi /mail/token).
const http = require("http");
const crypto = require("crypto");
const qs = require("querystring");

const PORT = 11000;
const CONTACT_URL = (process.env.CONTACT_URL || "https://www.therapie-vr.fr/contact").split("?")[0];
const OBJECTS = ["Prise de rendez-vous", "Demande d'informations", "Autre"];
// Clé HMAC dérivée de la clé Mailjet : stable entre redémarrages, rien de plus à configurer.
const SECRET = crypto.createHash("sha256").update("form:" + (process.env.MJ_APIKEY_PRIVATE || "dev")).digest();
const MIN_FILL_MS = 4000;
const MAX_FILL_MS = 2 * 3600 * 1000;
const RATE_MAX = 3;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const sign = ts => ts + "." + crypto.createHmac("sha256", SECRET).update(String(ts)).digest("hex").slice(0, 32);

// ponytail: compteur en mémoire, remis à zéro au redémarrage ; suffisant pour un seul process.
const hits = new Map();
function rateLimited(ip, now) {
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10000) hits.clear();
  return recent.length > RATE_MAX;
}

// Retourne la raison du rejet, ou null si le message est acceptable.
function check(f, now) {
  if (f.website) return "honeypot";
  const [ts] = String(f.t || "").split(".");
  if (!f.t || sign(Number(ts)) !== f.t) return "token";
  const age = now - Number(ts);
  if (age < MIN_FILL_MS) return "trop-rapide";
  if (age > MAX_FILL_MS) return "token-expire";
  const name = String(f.name || "").trim();
  const email = String(f.email || "").trim();
  const message = String(f.message || "").trim();
  if (!name || name.length > 100) return "nom";
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return "email";
  if (!OBJECTS.includes(f.object)) return "objet";
  if (message.length < 2 || message.length > 5000) return "message-longueur";
  if (/<a\s|\[url=|\[link=/i.test(message)) return "balise-lien";
  if ((message.match(/https?:\/\/|www\./gi) || []).length > 2) return "trop-de-liens";
  return null;
}

async function turnstileOk(token, ip) {
  if (!process.env.TURNSTILE_SECRET) return true; // activé dès que la clé est configurée
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token || "", remoteip: ip }),
  });
  return (await r.json()).success === true;
}

const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oneLine = s => s.replace(/[\r\n]+/g, " ");

async function send(f) {
  const name = oneLine(f.name.trim());
  const email = f.email.trim();
  const message = f.message.trim();
  const auth = Buffer.from(process.env.MJ_APIKEY_PUBLIC + ":" + process.env.MJ_APIKEY_PRIVATE).toString("base64");
  const r = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + auth },
    body: JSON.stringify({
      Messages: [{
        From: { Email: "contact@therapie-vr.fr", Name: "Thérapie VR Dijon" },
        To: [{ Email: "contact@therapie-vr.fr" }],
        ReplyTo: { Email: email, Name: name },
        Subject: `[Site] ${f.object} : ${name}`,
        TextPart: `De : ${name} <${email}>\nObjet : ${f.object}\n\n${message}`,
        HTMLPart: `<p><b>De :</b> ${esc(name)} &lt;${esc(email)}&gt;<br><b>Objet :</b> ${esc(f.object)}</p><p>${esc(message).replace(/\r?\n/g, "<br>")}</p>`,
      }],
    }),
  });
  if (!r.ok) throw new Error(`Mailjet ${r.status} ${await r.text()}`);
}

const redirect = (res, qsPart) => { res.writeHead(303, { Location: `${CONTACT_URL}?${qsPart}` }); res.end(); };

const server = http.createServer((req, res) => {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim();

  if (req.url === "/mail/token" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    return res.end(sign(Date.now()));
  }
  if (req.url !== "/mail" || req.method !== "POST") {
    res.writeHead(404);
    return res.end();
  }

  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 100000) req.destroy();
  });
  req.on("end", async () => {
    const f = qs.parse(body);
    const now = Date.now();
    try {
      // Les rejets reçoivent un faux succès : le robot n'apprend rien.
      const reason = rateLimited(ip, now) ? "debit" : check(f, now)
        || (!(await turnstileOk(f["cf-turnstile-response"], ip)) && "turnstile");
      if (reason) {
        console.log(`rejet ${reason} ip=${ip}`);
        return redirect(res, "success=true");
      }
      await send(f);
      console.log(`envoyé ip=${ip}`);
      redirect(res, "success=true");
    } catch (err) {
      console.error("erreur", err);
      redirect(res, "error=true");
    }
  });
});

if (require.main === module) {
  server.listen(PORT, "localhost", () => console.log(`mailer sur http://localhost:${PORT}`));
}
module.exports = { check, sign, rateLimited };
