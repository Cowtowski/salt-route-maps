// SALT Routes: one-step sync from the snow database.
// Run from the "\u{27F3} Sync salt routes" bookmark while logged in to east-westservices.com/dba/snow.
(async function(){
  "use strict";
  const SITE = "https://cowtowski.github.io/salt-route-maps/";
  const SEASON = "2026-27";
  if (!/east-westservices\.com$/i.test(location.hostname)){ alert("Open the snow database (east-westservices.com/dba/snow) and log in, then click Sync again."); return; }
  if (document.getElementById("rmSync")) return;

  // ---------- panel ----------
  const box = document.createElement("div"); box.id = "rmSync";
  box.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(20,24,33,.55);display:flex;align-items:flex-start;justify-content:center;padding:30px 12px;overflow:auto;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2330";
  box.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:680px;width:100%;padding:22px 22px 18px;box-shadow:0 12px 40px rgba(0,0,0,.3)">
    <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0;font-size:21px">\u{27F3} Sync salt routes</h2><button id="rsX" style="border:0;background:none;font-size:24px;cursor:pointer">\u{D7}</button></div>
    <p style="margin:6px 0 14px;color:#6b7385">Reads every SALT run from the snow database, compares it with the routes on the site, and makes new files to upload.</p>
    <form id="rsForm"><label style="font-weight:600">Admin password</label>
      <input id="rsPw" type="password" style="width:100%;box-sizing:border-box;font-size:16px;padding:10px 12px;border:1px solid #c9ced8;border-radius:10px;margin:4px 0 12px">
      <button id="rsGo" style="font-size:16px;padding:10px 18px;border:0;border-radius:10px;background:#1a73e8;color:#fff;font-weight:600;cursor:pointer">Start sync</button></form>
    <div id="rsLog" style="margin-top:14px;white-space:pre-wrap;font-size:14px"></div>
    <div id="rsOut"></div></div>`;
  document.body.appendChild(box);
  const $ = s => box.querySelector(s);
  $("#rsX").onclick = () => box.remove();
  const log = t => { $("#rsLog").textContent += t + "\n"; };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  // ---------- shared helpers (same as the app) ----------
  const SENS_RE = /\b(code|combo|lock ?box|key ?box|intercom|gate|passcode|password|pin|alarm)\b(\s*(?:for\s+gate\s*)?[:#-]?\s*)([A-Z]?\d[\d#]*(?:[\s,\/]+[A-Z]?\d[\d#]*)*)/gi;
  const PHONE_RE = /\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g;
  const CODEWORD_RE = /\b(code)(:?\s+)(?!for\b|left\b|in\b|to\b|on\b|is\b|at\b|the\b|box\b)([a-z]{3,})\b/gi;
  const redact = t => String(t || "").replace(SENS_RE, (m, k, sep) => k + sep + "\u{1F512}").replace(PHONE_RE, "\u{1F512} phone").replace(CODEWORD_RE, (m, k, sep) => k + sep + "\u{1F512}");
  async function pbkdf(pw, salt, use){
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256"}, base, {name: "AES-GCM", length: 256}, false, [use]);
  }
  async function encPack(obj, pw){
    const gz = new Uint8Array(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, await pbkdf(pw, salt, "encrypt"), gz));
    const out = new Uint8Array(34 + ct.length); out.set(new TextEncoder().encode("RMENC1")); out.set(salt, 6); out.set(iv, 22); out.set(ct, 34); return out;
  }
  async function decPack(buf, pw){
    try { const plain = await crypto.subtle.decrypt({name: "AES-GCM", iv: buf.slice(22, 34)}, await pbkdf(pw, buf.slice(6, 22), "decrypt"), buf.slice(34));
      return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text()); } catch(e){ return null; }
  }
  const norm = s => String(s || "").toLowerCase().replace(/crescent/g, "cres").replace(/avenue/g, "ave").replace(/street/g, "st").replace(/road/g, "rd").replace(/[^a-z0-9]/g, "");
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // Turns one database row into map pins, in the same note format as the app (ported from the original import).
  const RNG = /^(\d+[A-Za-z]?)((?:\s*[-\/]\s*\d+[A-Za-z]?)+)\s+(.+)$/;
  function splitParts(loc){
    const parts = loc.split("+").map(x => x.trim()), out = [];
    parts.forEach((p, i) => {
      if (/^\d+[A-Za-z]?$/.test(p)){
        const q = parts.slice(i + 1).find(q => !/^\d+[A-Za-z]?$/.test(q)) || "";
        p = p + " " + q.replace(/^[\d\-\/A-Za-z]*\d[A-Za-z]?\s+/, "");
      }
      out.push(p);
    });
    return out;
  }
  function stopPins(row){
    const [n, cust, loc0, cross, , , , , , tasks0] = row; const loc = loc0.trim();
    const tasks = (tasks0 || "").trim() || "Empty";
    if (!/^\d/.test(loc)){
      const desc = [cust, cross].filter(Boolean).join(", ");
      return [{name: loc, note: `#${n} ${loc} - ${desc}. ${tasks}`, kind: "named", key: norm(loc), loc}];
    }
    const parts = splitParts(loc), first = parts[0], incl = parts.slice(1);
    const tag = /\((ABS|TV)\)$/.exec(first), base = first.replace(/\s*\((ABS|TV)\)$/, "");
    const inc = incl.length ? ` (incl. ${incl.join(" + ")})` : "";
    const m = RNG.exec(base);
    if (m){
      const [, a, rest, street] = m; const nums = rest.trim().replace(/^[-\/\s]+|[-\/\s]+$/g, "").split(/\s*[-\/]\s*/);
      let b = nums[nums.length - 1];
      if (b.length < a.length && /^\d+$/.test(a) && /^\d+$/.test(b)) b = a.slice(0, a.length - b.length) + b;
      return [{name: `${a} ${street}`, note: `#${n} Start (${base})${inc} - ${tasks}`, kind: "start", key: norm(base), loc},
              {name: `${b} ${street}`, note: `#${n} End (${base})`, kind: "end", key: norm(base), loc}];
    }
    return [{name: base + (tag ? " " + tag[0] : ""), note: `#${n} -${inc} ${tasks}`.replace("-  ", "- "), kind: "plain", key: norm(base + (tag ? " " + tag[0] : "")), loc}];
  }

  // ---------- run ----------
  $("#rsForm").onsubmit = async e => {
    e.preventDefault(); const pw = $("#rsPw").value; if (!pw) return $("#rsPw").focus();
    $("#rsGo").disabled = true; $("#rsGo").textContent = "Working\u{2026}";
    try { await run(pw); } catch(err){ log("\u{26A0} Stopped: " + err.message); }
    $("#rsGo").disabled = false; $("#rsGo").textContent = "Run again";
  };

  async function run(pw){
    $("#rsLog").textContent = ""; $("#rsOut").innerHTML = "";
    log("Loading the routes on the site\u{2026}");
    const kr = await fetch(SITE + "keys.enc?" + Date.now(), {cache: "no-store"});
    const K = kr.ok ? await decPack(new Uint8Array(await kr.arrayBuffer()), pw) : null;
    if (!K) throw new Error("That admin password didn't open the site's keys.");
    const meta = await (await fetch(SITE + "meta.json?" + Date.now(), {cache: "no-store"})).json();
    const RUNS = await (await fetch(SITE + "runs.enc?" + Date.now(), {cache: "no-store"})).json();
    const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const b64e = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
    const gz = async o => new Uint8Array(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    async function decRaw(b64, k){ const buf = b64d(b64), key = await crypto.subtle.importKey("raw", b64d(k), "AES-GCM", false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({name: "AES-GCM", iv: buf.slice(0, 12)}, key, buf.slice(12));
      return JSON.parse(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text()); }
    async function encRaw(o, k){ const key = await crypto.subtle.importKey("raw", b64d(k), "AES-GCM", false, ["encrypt"]), iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, await gz(o))); const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64e(out); }
    const curLists = [], SMALL = {};
    for (const id of RUNS.order){ if (!K.keys[id]) continue; const o = await decRaw(RUNS.runs[id], K.keys[id]); curLists.push(o.list); Object.assign(SMALL, o.sm || {}); }
    const cur = {map: {...meta, lists: curLists}, sm: SMALL};
    let priv = {};
    const pr = {ok: false};
    if (pr.ok){ priv = await decPack(new Uint8Array(await pr.arrayBuffer()), pw); if (!priv) throw new Error("That crew password didn't open the codes file."); }
    const S = cur.map;
    // index the current pins so locations, site maps and IDs carry over
    const all = []; S.lists.forEach(l => l.places.forEach(p => all.push({l, p, full: priv[p.id] || p.note})));
    const idx = {named: {}, start: {}, end: {}, plain: {}};
    all.forEach(x => {
      const nt = x.full || "";
      let m = /^#\s*\d+\s*(Start|End)\s*\(([^)]*)\)/.exec(nt);
      if (m){ (idx[m[1].toLowerCase()][norm(m[2])] ||= []).push(x); return; }
      m = /^#\s*\d+\s+([A-Za-z].*?)\s+-\s/.exec(nt);
      if (m){ (idx.named[norm(m[1])] ||= []).push(x); return; }
      (idx.plain[norm(x.p.name)] ||= []).push(x);
    });
    const used = new Set();
    const findOld = (pin, listName) => {
      const arr = (idx[pin.kind][pin.key] || []).filter(x => !used.has(x.p.id));
      return arr.find(x => x.l.name === listName) || arr[0] || null;
    };

    log("Reading the list of SALT runs\u{2026}");
    const home = new DOMParser().parseFromString(await (await fetch("HomeBase.php", {credentials: "include"})).text(), "text/html");
    const sel = [...home.querySelectorAll("form")].find(f => f.querySelector("input[name=routeType][value=Salt]"));
    if (!sel) throw new Error("Couldn't find the SALT run list. Are you logged in?");
    const runs = [...sel.querySelectorAll("select[name=routeNum] option")].filter(o => o.value !== "999999" && !/^_/.test(o.text.trim())).map(o => ({num: o.value, name: o.text.trim()}));
    log(`Found ${runs.length} runs.`);

    const newLists = [], summary = [], geocodeQ = [];
    for (const r of runs){
      const html = await (await fetch("RoutePrint.php", {method: "POST", credentials: "include", headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: `routeType=Salt&routeNum=${encodeURIComponent(r.num)}&cmdSubmit=Master+List`})).text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const rows = [...doc.querySelectorAll("table")].filter(t => t.rows[0] && t.rows[0].cells[0] && t.rows[0].cells[0].textContent.trim() === "#")
        .flatMap(t => [...t.rows].slice(1).map(tr => [...tr.cells].map(c => c.textContent.replace(/\s+/g, " ").trim()))).filter(c => c.length >= 10 && c[0]);
      const xml = new DOMParser().parseFromString(await (await fetch(`GMapgenxml.php?routeNum=${encodeURIComponent(r.num)}&routeType=Salt`, {credentials: "include"})).text(), "text/xml");
      const coords = {}; [...xml.getElementsByTagName("marker")].forEach(m => { const la = +m.getAttribute("lat"), ln = +m.getAttribute("lng"); if (la && ln) coords[norm(m.getAttribute("address"))] ||= [la, ln]; });
      const listName = `${r.name} ${SEASON}`;
      const old = S.lists.find(l => l.name === listName) || S.lists.find(l => l.name.startsWith(r.name));
      const places = [];
      rows.forEach(row => stopPins(row).forEach(pin => {
        const o = findOld(pin, old ? old.name : listName);
        let p;
        if (o){ used.add(o.p.id); p = {...o.p, name: o.p.name || pin.name, note: pin.note}; p._was = o; }
        else {
          const c = coords[norm(pin.loc)] || null;
          p = {id: uid(), name: pin.name, address: "", note: pin.note, lat: c ? c[0] : null, lng: c ? c[1] : null};
          if (!c) geocodeQ.push(p); p._new = true;
        }
        places.push(p);
      }));
      // changes for this run
      const oldPl = old ? old.places : [];
      const added = places.filter(p => p._new || (p._was && p._was.l !== old)).map(p => p.name);
      const keep = new Set(places.map(p => p.id));
      const removed = oldPl.filter(p => !keep.has(p.id)).map(p => p.name);
      const commonOld = oldPl.filter(p => keep.has(p.id)).map(p => p.id), commonNew = places.filter(p => commonOld.includes(p.id)).map(p => p.id);
      const reordered = commonOld.join() !== commonNew.join();
      const noteCh = places.filter(p => p._was && (p._was.full || "") !== p.note).length;
      summary.push({name: listName, added, removed, reordered, noteCh, isNew: !old});
      newLists.push({id: old ? old.id : uid(), name: listName, color: old ? old.color : "#1a73e8", visible: true, places});
      log(`\u{2022} ${listName}: ${places.length} pins`);
    }

    // find locations for brand-new addresses
    if (geocodeQ.length){
      log(`Finding locations for ${geocodeQ.length} new address${geocodeQ.length === 1 ? "" : "es"}\u{2026}`);
      for (const p of geocodeQ){
        try {
          const j = await (await fetch(`https://photon.komoot.io/api/?limit=1&lat=43.7&lon=-79.4&q=${encodeURIComponent(p.name.replace(/\s*\((ABS|TV)\)$/, "") + ", Toronto, Ontario")}`)).json();
          const f = j.features && j.features[0];
          if (f && f.geometry){ p.lng = +f.geometry.coordinates[0].toFixed(6); p.lat = +f.geometry.coordinates[1].toFixed(6); p._guess = true;
            const pr2 = f.properties || {}; p.address = [[pr2.housenumber, pr2.street].filter(Boolean).join(" "), pr2.city, pr2.state, pr2.postcode].filter(Boolean).join(", "); }
        } catch(e){}
        await new Promise(r => setTimeout(r, 400));
      }
    }

    // build files
    newLists.forEach(l => l.places.forEach(p => { delete p._was; delete p._new; }));
    const flagged = []; newLists.forEach(l => l.places.forEach(p => { if (p._guess || p.lat == null) flagged.push({run: l.name, name: p.name, none: p.lat == null}); delete p._guess; }));
    const out = {...S, lists: newLists, savedAt: Date.now(), publishedAt: Date.now()};
    const changed = summary.filter(s => s.isNew || s.added.length || s.removed.length || s.reordered || s.noteCh);
    const removedRuns = S.lists.filter(l => !newLists.some(n => n.id === l.id)).map(l => l.name);

    const dl = (name, data, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], {type})); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000); };
    $("#rsOut").innerHTML = `<h3 style="margin:16px 0 6px">${changed.length || removedRuns.length ? "Changes found" : "\u{2713} Everything already matches the database"}</h3>
      ${changed.map(s => `<div style="border:1px solid #e3e6ec;border-radius:10px;padding:8px 12px;margin:6px 0"><b>${esc(s.name)}</b>${s.isNew ? " <span style='color:#188038'>(new run)</span>" : ""}
        ${s.added.length ? `<div style="color:#188038">\u{FF0B} ${s.added.length} added: ${s.added.map(esc).join(", ")}</div>` : ""}
        ${s.removed.length ? `<div style="color:#c5221f">\u{2212} ${s.removed.length} removed: ${s.removed.map(esc).join(", ")}</div>` : ""}
        ${s.reordered ? `<div>\u{2195} Stop order changed</div>` : ""}${s.noteCh ? `<div>\u{270E} ${s.noteCh} note${s.noteCh === 1 ? "" : "s"} updated</div>` : ""}</div>`).join("")}
      ${removedRuns.length ? `<div style="color:#c5221f;margin:6px 0">Runs no longer in the database: ${removedRuns.map(esc).join(", ")}</div>` : ""}
      ${flagged.length ? `<div style="background:#fef7e0;border:1px solid #f9e29c;border-radius:10px;padding:8px 12px;margin:10px 0"><b>Check these pins after uploading</b> (Admin \u{2192} Edit \u{2192} \u{1F4CD} Set on map):<br>${flagged.map(f => `${esc(f.run)}: ${esc(f.name)} ${f.none ? "<b>(no location found)</b>" : "(location guessed)"}`).join("<br>")}</div>` : ""}
      ${changed.length || removedRuns.length ? `<button id="rsDl" style="font-size:16px;padding:10px 18px;border:0;border-radius:10px;background:#188038;color:#fff;font-weight:600;cursor:pointer">\u{2B07} Download the files</button>
      <p style="font-size:14px">Then upload the downloaded files (<b>runs.enc</b>, <b>meta.json</b>, and <b>keys.enc</b> if there's a new run) on the <a href="https://github.com/Cowtowski/salt-route-maps/upload/main" target="_blank" rel="noopener">GitHub upload page</a> and click Commit changes.</p>` : ""}`;
    const b = $("#rsDl");
    if (b) b.onclick = async () => {
      b.disabled = true; b.textContent = "Locking runs\u{2026}";
      let dirty = false; const runsOut = {v: 1, order: [], runs: {}};
      for (const l of newLists){
        if (!K.keys[l.id]){ K.keys[l.id] = b64e(crypto.getRandomValues(new Uint8Array(32))); dirty = true; }
        const sm = {}; l.places.forEach(p => { if (p.smimg && SMALL[p.smimg]) sm[p.smimg] = SMALL[p.smimg]; });
        runsOut.order.push(l.id); runsOut.runs[l.id] = await encRaw({list: l, sm}, K.keys[l.id]);
      }
      const m2 = {...meta, publishedAt: Date.now(), savedAt: Date.now()};
      dl("runs.enc", JSON.stringify(runsOut), "application/json");
      setTimeout(() => dl("meta.json", JSON.stringify(m2), "application/json"), 700);
      if (dirty){ const ke = await encPack({keys: K.keys, logKey: K.logKey}, pw); setTimeout(() => dl("keys.enc", ke, "application/octet-stream"), 1400); }
      b.textContent = "\u{2713} Downloaded";
      if (newLists.some(l => !RUNS.runs[l.id])) log("New run(s) added: after uploading, assign them to drivers in the app (\u{1F465} Drivers).");
    };
    log("Done.");
  }
})();
