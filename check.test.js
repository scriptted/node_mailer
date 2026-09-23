// node mailer/check.test.js
const assert = require("assert");
const { check, sign, rateLimited } = require("./server");

const now = Date.now();
const ok = {
  name: "Camille Martin",
  email: "camille@exemple.fr",
  object: "Prise de rendez-vous",
  message: "Bonjour, je souhaiterais un rendez-vous",
  t: sign(now - 30000),
  website: "",
};

assert.strictEqual(check(ok, now), null);
assert.strictEqual(check({ ...ok, message: "Merci de me rappeler au 06 12 34 56 78" }, now), null);
assert.strictEqual(check({ ...ok, message: "ok" }, now), null);
assert.strictEqual(check({ ...ok, website: "http://spam" }, now), "honeypot");
assert.strictEqual(check({ ...ok, t: undefined }, now), "token");
assert.strictEqual(check({ ...ok, t: (now - 30000) + ".deadbeef" }, now), "token");
assert.strictEqual(check({ ...ok, t: sign(now - 1000) }, now), "trop-rapide");
assert.strictEqual(check({ ...ok, t: sign(now - 3 * 3600 * 1000) }, now), "token-expire");
assert.strictEqual(check({ ...ok, email: "pas-un-email" }, now), "email");
assert.strictEqual(check({ ...ok, object: "SEO services" }, now), "objet");
assert.strictEqual(check({ ...ok, message: '<a href="x">promo</a>' }, now), "balise-lien");
assert.strictEqual(check({ ...ok, message: "a http://a b https://b c www.c" }, now), "trop-de-liens");

assert.strictEqual(rateLimited("1.2.3.4", now), false);
rateLimited("1.2.3.4", now);
rateLimited("1.2.3.4", now);
assert.strictEqual(rateLimited("1.2.3.4", now), true);
assert.strictEqual(rateLimited("1.2.3.4", now + 11 * 60 * 1000), false);

console.log("ok");
