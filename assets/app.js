const WEIGHTS = Object.freeze({ food: 2, ambiance: 1, price: 1 });
const STORAGE_KEY = "restaurant-atlas-v1";
const SUPABASE_CONFIG = Object.freeze({
  url: "https://cpcoyeuoyeqjmmbowjkh.supabase.co",
  publishableKey: "sb_publishable_yIFHBlWGnuMf7g__ydJXTw_w2at4huL"
});
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

const state = {
  restaurants: [], search: "", status: "all", sort: "overall", lastFocus: null, deleteTimer: null,
  session: null, memberRole: "", remote: false, remoteChannel: null, cloudBusy: false
};
const el = {};
let supabaseClient = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  populateGutScores();
  bindEvents();
  state.restaurants = await loadRestaurants();
  render();
  initializeCloud();
}

function cacheElements() {
  ["restaurantGrid","emptyState","search","statusFilter","sortBy","resultCount","resultsTitle",
    "statTotal","statRated","statAverage","statTop","statReturn","addRestaurant","exportData","importData","importFile",
    "restaurantModal","restaurantForm","modalTitle","modalEyebrow","recordId","name","food","ambiance",
    "price","overall","returnVerdict","dish","notes","weightedAverage","deleteRestaurant","toast",
    "syncStatus","signInButton","historyButton","membersButton","signOutButton","authModal","authForm","authEmail","authCode","authHelp","verifyCodeButton",
    "membersModal","memberForm","memberEmail","memberList","historyModal","historyList"
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
  el.signInButton.addEventListener("click", () => setModal(el.authModal, true, el.authEmail));
  el.authForm.addEventListener("submit", sendSignInLink);
  el.verifyCodeButton.addEventListener("click", verifyEmailCode);
  el.authCode.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); verifyEmailCode(); }
  });
  el.signOutButton.addEventListener("click", signOut);
  el.historyButton.addEventListener("click", openHistory);
  el.membersButton.addEventListener("click", openMembers);
  el.memberForm.addEventListener("submit", addMember);
  el.memberList.addEventListener("click", handleMemberAction);
  document.querySelectorAll("[data-close-auth]").forEach(node => node.addEventListener("click", () => setModal(el.authModal, false)));
  document.querySelectorAll("[data-close-members]").forEach(node => node.addEventListener("click", () => setModal(el.membersModal, false)));
  document.querySelectorAll("[data-close-history]").forEach(node => node.addEventListener("click", () => setModal(el.historyModal, false)));
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!el.restaurantModal.hidden) closeModal();
    else [el.authModal, el.membersModal, el.historyModal].forEach(modal => { if (!modal.hidden) setModal(modal, false); });
  });
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
    returnVerdict: allowedVerdicts.has(input.returnVerdict ?? input.return_verdict) ? (input.returnVerdict ?? input.return_verdict) : "",
    notes: String(input.notes || "").slice(0, 1500), dish: String(input.dish || "").slice(0, 160),
    visited: /^\d{4}-\d{2}-\d{2}$/.test(String(input.visited || "")) ? String(input.visited) : "",
    created: Number.isNaN(createdDate.getTime()) ? new Date().toISOString() : createdDate.toISOString(),
    version: Number.isInteger(Number(input.version)) ? Number(input.version) : 0,
    updatedAt: String(input.updatedAt || input.updated_at || "")
  };
}

function fromRemote(row) {
  return normalizeRestaurant({
    ...row,
    returnVerdict: row.return_verdict,
    updatedAt: row.updated_at,
    cuisine: "Uncategorised",
    visited: ""
  });
}

function toRemote(restaurant) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    food: restaurant.food,
    ambiance: restaurant.ambiance,
    price: restaurant.price,
    overall: restaurant.overall,
    return_verdict: restaurant.returnVerdict,
    dish: restaurant.dish,
    notes: restaurant.notes,
    created: restaurant.created
  };
}

