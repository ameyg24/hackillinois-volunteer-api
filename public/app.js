const $ = (selector) => document.querySelector(selector);
const state = {
  shifts: [],
  volunteers: [],
  selected: "",
  filter: "all",
  hasMore: false,
  pending: new Set(),
  refreshId: 0,
};
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
$("#timezone").textContent = `Times in ${zone.replaceAll("_", " ")}`;
$("#form-timezone").textContent =
  `Enter times in ${zone.replaceAll("_", " ")}.`;
try {
  state.selected = localStorage.getItem("volunteerId") ?? "";
} catch {
  /* Selection still works without storage. */
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error(
      "Could not reach the server. Refresh to check the latest state before retrying.",
    );
  }
  if (response.status === 204) return null;
  const result = await response.json();
  if (!response.ok) {
    const details = result.error?.details
      ?.map((issue) => `${issue.field || "Request"}: ${issue.message}`)
      .join(". ");
    throw new Error(
      details || result.error?.message || "The request could not be completed.",
    );
  }
  return result;
}

function notify(message, error = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = error ? "error-banner" : "notice";
  notice.setAttribute("role", error ? "alert" : "status");
  notice.hidden = false;
}

function saveSelection() {
  try {
    localStorage.setItem("volunteerId", state.selected);
  } catch {
    /* Storage is optional. */
  }
  const volunteer = state.volunteers.find(
    (person) => person._id === state.selected,
  );
  $("#avatar").textContent = volunteer?.name.slice(0, 1).toUpperCase() || "?";
}

async function volunteers() {
  const people = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    const result = await api(`/volunteers?limit=100&offset=${offset}`);
    people.push(...result.volunteers);
    if (!result.hasMore) return people;
  }
  throw new Error("The volunteer directory is too large to load in this demo.");
}

function renderVolunteers() {
  const select = $("#volunteer-select");
  select.replaceChildren(new Option("Choose a volunteer", ""));
  for (const person of state.volunteers)
    select.add(new Option(`${person.name} · ${person.email}`, person._id));
  if (!state.volunteers.some((person) => person._id === state.selected))
    state.selected = "";
  select.value = state.selected;
  select.disabled = false;
  saveSelection();
}

async function refresh() {
  const refreshId = ++state.refreshId;
  $("#shift-grid").setAttribute("aria-busy", "true");
  $("#refresh-button").disabled = true;
  $("#load-more").disabled = true;
  try {
    const [people, health] = await Promise.all([volunteers(), api("/health")]);
    // Re-fetch all currently loaded pages, so a refresh does not discard a later page.
    const pages = Math.max(1, Math.ceil(state.shifts.length / 100));
    const shifts = [];
    let hasMore = false;
    for (let page = 0; page < pages; page++) {
      const result = await api(`/shifts?limit=100&offset=${page * 100}`);
      shifts.push(...result.shifts);
      hasMore = result.hasMore;
      if (!hasMore) break;
    }
    if (refreshId !== state.refreshId) return;
    state.volunteers = people;
    state.shifts = shifts;
    state.hasMore = hasMore;
    renderVolunteers();
    renderShifts();
    $("#load-error").hidden = true;
    $("#connection").textContent =
      health.status === "ok" ? "Connected to the API" : "Unavailable";
    $("#connection").classList.toggle("online", health.status === "ok");
    return true;
  } catch (error) {
    if (refreshId !== state.refreshId) return;
    $("#load-error").textContent = error.message;
    $("#load-error").hidden = false;
    $("#connection").textContent = "Connection unavailable";
    $("#connection").classList.remove("online");
    $("#results-label").textContent = state.shifts.length
      ? "Showing the last loaded schedule"
      : "Schedule unavailable";
    return false;
  } finally {
    if (refreshId === state.refreshId) {
      $("#shift-grid").setAttribute("aria-busy", "false");
      $("#refresh-button").disabled = false;
      $("#load-more").disabled = false;
    }
  }
}

function detail(symbol, text) {
  const row = element("p", "shift-detail");
  const icon = element("span", "detail-icon", symbol);
  icon.setAttribute("aria-hidden", "true");
  row.append(icon, element("span", "", text));
  return row;
}

