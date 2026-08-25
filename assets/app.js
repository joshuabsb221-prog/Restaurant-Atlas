const WEIGHTS = Object.freeze({ food: 2, ambiance: 1, price: 1 });
const STORAGE_KEY = "restaurant-atlas-v1";
const SCORE_SORTS = new Set(["overall", "food", "ambiance", "price"]);
const FALLBACK_NAMES = [
  ["Bill's","British"],["Oka","Japanese"],["Matsuba","Japanese"],["Passione Vino","Italian"],
  ["Tortilla","Mexican"],["Grasso","Italian"],["GBK","Burgers"],["Bingham Hotel","Modern British"],
  ["Franco Manca","Pizza"],["Passyunk Avenue","American"],["Sebastian's Italian","Italian"],["Patara","Thai"],
  ["Hare & Tortoise","Pan-Asian"],["Itsu","Japanese"],["Speedboat Bar","Thai"],["Coppa Club","Modern European"],
  ["Lina Stores","Italian"],["Portofino Pizzeria","Pizza"],["Gopal's Corner","Malaysian"],["Plaza Khao Gaeng","Thai"],
  ["Tangra","Indo-Chinese"],["Noci","Italian"],["Rosa's","Thai"],["Bone Daddies","Ramen"],
  ["Tonkotsu","Ramen"],["Nando's","Peri-Peri"],["Honest Greens","Mediterranean"],["Heisenberg Breakfast Co","Breakfast"],
  ["Thai Lotus","Thai"],["Club Mexicana","Vegan Mexican"],["Breadstall Pizza","Pizza"],["Kokoro","Korean & Japanese"],
  ["Jojo's Peri Peri","Peri-Peri"],["It's Bagels","Bagels"],["Pepe's","Peri-Peri"],["Taco Bell","Mexican"],
  ["Indi Go Rasoi","Indian"]
];

const fallbackRestaurants = FALLBACK_NAMES.map(([name, cuisine], index) => ({
  id: `seed-${String(index + 1).padStart(2, "0")}`, name, cuisine,
  food: null, ambiance: null, price: null, overall: null, returnVerdict: "",
  notes: "", dish: "", visited: "", created: "2026-01-01T00:00:00.000Z"
}));

const state = { restaurants: [], search: "", status: "all", sort: "overall", lastFocus: null, deleteTimer: null };
const el = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  populateGutScores();
  bindEvents();
  state.restaurants = await loadRestaurants();
  render();
}

function cacheElements() {
  ["restaurantGrid","emptyState","search","statusFilter","sortBy","resultCount","resultsTitle",
    "statTotal","statRated","statAverage","statTop","statReturn","addRestaurant","exportData","importData","importFile",
    "restaurantModal","restaurantForm","modalTitle","modalEyebrow","recordId","name","food","ambiance",
    "price","overall","returnVerdict","dish","notes","weightedAverage","deleteRestaurant","toast"
  ].forEach(id => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el.addRestaurant.addEventListener("click", () => openModal());
  el.search.addEventListener("input", event => { state.search = event.target.value.trim().toLowerCase(); renderCards(); });
  el.statusFilter.addEventListener("change", event => { state.status = event.target.value; renderCards(); });
  el.sortBy.addEventListener("change", event => { state.sort = event.target.value; renderCards(); });
  el.restaurantGrid.addEventListener("click", event => {
    const card = event.target.closest("article[data-id]");
    if (card) openModal(card.dataset.id);
  });
  el.restaurantGrid.addEventListener("keydown", event => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("article[data-id]")) {
      event.preventDefault(); openModal(event.target.dataset.id);
    }
  });
  document.querySelectorAll("[data-close-modal]").forEach(node => node.addEventListener("click", closeModal));
  document.querySelectorAll(".score-toggle").forEach(button => button.addEventListener("click", () => toggleScore(button.dataset.score)));
  [el.food, el.ambiance, el.price].forEach(input => input.addEventListener("input", updateRatingReadout));
  document.getElementById("verdictControl").addEventListener("click", event => {
    const button = event.target.closest("button[data-verdict]");
    if (!button) return;
    const next = el.returnVerdict.value === button.dataset.verdict ? "" : button.dataset.verdict;
    el.returnVerdict.value = next; updateVerdictButtons(next);
  });
  el.restaurantForm.addEventListener("submit", saveForm);
  el.deleteRestaurant.addEventListener("click", handleDelete);
  el.exportData.addEventListener("click", exportData);
  el.importData.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", importData);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !el.restaurantModal.hidden) closeModal(); });
}