async function initializeCloud() {
  if (!window.supabase?.createClient) {
    setSyncStatus("Local only", "error");
    return;
  }
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    await handleSession(data.session);
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => handleSession(session), 0);
    });
  } catch (error) {
    console.warn("Restaurant Atlas cloud connection unavailable:", error.message);
    setSyncStatus("Local only", "error");
    updateAccountUI();
  }
}

async function handleSession(session) {
  state.session = session;
  state.memberRole = "";
  state.remote = false;
  disconnectRealtime();
  updateAccountUI();
  if (!session || !supabaseClient) {
    setSyncStatus("Local only", "");
    return;
  }

  setSyncStatus("Checking access…", "");
  try {
    const { data: role, error } = await supabaseClient.rpc("claim_atlas_membership");
    if (error) throw error;
    if (!role) {
      setSyncStatus("Access pending", "error");
      showToast("This email is signed in but has not been approved yet.");
      updateAccountUI();
      return;
    }
    state.memberRole = role;
    state.remote = true;
    updateAccountUI();
    await refreshRemoteRestaurants(true);
    subscribeToRemoteChanges();
  } catch (error) {
    console.warn("Restaurant Atlas sign-in check failed:", error.message);
    setSyncStatus("Sync unavailable", "error");
    showToast("Cloud sync is unavailable. Your browser copy is still safe.");
  }
}