function card(shift) {
  const joined = shift.signups.some(
    (signup) => signup.volunteerId === state.selected,
  );
  const full = shift.signups.length >= shift.capacity;
  const started = new Date(shift.startsAt) <= new Date();
  const remaining = shift.capacity - shift.signups.length;
  const article = element("article", `shift-card${full ? " full-card" : ""}`);
  const top = element("div", "card-top");
  top.append(
    element(
      "span",
      "shift-date",
      new Date(shift.startsAt).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    ),
  );
  top.append(
    element(
      "span",
      `badge ${joined ? "joined" : started ? "started" : full ? "full" : ""}`,
      joined
        ? "You’re on the crew"
        : started
          ? "Signups closed"
          : full
            ? "Fully staffed"
            : `${remaining} ${remaining === 1 ? "spot" : "spots"} open`,
    ),
  );
  const content = element("div", "card-content");
  content.append(element("h3", "", shift.title));
  const starts = new Date(shift.startsAt);
  const ends = new Date(shift.endsAt);
  const time = { hour: "numeric", minute: "2-digit" };
  const endLabel =
    ends.toDateString() === starts.toDateString()
      ? ends.toLocaleTimeString(undefined, time)
      : ends.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          ...time,
        });
  content.append(
    detail("◷", `${starts.toLocaleTimeString(undefined, time)} – ${endLabel}`),
    detail("⌖", shift.location),
  );
  if (shift.description)
    content.append(element("p", "description", shift.description));
  const bottom = element("div", "card-bottom");
  const capacity = element("div", "capacity-row");
  capacity.append(
    element("span", "", "Volunteer crew"),
    element("strong", "", `${shift.signups.length} / ${shift.capacity}`),
  );
  const track = element("div", "capacity-track");
  track.setAttribute("role", "meter");
  track.setAttribute("aria-label", "Volunteer spots filled");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(shift.capacity));
  track.setAttribute("aria-valuenow", String(shift.signups.length));
  const fill = element("div", "capacity-fill");
  fill.style.width = `${Math.min(100, (shift.signups.length / shift.capacity) * 100)}%`;
  track.append(fill);
  const actions = element("div", "card-actions");
  const action = element(
    "button",
    `button ${joined ? "button-outline" : "button-primary"}`,
    state.pending.has(shift._id)
      ? "Saving…"
      : joined
        ? "Cancel signup"
        : started
          ? "Signups closed"
          : full
            ? "Shift full"
            : state.selected
              ? "Join this shift"
              : "Choose a volunteer",
  );
  action.disabled =
    state.pending.has(shift._id) ||
    (!joined && (full || started || !state.selected));
  action.addEventListener("click", () => changeSignup(shift, joined));
  const edit = element("button", "card-edit", "Edit");
  edit.setAttribute("aria-label", `Edit ${shift.title}`);
  edit.addEventListener("click", () => openShift(shift));
  actions.append(action, edit);
  bottom.append(capacity, track, actions);
  if (shift.signups.length) {
    const roster = element("details", "roster");
    roster.append(element("summary", "", "View the crew"));
    const names = element("ul");
    for (const signup of shift.signups) {
      const person = state.volunteers.find(
        (person) => person._id === signup.volunteerId,
      );
      names.append(element("li", "", person?.name || "Registered volunteer"));
    }
    roster.append(names);
    bottom.append(roster);
  }
  article.append(top, content, bottom);
  return article;
}

function renderShifts() {
  const mine = state.shifts.filter((shift) =>
    shift.signups.some((signup) => signup.volunteerId === state.selected),
  );
  const term = $("#search").value.trim().toLowerCase();
  const visible = (state.filter === "mine" ? mine : state.shifts).filter(
    (shift) =>
      `${shift.title} ${shift.location} ${shift.description}`
        .toLowerCase()
        .includes(term),
  );
  $("#all-count").textContent =
    state.shifts.length + (state.hasMore ? "+" : "");
  $("#mine-count").textContent = mine.length + (state.hasMore ? "+" : "");
  $("#results-label").textContent =
    `${visible.length} ${visible.length === 1 ? "shift" : "shifts"} ${state.hasMore ? "shown from loaded schedule" : "on the board"}`;
  $("#shift-grid").replaceChildren(...visible.map(card));
  $("#empty-state").hidden = visible.length > 0;
  $("#empty-title").textContent = term
    ? "No matching shifts"
    : state.filter === "mine"
      ? state.selected
        ? "Your crew is waiting"
        : "Choose a volunteer first"
      : "The board is ready for you";
  $("#empty-copy").textContent = term
    ? "Try another title or location."
    : state.filter === "mine"
      ? state.selected
        ? "Join a shift from the All shifts tab to see it here."
        : "Select a name above to see their assignments."
      : "Create the first shift to get everyone started.";
  $("#load-more").hidden = !state.hasMore;
}

async function changeSignup(shift, cancel) {
  const volunteerId = state.selected;
  if (!volunteerId || state.pending.has(shift._id)) return;
  state.pending.add(shift._id);
  renderShifts();
  try {
    await api(
      `/shifts/${shift._id}/signups${cancel ? `/${volunteerId}` : ""}`,
      {
        method: cancel ? "DELETE" : "POST",
        ...(cancel ? {} : { body: JSON.stringify({ volunteerId }) }),
      },
    );
    notify(
      cancel
        ? `Signup canceled for ${shift.title}.`
        : `You’re on the crew for ${shift.title}.`,
    );
  } catch (error) {
    notify(error.message, true);
  } finally {
    await refresh();
    state.pending.delete(shift._id);
    renderShifts();
  }
}

function showDialog(dialog) {
  dialog.querySelector(".form-error").hidden = true;
  dialog.showModal();
}