async function loadRestaurants() {
  const stored = safeStorageGet();
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.map(normalizeRestaurant);
      if (Array.isArray(parsed.restaurants)) return parsed.restaurants.map(normalizeRestaurant);
    } catch { /* Use seed data below. */ }
  }
  let seed = fallbackRestaurants;
  try {
    const response = await fetch("data/restaurants.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Seed request failed");
    const parsed = await response.json();
    if (Array.isArray(parsed.restaurants)) seed = parsed.restaurants;
  } catch { /* file:// and offline first loads use the embedded seed. */ }
  const normalized = seed.map(normalizeRestaurant);
  safeStorageSet(normalized);
  return normalized;
}

function normalizeRestaurant(input = {}, index = 0) {
  const allowedVerdicts = new Set(["", "yes", "maybe", "no"]);
  const cleanScore = value => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(10, Math.max(1, Math.round(number * 2) / 2)) : null;
  };
  const name = String(input.name || "Untitled restaurant").trim().slice(0, 120) || "Untitled restaurant";
  const createdDate = new Date(input.created || "");
  return {
    id: String(input.id || `restaurant-${Date.now()}-${index}-${Math.random().toString(36).slice(2,8)}`),
    name,
    cuisine: String(input.cuisine || "Uncategorised").trim().slice(0, 80) || "Uncategorised",
    food: cleanScore(input.food), ambiance: cleanScore(input.ambiance), price: cleanScore(input.price), overall: cleanScore(input.overall),
    returnVerdict: allowedVerdicts.has(input.returnVerdict) ? input.returnVerdict : "",
    notes: String(input.notes || "").slice(0, 1500), dish: String(input.dish || "").slice(0, 160),
    visited: /^\d{4}-\d{2}-\d{2}$/.test(String(input.visited || "")) ? String(input.visited) : "",
    created: Number.isNaN(createdDate.getTime()) ? new Date().toISOString() : createdDate.toISOString()
  };
}

function weightedScore(restaurant) {
  if ([restaurant.food, restaurant.ambiance, restaurant.price].some(value => value === null)) return null;
  const totalWeight = WEIGHTS.food + WEIGHTS.ambiance + WEIGHTS.price;
  return (restaurant.food * WEIGHTS.food + restaurant.ambiance * WEIGHTS.ambiance + restaurant.price * WEIGHTS.price) / totalWeight;
}

function effectiveScore(restaurant) { return restaurant.overall ?? weightedScore(restaurant); }
function rounded(value) { return value === null ? "—" : (Math.round(value * 10) / 10).toFixed(1); }
function isRated(restaurant) { return effectiveScore(restaurant) !== null; }

function render() { renderStats(); renderCards(); }

function renderStats() {
  const rated = state.restaurants.filter(isRated);
  const scores = rated.map(effectiveScore);
  const top = [...rated].sort((a,b) => effectiveScore(b) - effectiveScore(a) || a.name.localeCompare(b.name))[0];
  el.statTotal.textContent = state.restaurants.length;
  el.statRated.textContent = `${rated.length} rated`;
  el.statAverage.textContent = scores.length ? rounded(scores.reduce((sum,value) => sum + value, 0) / scores.length) : "—";
  el.statTop.textContent = top ? top.name : "Not yet ranked";
  el.statReturn.textContent = state.restaurants.filter(item => item.returnVerdict === "yes").length;
}

function getVisibleRestaurants() {
  const filtered = state.restaurants.filter(item => {
    const haystack = [item.name,item.dish,item.notes].join(" ").toLowerCase();
    const statusMatch = state.status === "all" || (state.status === "rated" && isRated(item)) || (state.status === "unrated" && !isRated(item)) || item.returnVerdict === state.status;
    return (!state.search || haystack.includes(state.search)) && statusMatch;
  });
  return filtered.sort(compareRestaurants);
}