async function sendSignInLink(event) {
  event.preventDefault();
  if (!supabaseClient) {
    showToast("Sign-in is not available right now.");
    return;
  }
  const email = el.authEmail.value.trim();
  const button = el.authForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}${location.pathname}` }
    });
    if (error) throw error;
    el.authHelp.textContent = "Email sent. In the email, press and hold Sign in, copy its link, then return and paste it below.";
    el.authCode.focus();
    showToast("Sign-in email sent. Copy its link, then return here.");
  } catch (error) {
    showToast(error.message || "The sign-in email could not be sent.");
  } finally {
    button.disabled = false;
  }
}

async function verifyEmailCode() {
  if (!supabaseClient) {
    showToast("Sign-in is not available right now.");
    return;
  }
  const email = el.authEmail.value.trim();
  const credential = el.authCode.value.trim();
  if (!el.authEmail.checkValidity()) {
    el.authEmail.reportValidity();
    return;
  }
  const linkCredential = verificationFromLink(credential);
  const isEmailCode = /^\d{6}$/.test(credential);
  if (!linkCredential && !isEmailCode) {
    showToast("Paste the copied Sign in link from your email.");
    el.authCode.focus();
    return;
  }
  el.verifyCodeButton.disabled = true;
  try {
    const verification = linkCredential
      ? { token_hash: linkCredential.tokenHash, type: linkCredential.type }
      : { email, token: credential, type: "email" };
    const { error } = await supabaseClient.auth.verifyOtp(verification);
    if (error) throw error;
    setModal(el.authModal, false);
    el.authForm.reset();
    el.authHelp.textContent = "Use an approved email address. We’ll email a secure sign-in link—no password needed.";
    showToast("Signed in. Your shared atlas is syncing now.");
  } catch (error) {
    showToast(error.message || "That link is invalid or has expired. Request a new one.");
  } finally {
    el.verifyCodeButton.disabled = false;
  }
}

function verificationFromLink(value) {
  let candidate = value;
  const allowedTypes = new Set(["magiclink", "email", "signup", "invite", "recovery", "email_change"]);
  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const url = new URL(candidate);
      const tokenHash = url.searchParams.get("token_hash") || url.searchParams.get("token");
      const type = url.searchParams.get("type");
      if (tokenHash && allowedTypes.has(type)) return { tokenHash, type };
      const nested = ["url", "q", "u", "target", "redirect"].map(key => url.searchParams.get(key)).find(Boolean);
      if (!nested) return null;
      candidate = decodeURIComponent(nested);
    } catch { return null; }
  }
  return null;
}

async function signOut() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) showToast("Could not sign out. Please try again.");
  else showToast("Signed out. This browser copy remains available.");
}

function updateAccountUI() {
  const signedIn = Boolean(state.session);
  el.signInButton.hidden = signedIn;
  el.signOutButton.hidden = !signedIn;
  el.historyButton.hidden = !state.remote;
  el.membersButton.hidden = !(state.remote && state.memberRole === "owner");
  el.signOutButton.title = signedIn ? state.session.user.email || "Signed in" : "";
}

function setSyncStatus(label, kind = "") {
  el.syncStatus.lastChild.textContent = ` ${label}`;
  el.syncStatus.classList.toggle("is-synced", kind === "synced");
  el.syncStatus.classList.toggle("is-error", kind === "error");
}

function setModal(modal, open, focusTarget = null) {
  if (open) state.lastFocus = document.activeElement;
  modal.hidden = !open;
  const anyOpen = [el.restaurantModal, el.authModal, el.membersModal, el.historyModal].some(item => !item.hidden);
  document.body.classList.toggle("modal-open", anyOpen);
  if (open) requestAnimationFrame(() => (focusTarget || modal.querySelector("button, input, select, textarea"))?.focus());
  else state.lastFocus?.focus?.();
}

async function refreshRemoteRestaurants(migrateLocalIfEmpty = false) {
  if (!state.remote || state.cloudBusy) return;
  state.cloudBusy = true;
  setSyncStatus("Syncing…", "");
  try {
    const { data, error } = await supabaseClient.from("restaurants").select("*").order("created", { ascending: true });
    if (error) throw error;
    let rows = data || [];
    if (!rows.length && migrateLocalIfEmpty && state.restaurants.length) {
      const { data: migrated, error: migrationError } = await supabaseClient
        .from("restaurants").insert(state.restaurants.map(toRemote)).select();
      if (migrationError) throw migrationError;
      rows = migrated || [];
      showToast(`Shared atlas started with ${rows.length} restaurants from this browser.`);
    }
    state.restaurants = rows.map(fromRemote);
    safeStorageSet(state.restaurants);
    render();
    setSyncStatus("Synced", "synced");
  } catch (error) {
    console.warn("Restaurant Atlas refresh failed:", error.message);
    setSyncStatus("Sync paused", "error");
    showToast("Could not refresh the shared atlas. Showing the saved browser copy.");
  } finally {
    state.cloudBusy = false;
  }
}

function subscribeToRemoteChanges() {
  disconnectRealtime();
  state.remoteChannel = supabaseClient
    .channel("restaurant-atlas-sync")
    .on("postgres_changes", { event: "*", schema: "public", table: "restaurants" }, () => {
      clearTimeout(subscribeToRemoteChanges.refreshTimer);
      subscribeToRemoteChanges.refreshTimer = setTimeout(() => refreshRemoteRestaurants(false), 150);
    })
    .subscribe(status => {
      if (status === "SUBSCRIBED") setSyncStatus("Synced", "synced");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setSyncStatus("Sync reconnecting", "error");
    });
}

function disconnectRealtime() {
  clearTimeout(subscribeToRemoteChanges.refreshTimer);
  if (state.remoteChannel && supabaseClient) supabaseClient.removeChannel(state.remoteChannel);
  state.remoteChannel = null;
}

async function openHistory() {
  setModal(el.historyModal, true);
  el.historyList.innerHTML = "<p>Loading history…</p>";
  const { data, error } = await supabaseClient.from("restaurant_history").select("*").order("changed_at", { ascending: false }).limit(100);
  if (error) {
    el.historyList.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    return;
  }
  if (!data.length) {
    el.historyList.innerHTML = "<p>No shared changes yet.</p>";
    return;
  }
  el.historyList.innerHTML = data.map(entry => {
    const name = entry.snapshot?.name || "Restaurant";
    const when = new Date(entry.changed_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    return `<article class="history-item"><strong>${escapeHtml(name)}</strong><div class="history-meta"><span class="history-action">${escapeHtml(entry.action)}</span><span>${escapeHtml(entry.changed_by_email || "Atlas member")}</span><time datetime="${escapeHtml(entry.changed_at)}">${escapeHtml(when)}</time></div></article>`;
  }).join("");
}

async function openMembers() {
  if (state.memberRole !== "owner") return;
  setModal(el.membersModal, true, el.memberEmail);
  await loadMembers();
}

async function loadMembers() {
  el.memberList.innerHTML = "<p>Loading members…</p>";
  const { data, error } = await supabaseClient.from("atlas_members").select("*").order("created_at", { ascending: true });
  if (error) {
    el.memberList.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    return;
  }
  el.memberList.innerHTML = data.map(member => `<div class="member-row" data-member-id="${escapeHtml(member.id)}">
    <input type="email" aria-label="Member email" value="${escapeHtml(member.email)}">
    <select aria-label="Member role"><option value="member" ${member.role === "member" ? "selected" : ""}>Member</option><option value="owner" ${member.role === "owner" ? "selected" : ""}>Owner</option></select>
    <div class="member-actions"><button class="button button--quiet" type="button" data-member-action="save">Save</button><button class="button button--danger" type="button" data-member-action="remove">Remove</button></div>
  </div>`).join("");
}

async function addMember(event) {
  event.preventDefault();
  const email = el.memberEmail.value.trim().toLowerCase();
  const { error } = await supabaseClient.from("atlas_members").insert({
    email, role: "member", invited_by: state.session.user.id
  });
  if (error) {
    showToast(error.code === "23505" ? "That email is already approved." : error.message);
    return;
  }
  el.memberForm.reset();
  await loadMembers();
  showToast("Member email approved.");
}

async function handleMemberAction(event) {
  const button = event.target.closest("button[data-member-action]");
  if (!button) return;
  const row = button.closest("[data-member-id]");
  const id = row.dataset.memberId;
  button.disabled = true;
  let error;
  if (button.dataset.memberAction === "remove") {
    ({ error } = await supabaseClient.from("atlas_members").delete().eq("id", id));
  } else {
    const email = row.querySelector("input").value.trim().toLowerCase();
    const role = row.querySelector("select").value;
    ({ error } = await supabaseClient.from("atlas_members").update({ email, role, user_id: null }).eq("id", id));
  }
  if (error) showToast(error.message.includes("always have an owner") ? "Add another owner before changing the last owner." : error.message);
  else {
    await loadMembers();
    showToast(button.dataset.memberAction === "remove" ? "Member removed." : "Member updated.");
  }
  button.disabled = false;
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
  let rank = 0;
  el.restaurantGrid.innerHTML = items.map(item => {
    const sortedScore = state.sort === "overall" ? effectiveScore(item) : SCORE_SORTS.has(state.sort) ? item[state.sort] : null;
    return cardTemplate(item, sortedScore !== null ? ++rank : null);
  }).join("");
}

function cardTemplate(item, rank) {
  const score = effectiveScore(item);
  const ratingBars = [
    ["Food",item.food,""],["Ambiance",item.ambiance,""],["Value",item.price,"score-bar--value"]
  ].map(([label,value,extra]) => `<div class="score-bar ${extra}"><span>${label}</span><div class="track"><div class="fill" style="--score:${value === null ? 0 : value * 10}%"></div></div><b>${value === null ? "—" : rounded(value)}</b></div>`).join("");
  const verdictLabels = { yes: "Would return", maybe: "Maybe return", no: "Wouldn't return", "": "Return undecided" };
  return `<article class="restaurant-card ${score === null ? "is-unrated" : ""}" data-id="${escapeHtml(item.id)}" tabindex="0" aria-label="Edit ${escapeHtml(item.name)}">
    <svg class="card-watermark" aria-hidden="true"><use href="#icon-leaf"/></svg>
    <div class="card-head"><div class="card-head__copy">${SCORE_SORTS.has(state.sort) && rank !== null ? `<span class="rank">No. ${rank}</span>` : ""}<h3>${escapeHtml(item.name)}</h3></div>
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

