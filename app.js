(() => {
const $ = id => document.getElementById(id);
const GOAL = 3000, KEY = "margot-driving-trips-v2", DIRTY = "margot-dirty", CFG = "margot-gh-config";
const DATA_PATH = "data/trajets.json", XLSX_PATH = "data/carnet_trajets.xlsx";
const presets = {
  lycee:{departure:"Maison",arrival:"Lycée",distance:4.5},
  saintjulien:{departure:"Maison",arrival:"Saint Julien les Rosiers",distance:7},
  couronne:{departure:"Maison",arrival:"La Couronne",distance:135},
  avignon:{departure:"Maison",arrival:"Avignon",distance:74}
};
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
let trips = load(KEY, []); if (!Array.isArray(trips)) trips = [];
const iso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const fmt = n => Number(Number(n).toFixed(1)).toLocaleString("fr-FR");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const arr = v => Array.isArray(v) ? v : (v ? [v] : []);
const checked = n => [...document.querySelectorAll(`input[name="${n}"]:checked`)].map(x => x.value);
const setChecks = (n, v) => document.querySelectorAll(`input[name="${n}"]`).forEach(x => x.checked = arr(v).includes(x.value));
const kmValue = () => { const n = parseFloat($("distance").value); return Number.isFinite(n) && n > 0 ? n : 0; };
const counted = () => kmValue() * ($("roundTrip").checked ? 2 : 1);

// Logo : essaie plusieurs extensions
const exts = ["png","jpg","jpeg","svg","webp"]; let ei = 0;
$("logo").onerror = () => { if (++ei < exts.length) $("logo").src = `IMG/logo.${exts[ei]}`; else $("logo").style.display = "none"; };

let toastT;
function toast(msg, err) { const t = $("toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(() => t.className = "toast", 3500); }

// Compteur : trajets enregistrés (hors trajet en cours de modification) + saisie en cours
function updateTotal() {
  const editId = $("editId").value;
  const saved = trips.filter(t => t.id !== editId).reduce((s, t) => s + (Number(t.countedDistance) || 0), 0);
  const draft = counted(), total = saved + draft;
  const ps = Math.min(100, saved / GOAL * 100);
  $("totalKm").textContent = fmt(total);
  $("barSaved").style.width = ps + "%";
  $("barDraft").style.width = Math.min(100 - ps, draft / GOAL * 100) + "%";
  $("totalDetail").textContent = draft ? `dont ${fmt(draft)} km en cours de saisie` : `${fmt(Math.max(0, GOAL - total))} km restants`;
}
function updateCounted() { $("counted").value = `${Number(counted().toFixed(2))} km`; updateTotal(); }

// ---------- GitHub ----------
const cfg = () => load(CFG, {});
const ready = () => { const c = cfg(); return !!(c.repo && c.token); };
const b64 = s => btoa(unescape(encodeURIComponent(s)));
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/\s/g, ""))));
const bufB64 = b => { let s = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(s); };
const url = p => `https://api.github.com/repos/${cfg().repo}/contents/${p}`;
const head = () => ({ Authorization: `Bearer ${cfg().token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" });
const branch = () => cfg().branch || "main";
async function getFile(p) {
  const r = await fetch(`${url(p)}?ref=${encodeURIComponent(branch())}`, { headers: head(), cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(r.status === 401 ? "jeton refusé" : `erreur GitHub ${r.status}`);
  return r.json();
}
async function putFile(p, content, message) {
  for (let i = 0; i < 2; i++) {
    const old = await getFile(p);
    const r = await fetch(url(p), { method: "PUT", headers: head(), body: JSON.stringify({ message, content, branch: branch(), ...(old ? { sha: old.sha } : {}) }) });
    if (r.ok) return;
    if (r.status !== 409 && r.status !== 422) throw new Error(r.status === 403 || r.status === 401 ? "jeton sans droit d’écriture" : `erreur GitHub ${r.status}`);
  }
  throw new Error("conflit d’écriture");
}
function setStatus(s, msg) {
  const c = $("syncChip");
  const map = { off:["GitHub non configuré",""], busy:["Synchronisation…",""], ok:["✓ Sauvegardé sur GitHub","ok"], pending:["● Non synchronisé – toucher pour réessayer","warn"], err:["⚠ GitHub : "+(msg||"erreur"),"warn"] };
  c.textContent = map[s][0] + (s === "pending" && msg ? ` (${msg})` : ""); c.className = "chip " + map[s][1];
}
let chain = Promise.resolve();
function sync() {
  chain = chain.then(async () => {
    if (!ready()) { setStatus("off"); return false; }
    setStatus("busy");
    try {
      await putFile(DATA_PATH, b64(JSON.stringify(trips, null, 2)), `Carnet de conduite : ${trips.length} trajet(s)`);
      localStorage.setItem(DIRTY, "0");
      try { await putFile(XLSX_PATH, bufB64(await buildXlsx()), "Mise à jour du fichier Excel"); } catch (e) { console.warn("Excel non mis à jour", e); }
      setStatus("ok"); return true;
    } catch (e) { setStatus("pending", e.message); return false; }
  });
  return chain;
}
async function pull() {
  if (!ready()) return setStatus("off");
  if (localStorage.getItem(DIRTY) === "1") return sync();
  setStatus("busy");
  try {
    const f = await getFile(DATA_PATH);
    if (f) { const d = JSON.parse(unb64(f.content)); if (Array.isArray(d)) { trips = d; localStorage.setItem(KEY, JSON.stringify(trips)); renderTrips(); updateTotal(); } setStatus("ok"); }
    else if (trips.length) return sync();
    else setStatus("ok");
  } catch (e) { setStatus("err", e.message); }
}

// ---------- Excel ----------
const COLS = [["Date du trajet",13],["Départ",24],["Arrivée",24],["Distance parcourue à l’aller (km)",20],["Durée de conduite (minutes)",16],["Aller-retour",12],["Distance totale comptabilisée (km)",20],["Moment de la journée",16],["Météo",18],["Type de route",28],["Trafic",12],["Manœuvres réalisées",34],["Remarques",40]];
async function buildXlsx() {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Trajets", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLS.map(([header, width]) => ({ header, width }));
  const rows = [...trips].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  rows.forEach(t => {
    const [y, m, d] = (t.date || "").split("-").map(Number);
    ws.addRow([t.date ? new Date(Date.UTC(y, m - 1, d)) : "", t.departure, t.arrival, t.distance, t.duration || "", t.roundTrip ? "Oui" : "Non", t.countedDistance, arr(t.moment).join(", "), arr(t.meteo).join(", "), arr(t.route).join(", "), arr(t.trafic).join(", "), arr(t.manoeuvres).join(", "), t.notes || ""]);
  });
  ws.getColumn(1).numFmt = "dd/mm/yyyy";
  const n = rows.length;
  if (n) {
    const tot = ws.addRow([]); tot.getCell(1).value = "TOTAL";
    tot.getCell(7).value = { formula: `SUM(G2:G${n + 1})`, result: rows.reduce((s, t) => s + (Number(t.countedDistance) || 0), 0) };
    tot.font = { bold: true }; tot.eachCell({ includeEmpty: true }, c => c.border = { top: { style: "medium" } });
    ws.autoFilter = `A1:M${n + 1}`;
  }
  ws.eachRow((r, i) => r.eachCell({ includeEmpty: true }, c => c.alignment = { vertical: i === 1 ? "middle" : "top", wrapText: true, horizontal: i === 1 ? "center" : undefined }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(1).height = 36;
  ws.getRow(1).eachCell(c => c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF102A56" } });
  return wb.xlsx.writeBuffer();
}
function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
async function exportXlsx() {
  if (!window.ExcelJS) return toast("Bibliothèque Excel indisponible (connexion Internet ?)", true);
  if (!trips.length) return toast("Aucun trajet à exporter", true);
  try { download(new Blob([await buildXlsx()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `carnet-conduite-${iso()}.xlsx`); toast("Tableau Excel téléchargé"); }
  catch (e) { toast("Export impossible : " + e.message, true); }
}

// ---------- Formulaire ----------
function resetForm() {
  $("tripForm").reset(); $("editId").value = ""; $("preset").value = ""; $("date").value = iso();
  $("formTitle").textContent = "Enregistrer un trajet"; $("saveBtn").textContent = "Enregistrer ce trajet"; updateCounted();
}
function formData() {
  return { id: $("editId").value || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: $("date").value, departure: $("departure").value.trim(), arrival: $("arrival").value.trim(),
    distance: kmValue(), duration: parseInt($("duration").value, 10) || 0, roundTrip: $("roundTrip").checked, countedDistance: counted(),
    moment: checked("moment"), meteo: checked("meteo"), route: checked("route"), trafic: checked("trafic"), manoeuvres: checked("manoeuvres"), notes: $("notes").value.trim() };
}
async function submitForm(e) {
  if (e) e.preventDefault();
  if (!$("tripForm").reportValidity()) return;
  const item = formData(), i = trips.findIndex(t => t.id === item.id);
  if (i >= 0) trips[i] = item; else trips.push(item);
  trips.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  localStorage.setItem(KEY, JSON.stringify(trips)); localStorage.setItem(DIRTY, "1");
  resetForm(); renderTrips(); updateTotal();
  if (!ready()) { toast("Trajet gardé sur cet appareil – configure GitHub pour le sauvegarder", true); $("openSettings").click(); return; }
  toast("Trajet enregistré, envoi vers GitHub…");
  (await sync()) ? toast("✓ Trajet sauvegardé sur GitHub") : toast("Gardé sur l’appareil, envoi GitHub en attente", true);
}
function renderTrips() {
  const list = $("tripList"); $("historyCount").textContent = `${trips.length} trajet${trips.length > 1 ? "s" : ""} enregistré${trips.length > 1 ? "s" : ""}`;
  if (!trips.length) { list.innerHTML = '<p class="empty">Aucun trajet enregistré pour le moment.</p>'; return; }
  const j = v => esc(arr(v).join(", ") || "—");
  list.innerHTML = trips.map(t => `<article class="trip"><div class="triptop"><div><h3>${esc(t.departure)} → ${esc(t.arrival)}</h3><p>${esc(t.date || "Date non précisée")} · ${fmt(t.countedDistance || 0)} km comptabilisés${t.duration ? ` · ${t.duration} min` : ""}</p></div><span class="pill">${t.roundTrip ? "Aller-retour" : "Aller simple"}</span></div>
<p><strong>Moment :</strong> ${j(t.moment)} &nbsp; <strong>Météo :</strong> ${j(t.meteo)}</p>
<p><strong>Route :</strong> ${j(t.route)} &nbsp; <strong>Trafic :</strong> ${j(t.trafic)}</p>
${arr(t.manoeuvres).length ? `<p><strong>Manœuvres :</strong> ${j(t.manoeuvres)}</p>` : ""}${t.notes ? `<p><strong>Remarques :</strong> ${esc(t.notes)}</p>` : ""}
<div class="actions"><button class="btn secondary" type="button" data-edit="${esc(t.id)}">Modifier</button><button class="btn danger" type="button" data-delete="${esc(t.id)}">Supprimer</button></div></article>`).join("");
  list.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editTrip(b.dataset.edit));
  list.querySelectorAll("[data-delete]").forEach(b => b.onclick = () => deleteTrip(b.dataset.delete));
}
function editTrip(id) {
  const t = trips.find(x => x.id === id); if (!t) return;
  $("editId").value = t.id; $("date").value = t.date || ""; $("departure").value = t.departure || ""; $("arrival").value = t.arrival || "";
  $("distance").value = t.distance || ""; $("duration").value = t.duration || ""; $("roundTrip").checked = !!t.roundTrip; $("preset").value = "";
  ["moment","meteo","route","trafic","manoeuvres"].forEach(n => setChecks(n, t[n])); $("notes").value = t.notes || "";
  $("formTitle").textContent = "Modifier un trajet"; $("saveBtn").textContent = "Enregistrer les modifications"; updateCounted(); window.scrollTo({ top: 0, behavior: "smooth" });
}
async function deleteTrip(id) {
  if (!confirm("Supprimer définitivement ce trajet ?")) return;
  trips = trips.filter(t => t.id !== id); localStorage.setItem(KEY, JSON.stringify(trips)); localStorage.setItem(DIRTY, "1");
  renderTrips(); updateTotal(); (await sync()) || toast("Suppression en attente de synchronisation", true);
}

// ---------- Événements ----------
$("preset").addEventListener("change", () => { const p = presets[$("preset").value]; if (!p) return; $("departure").value = p.departure; $("arrival").value = p.arrival; $("distance").value = p.distance; updateCounted(); });
$("distance").addEventListener("input", updateCounted); $("roundTrip").addEventListener("change", updateCounted);
$("tripForm").addEventListener("submit", submitForm); $("stickySave").addEventListener("click", () => submitForm());
$("resetBtn").addEventListener("click", resetForm);
$("showHistory").addEventListener("click", () => { $("history").classList.remove("hidden"); renderTrips(); $("history").scrollIntoView({ behavior: "smooth" }); exportXlsx(); });
$("closeHistory").addEventListener("click", () => $("history").classList.add("hidden"));
$("downloadXlsx").addEventListener("click", exportXlsx);
$("downloadJson").addEventListener("click", () => download(new Blob([JSON.stringify(trips, null, 2)], { type: "application/json" }), "margot-trajets.json"));
$("syncChip").addEventListener("click", () => ready() ? (localStorage.getItem(DIRTY) === "1" ? sync() : pull()) : $("openSettings").click());
$("openSettings").addEventListener("click", () => {
  const c = cfg(), h = location.hostname.endsWith("github.io") ? `${location.hostname.split(".")[0]}/${location.pathname.split("/")[1] || ""}` : "";
  $("cfgRepo").value = c.repo || h; $("cfgBranch").value = c.branch || "main"; $("cfgToken").value = c.token || ""; $("settings").showModal();
});
$("cfgSave").addEventListener("click", e => {
  e.preventDefault();
  const repo = $("cfgRepo").value.trim(), token = $("cfgToken").value.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) return toast("Renseigne le dépôt (propriétaire/nom) et le jeton", true);
  localStorage.setItem(CFG, JSON.stringify({ repo, token, branch: $("cfgBranch").value.trim() || "main" }));
  $("settings").close(); pull();
});
resetForm(); renderTrips(); pull();
})();