function compareRestaurants(a, b) {
  if (SCORE_SORTS.has(state.sort)) {
    const av = state.sort === "overall" ? effectiveScore(a) : a[state.sort];
    const bv = state.sort === "overall" ? effectiveScore(b) : b[state.sort];
    if (av === null && bv !== null) return 1;
    if (av !== null && bv === null) return -1;
    if (av !== null && bv !== null && bv !== av) return bv - av;
    return a.name.localeCompare(b.name);
  }
  if (state.sort === "name") return a.name.localeCompare(b.name);
  const av = a.created;
  const bv = b.created;
  if (!av && bv) return 1;
  if (av && !bv) return -1;
  return String(bv).localeCompare(String(av)) || a.name.localeCompare(b.name);
}

function renderCards() {
  const items = getVisibleRestaurants();
  el.resultCount.textContent = `${items.length} ${items.length === 1 ? "place" : "places"}`;
  el.resultsTitle.textContent = "Every restaurant";
  el.emptyState.hidden = items.length > 0;
  el.restaurantGrid.innerHTML = items.map((item,index) => cardTemplate(item,index)).join("");
}

function cardTemplate(item, index) {
  const score = effectiveScore(item);
  const ratingBars = [
    ["Food",item.food,""],["Ambiance",item.ambiance,""],["Value",item.price,"score-bar--value"]
  ].map(([label,value,extra]) => `<div class="score-bar ${extra}"><span>${label}</span><div class="track"><div class="fill" style="--score:${value === null ? 0 : value * 10}%"></div></div><b>${value === null ? "—" : rounded(value)}</b></div>`).join("");
  const verdictLabels = { yes: "Would return", maybe: "Maybe return", no: "Wouldn't return", "": "Return undecided" };
  return `<article class="restaurant-card ${score === null ? "is-unrated" : ""}" data-id="${escapeHtml(item.id)}" tabindex="0" aria-label="Edit ${escapeHtml(item.name)}">
    <svg class="card-watermark" aria-hidden="true"><use href="#icon-leaf"/></svg>
    <div class="card-head"><div class="card-head__copy">${SCORE_SORTS.has(state.sort) && score !== null ? `<span class="rank">No. ${index + 1}</span>` : ""}<h3>${escapeHtml(item.name)}</h3></div>
    <div class="score-medallion"><strong>${rounded(score)}</strong><small>${item.overall !== null ? "gut" : score === null ? "unrated" : "score"}</small></div></div>
    ${score === null ? `<p class="unrated-label">Not yet rated</p>` : `<div class="score-bars">${ratingBars}</div>`}
    ${item.dish ? `<p class="card-detail"><strong>Order this</strong> ${escapeHtml(item.dish)}</p>` : ""}
    ${item.notes ? `<p class="card-detail notes">${escapeHtml(item.notes)}</p>` : ""}
    <span class="verdict verdict--${item.returnVerdict || "blank"}">${verdictLabels[item.returnVerdict]}</span>
  </article>`;
}

function openModal(id = "") {
  const item = id ? state.restaurants.find(entry => entry.id === id) : null;
  state.lastFocus = document.activeElement;
  resetDeleteButton();
  el.restaurantForm.reset();
  el.recordId.value = item?.id || "";
  el.name.value = item?.name || ""; el.overall.value = item?.overall ?? ""; el.returnVerdict.value = item?.returnVerdict || "";
  el.dish.value = item?.dish || ""; el.notes.value = item?.notes || "";
  ["food","ambiance","price"].forEach(key => setScoreEnabled(key, item?.[key] !== null && item?.[key] !== undefined, item?.[key] ?? 7.5));
  updateVerdictButtons(el.returnVerdict.value); updateRatingReadout();
  el.modalTitle.textContent = item ? "Edit restaurant" : "Log a restaurant";
  el.modalEyebrow.textContent = item ? "Atlas entry" : "New entry";
  el.deleteRestaurant.hidden = !item;
  el.restaurantModal.hidden = false; document.body.classList.add("modal-open");
  requestAnimationFrame(() => el.name.focus());
}

function closeModal() {
  if (el.restaurantModal.hidden) return;
  el.restaurantModal.hidden = true; document.body.classList.remove("modal-open"); resetDeleteButton();
  state.lastFocus?.focus?.();
}

function toggleScore(key) {
  const input = el[key];
  setScoreEnabled(key, input.disabled, input.value || 7.5);
  updateRatingReadout();
}