async function saveForm(event) {
  event.preventDefault();
  const existing = state.restaurants.find(item => item.id === el.recordId.value);
  const candidate = normalizeRestaurant({
    id: existing?.id || `restaurant-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    name: el.name.value, cuisine: existing?.cuisine || "Uncategorised", visited: existing?.visited || "",
    food: scoreFromInput(el.food), ambiance: scoreFromInput(el.ambiance), price: scoreFromInput(el.price), overall: el.overall.value,
    returnVerdict: el.returnVerdict.value, dish: el.dish.value, notes: el.notes.value, created: existing?.created || new Date().toISOString(),
    version: existing?.version || 0
  });
  const submitButton = el.restaurantForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  try {
    if (state.remote) {
      let response;
      if (existing) {
        response = await supabaseClient.from("restaurants").update(toRemote(candidate))
          .eq("id", existing.id).eq("version", existing.version).select().maybeSingle();
      } else {
        response = await supabaseClient.from("restaurants").insert(toRemote(candidate)).select().single();
      }
      if (response.error) throw response.error;
      if (!response.data) {
        await refreshRemoteRestaurants(false);
        showToast("Someone changed this entry first. Their latest version is now shown.");
        closeModal();
        return;
      }
      const saved = fromRemote(response.data);
      if (existing) state.restaurants[state.restaurants.indexOf(existing)] = saved;
      else state.restaurants.push(saved);
    } else if (existing) state.restaurants[state.restaurants.indexOf(existing)] = candidate;
    else state.restaurants.push(candidate);
    persistAndRender();
    closeModal();
    setSyncStatus(state.remote ? "Synced" : "Local only", state.remote ? "synced" : "");
    showToast(existing ? "Restaurant updated." : "Restaurant added to the atlas.");
  } catch (error) {
    console.warn("Restaurant Atlas save failed:", error.message);
    setSyncStatus(state.remote ? "Sync paused" : "Local only", state.remote ? "error" : "");
    showToast(state.remote ? "This change was not saved. Check your connection and try again." : "This change could not be saved.");
  } finally {
    submitButton.disabled = false;
  }
}

async function handleDelete() {
  if (!el.deleteRestaurant.classList.contains("is-armed")) {
    el.deleteRestaurant.classList.add("is-armed"); el.deleteRestaurant.textContent = "Tap again to confirm";
    state.deleteTimer = setTimeout(resetDeleteButton, 3500); return;
  }
  const id = el.recordId.value;
  const existing = state.restaurants.find(item => item.id === id);
  el.deleteRestaurant.disabled = true;
  try {
    if (state.remote) {
      const { data, error } = await supabaseClient.from("restaurants").delete()
        .eq("id", id).eq("version", existing.version).select().maybeSingle();
      if (error) throw error;
      if (!data) {
        await refreshRemoteRestaurants(false);
        showToast("Someone changed this entry first. Their latest version is now shown.");
        closeModal();
        return;
      }
    }
    state.restaurants = state.restaurants.filter(item => item.id !== id);
    persistAndRender(); closeModal(); showToast("Restaurant deleted.");
  } catch (error) {
    console.warn("Restaurant Atlas delete failed:", error.message);
    showToast("This entry could not be deleted. Please try again.");
  } finally {
    el.deleteRestaurant.disabled = false;
  }
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
    if (state.remote) {
      const { data, error } = await supabaseClient.from("restaurants").upsert(state.restaurants.map(toRemote), { onConflict: "id" }).select();
      if (error) throw error;
      state.restaurants = data.map(fromRemote);
    }
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

window.RestaurantAtlas = Object.freeze({ WEIGHTS, weightedScore, effectiveScore, normalizeRestaurant, verificationFromLink });