function localDate(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function openShift(shift) {
  const form = $("#shift-form");
  form.reset();
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const values = shift ?? {
    startsAt: start,
    endsAt: new Date(start.getTime() + 7200000),
    capacity: 4,
  };
  for (const key of ["title", "location", "description", "capacity"])
    form.elements[key].value = values[key] ?? "";
  form.elements.id.value = shift?._id ?? "";
  form.elements.startsAt.value = localDate(values.startsAt);
  form.elements.endsAt.value = localDate(values.endsAt);
  form.elements.endsAt.setCustomValidity("");
  $("#shift-title").textContent = shift ? "Edit shift" : "Create a shift";
  $("#save-shift").textContent = shift ? "Save changes" : "Create shift";
  $("#delete-shift").hidden = !shift;
  $("#delete-shift").disabled = !!shift?.signups.length;
  $("#delete-shift").title = shift?.signups.length
    ? "Cancel all signups before deleting this shift."
    : "";
  showDialog($("#shift-dialog"));
}

function formError(form, error) {
  const target = form.querySelector(".form-error");
  target.textContent = error.message;
  target.hidden = false;
}

async function saveForm(form, action) {
  const buttons = [...form.querySelectorAll("button")];
  const disabled = buttons.map((button) => button.disabled);
  form.dataset.saving = "true";
  buttons.forEach((button) => {
    button.disabled = true;
  });
  form.querySelector(".form-error").hidden = true;
  try {
    await action();
  } catch (error) {
    formError(form, error);
  } finally {
    delete form.dataset.saving;
    buttons.forEach((button, index) => {
      button.disabled = disabled[index];
    });
  }
}

$("#volunteer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  body.name = body.name.trim();
  body.email = body.email.trim();
  void saveForm(form, async () => {
    const { volunteer } = await api("/volunteers", {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.selected = volunteer._id;
    $("#volunteer-dialog").close();
    form.reset();
    notify(`${volunteer.name} is registered. Pick a shift to get started.`);
    await refresh();
  });
});

$("#shift-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const start = new Date(values.startsAt);
  const end = new Date(values.endsAt);
  if (!(end > start)) {
    form.elements.endsAt.setCustomValidity("The end must be after the start.");
    form.elements.endsAt.reportValidity();
    return;
  }
  void saveForm(form, async () => {
    const { id, ...body } = values;
    body.capacity = Number(body.capacity);
    body.startsAt = start.toISOString();
    body.endsAt = end.toISOString();
    await api(id ? `/shifts/${id}` : "/shifts", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    $("#shift-dialog").close();
    notify(id ? "Shift updated." : "Shift created. The crew can sign up now.");
    await refresh();
  });
});
for (const field of ["startsAt", "endsAt"])
  $("#shift-form").elements[field].addEventListener("input", () =>
    $("#shift-form").elements.endsAt.setCustomValidity(""),
  );

$("#delete-shift").addEventListener("click", () => {
  if (!confirm("Delete this shift? This cannot be undone.")) return;
  const form = $("#shift-form");
  void saveForm(form, async () => {
    await api(`/shifts/${form.elements.id.value}`, { method: "DELETE" });
    $("#shift-dialog").close();
    notify("Shift deleted.");
    await refresh();
  });
});
document
  .querySelectorAll("[data-close]")
  .forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );
document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("cancel", (event) => {
    if (dialog.querySelector("form").dataset.saving) event.preventDefault();
  }),
);
$("#register-button").addEventListener("click", () =>
  showDialog($("#volunteer-dialog")),
);
$("#create-button").addEventListener("click", () => openShift());
$("#volunteer-select").addEventListener("change", (event) => {
  state.selected = event.target.value;
  saveSelection();
  renderShifts();
});
$("#search").addEventListener("input", renderShifts);
$("#refresh-button").addEventListener("click", refresh);
for (const [id, filter] of [
  ["all-filter", "all"],
  ["mine-filter", "mine"],
]) {
  $(`#${id}`).addEventListener("click", () => {
    state.filter = filter;
    for (const name of ["all", "mine"]) {
      $(`#${name}-filter`).classList.toggle("active", name === filter);
      $(`#${name}-filter`).setAttribute(
        "aria-pressed",
        String(name === filter),
      );
    }
    renderShifts();
  });
}
$("#load-more").addEventListener("click", async () => {
  const button = $("#load-more");
  button.disabled = true;
  const refreshId = state.refreshId;
  try {
    const result = await api(`/shifts?limit=100&offset=${state.shifts.length}`);
    if (refreshId !== state.refreshId) return;
    const known = new Set(state.shifts.map((shift) => shift._id));
    state.shifts.push(
      ...result.shifts.filter((shift) => !known.has(shift._id)),
    );
    state.hasMore = result.hasMore;
    renderShifts();
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});
// Time-sensitive buttons are refreshed even when the user leaves the page open.
setInterval(() => {
  if (state.shifts.length) renderShifts();
}, 60000);
void refresh();