function setScoreEnabled(key, enabled, value) {
  const input = el[key]; const button = document.querySelector(`.score-toggle[data-score="${key}"]`);
  input.disabled = !enabled; input.value = value;
  button.setAttribute("aria-pressed", String(enabled)); button.textContent = enabled ? "Clear" : "Add score";
}

function updateRatingReadout() {
  ["food","ambiance","price"].forEach(key => { document.getElementById(`${key}Output`).textContent = el[key].disabled ? "—" : rounded(Number(el[key].value)); });
  const draft = { food: scoreFromInput(el.food), ambiance: scoreFromInput(el.ambiance), price: scoreFromInput(el.price) };
  el.weightedAverage.textContent = rounded(weightedScore(draft));
}
function scoreFromInput(input) { return input.disabled ? null : Number(input.value); }

function updateVerdictButtons(value) {
  document.querySelectorAll("[data-verdict]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.verdict === value)));
}

function saveForm(event) {
  event.preventDefault();
  const existing = state.restaurants.find(item => item.id === el.recordId.value);
  const candidate = normalizeRestaurant({
    id: existing?.id || `restaurant-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    name: el.name.value, cuisine: existing?.cuisine || "Uncategorised", visited: existing?.visited || "",
    food: scoreFromInput(el.food), ambiance: scoreFromInput(el.ambiance), price: scoreFromInput(el.price), overall: el.overall.value,
    returnVerdict: el.returnVerdict.value, dish: el.dish.value, notes: el.notes.value, created: existing?.created || new Date().toISOString()
  });
  if (existing) state.restaurants[state.restaurants.indexOf(existing)] = candidate; else state.restaurants.push(candidate);
  persistAndRender(); closeModal(); showToast(existing ? "Restaurant updated." : "Restaurant added to the atlas.");
}

function handleDelete() {
  if (!el.deleteRestaurant.classList.contains("is-armed")) {
    el.deleteRestaurant.classList.add("is-armed"); el.deleteRestaurant.textContent = "Tap again to confirm";
    state.deleteTimer = setTimeout(resetDeleteButton, 3500); return;
  }
  const id = el.recordId.value;
  state.restaurants = state.restaurants.filter(item => item.id !== id);
  persistAndRender(); closeModal(); showToast("Restaurant deleted.");
}

function resetDeleteButton() {
  clearTimeout(state.deleteTimer); state.deleteTimer = null;
  if (el.deleteRestaurant) { el.deleteRestaurant.classList.remove("is-armed"); el.deleteRestaurant.textContent = "Delete entry"; }
}

function persistAndRender() { safeStorageSet(state.restaurants); render(); }
function safeStorageGet() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } }
function safeStorageSet(restaurants) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: 1, restaurants })); return true; } catch { showToast("Changes work for now, but this browser cannot save them."); return false; } }

function exportData() {
  const payload = { schema: 1, exportedAt: new Date().toISOString(), restaurants: state.restaurants.map(normalizeRestaurant) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "restaurants.json"; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${state.restaurants.length} restaurants.`);
}

async function importData(event) {
  const file = event.target.files?.[0]; event.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.restaurants)) throw new Error("Missing restaurants array");
    let updated = 0; let added = 0;
    parsed.restaurants.forEach((raw,index) => {
      const incoming = normalizeRestaurant(raw,index);
      const matchIndex = state.restaurants.findIndex(existing => existing.id === incoming.id || existing.name.toLowerCase() === incoming.name.toLowerCase());
      if (matchIndex >= 0) { incoming.id = state.restaurants[matchIndex].id; state.restaurants[matchIndex] = incoming; updated += 1; }
      else { state.restaurants.push(incoming); added += 1; }
    });
    persistAndRender(); showToast(`Import complete: ${updated} updated, ${added} added.`);
  } catch { showToast("That file could not be imported. Check its JSON format."); }
}

function populateGutScores() {
  let options = "";
  for (let value = 1; value <= 10; value += .5) options += `<option value="${value}">${value.toFixed(1)}</option>`;
  el.overall.insertAdjacentHTML("beforeend", options);
}

function showToast(message) {
  el.toast.textContent = message; el.toast.hidden = false;
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { el.toast.hidden = true; }, 3200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

window.RestaurantAtlas = Object.freeze({ WEIGHTS, weightedScore, effectiveScore, normalizeRestaurant });
