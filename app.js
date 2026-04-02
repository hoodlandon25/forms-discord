const STORAGE_KEY = "discord_forms_local_data_v1";
const QUESTION_TYPES = {
  short: "Short Answer",
  fillblank: "Fill In The Blank",
  branchfill: "Branch Fill",
  text: "Text Block",
  note: "Note PDF",
  graph: "Graph Block",
  image: "Image",
  gif: "GIF",
  drawing: "Drawing",
  code: "Code",
  animation: "Animation",
  long: "Paragraph",
  multiple: "Multiple Choice",
  checkbox: "Checkboxes",
  dropdown: "Dropdown",
  emoji: "Emoji Reaction",
  yesno: "Yes / No",
  rating: "Rating Scale",
  scale: "Linear Scale",
  date: "Date",
  time: "Time",
  email: "Email",
  number: "Number"
};

const OPTION_BASED_TYPES = new Set(["multiple", "checkbox", "dropdown", "emoji"]);
const ANIMATION_FRAME_COUNT = 8;
const BRANCH_FILL_COUNT = 6;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const defaultData = {
  forms: [
    {
      id: makeId(),
      title: "Event Signup",
      description: "Collect names, availability, and favorite activities for the next server event.",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      questions: [
        {
          id: makeId(),
          type: "short",
          label: "What is your display name?",
          required: true,
          options: []
        },
        {
          id: makeId(),
          type: "multiple",
          label: "Which day works best?",
          required: true,
          options: ["Friday", "Saturday", "Sunday"]
        },
        {
          id: makeId(),
          type: "long",
          label: "Anything we should plan for?",
          required: false,
          options: []
        }
      ],
      responses: []
    }
  ]
};

const AUTH_TOKEN_KEY = "discord_forms_admin_token";
const PENDING_SUBMISSION_KEY = "discord_forms_pending_submission";
const HOME_THEME_KEY = "discord_forms_home_theme";
const FORM_STYLES = {
  default: "Default",
  windows_xp_pdf: "Windows XP PDF",
  windows_98_pdf: "Windows 98 PDF",
  wizard_exe_setup: "Wizard EXE Setup",
  windows_wizard_setup: "Windows Wizard Setup",
  wii_u_menu: "Wii U Menu"
};
const state = {
  data: loadData(),
  security: null,
  currentFormId: null,
  toast: null,
  authReady: false,
  isAdmin: false,
  username: "",
  discordAuthConfigured: false,
  discordUser: null,
  pendingSubmission: null,
  activityInsights: {},
  deployStatus: null,
  deploying: false,
  homeTheme: loadHomeTheme(),
  wizardInstaller: {
    step: 0,
    selectedFormId: "",
    selectedControlView: "visitors",
    finishAction: "open_selected_form"
  },
  consoleSelection: {
    zone: "launcher",
    id: ""
  }
};
const SUBMISSION_SOURCES = [
  { value: "discord", label: "Discord" },
  { value: "tiktok", label: "TikTok" },
  { value: "custom", label: "Custom" }
];
const pageContent = document.getElementById("page-content");
const formsList = document.getElementById("forms-list");
const pageTitle = document.getElementById("page-title");
const routeBadge = document.getElementById("route-badge");
const topbarActions = document.getElementById("topbar-actions");
const newFormButton = document.getElementById("new-form-button");
const pdfImportInput = document.getElementById("pdf-import-input");
const brandIcon = document.getElementById("brand-icon");

function loadData() {
  return structuredClone(defaultData);
}

function loadPendingSubmission() {
  try {
    const raw = sessionStorage.getItem(PENDING_SUBMISSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function loadHomeTheme() {
  const saved = localStorage.getItem(HOME_THEME_KEY) || "default";
  return FORM_STYLES[saved] ? saved : "default";
}

function setHomeTheme(style) {
  state.homeTheme = FORM_STYLES[style] ? style : "default";
  localStorage.setItem(HOME_THEME_KEY, state.homeTheme);
  render();
}

function persist() {
  if (state.isAdmin) {
    saveSiteData().catch(() => setToast("Could not save website changes.", "danger"));
  }
}

function persistPendingSubmission() {
  if (!state.pendingSubmission) {
    sessionStorage.removeItem(PENDING_SUBMISSION_KEY);
    return;
  }
  sessionStorage.setItem(PENDING_SUBMISSION_KEY, JSON.stringify(state.pendingSubmission));
}

function formById(id) {
  return state.data.forms.find((form) => form.id === id) || null;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function encodeDomKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function banReasonInputId(scope, value) {
  return `ban-reason-${scope}-${encodeDomKey(value)}`;
}

function visitorDisplayName(visitor) {
  if (!visitor || typeof visitor !== "object") return "Unknown";
  if (visitor.is_admin) return visitor.last_username || "admin";
  return visitor.device_ip || visitor.network_ip || visitor.last_username || "Unknown";
}

function activityDisplayName(entry) {
  if (!entry || typeof entry !== "object") return "Unknown";
  if (entry.is_admin) return entry.username || "admin";
  return entry.device_ip || entry.network_ip || entry.username || "Unknown";
}

function activityEntryKey(entry) {
  return [entry.timestamp || 0, entry.action || "", entry.path || "", entry.username || "", entry.device_ip || ""].join("::");
}

function summarizeDetail(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
  const parts = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") {
      parts.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    parts.push(`${key}: ${value}`);
  }
  return parts.join(" | ");
}

function translateActivityEntry(entry) {
  const detail = entry.detail || {};
  const user = activityDisplayName(entry);

  switch (entry.action) {
    case "page_load":
      return `${user} opened the website and landed on ${detail.hash || entry.path || "/"}.`;
    case "route_change":
      return `${user} moved to ${detail.hash || entry.path || "/"}.`;
    case "button_click":
      return `${user} clicked "${detail.text || "a button"}" while on ${detail.route || entry.path || "/"}.`;
    case "submit_response":
      return `${user} submitted a response${detail.form_id ? ` for form ${detail.form_id}` : ""}.`;
    case "save_site_data":
      return `${user} saved website changes${detail.forms ? ` affecting ${detail.forms} form(s)` : ""}.`;
    case "ban_ip":
      return `${user} banned the ${detail.scope || "ip"} address ${detail.value || ""}${detail.reason ? ` with reason: ${detail.reason}` : ""}.`;
    case "unban_ip":
      return `${user} removed the ${detail.scope || "ip"} ban for ${detail.value || ""}.`;
    case "deploy_site":
      return `${user} ran the live website update command${typeof detail.exit_code === "number" ? ` and it exited with code ${detail.exit_code}` : ""}.`;
    case "blocked_request":
      return `${user} tried to access the website after being banned.`;
    default: {
      const detailSummary = summarizeDetail(detail);
      return detailSummary
        ? `${user} triggered ${entry.action || "an event"} with details: ${detailSummary}.`
        : `${user} triggered ${entry.action || "an event"} on ${entry.path || "/"}.`;
    }
  }
}

function inferActivityIntent(entry) {
  const detail = entry.detail || {};

  switch (entry.action) {
    case "page_load":
    case "route_change":
      return "They were navigating the website and viewing another page or section.";
    case "button_click":
      if ((detail.text || "").match(/deploy|update live|sync/i)) {
        return "They were likely trying to push local website changes to the live website.";
      }
      if ((detail.text || "").match(/ban|unban/i)) {
        return "They were likely moderating access for a visitor.";
      }
      if ((detail.text || "").match(/create|new form/i)) {
        return "They were likely creating or editing a form.";
      }
      return "They were likely trying to use a website feature from the current page.";
    case "submit_response":
      return "They were likely trying to send in an application, answer a form, or contact you through the site.";
    case "save_site_data":
      return "They were likely publishing builder edits to the local site data.";
    case "ban_ip":
      return "They were blocking that visitor from coming back through the selected IP scope.";
    case "unban_ip":
      return "They were restoring access for that visitor.";
    case "deploy_site":
      return detail.exit_code === 0
        ? "They updated the live website with the local files."
        : "They tried to update the live website, but the deploy command failed.";
    case "blocked_request":
      return "They were likely trying to revisit the website after already being blocked.";
    default:
      return "They were interacting with the website, but the event is too generic to infer more than normal usage.";
  }
}

function authToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function authHeaders() {
  const token = authToken();
  return token ? { "X-Auth-Token": token } : {};
}

async function refreshAuthStatus() {
  try {
    const [adminResponse, discordResponse] = await Promise.all([
      fetch("/api/auth-status", {
        headers: authHeaders()
      }),
      fetch("/api/discord-auth-status", {
        credentials: "same-origin"
      })
    ]);
    const adminPayload = await adminResponse.json();
    const discordPayload = await discordResponse.json();
    state.isAdmin = Boolean(adminPayload.authenticated);
    state.username = adminPayload.username || "";
    state.discordAuthConfigured = Boolean(discordPayload.configured);
    state.discordUser = discordPayload.authenticated ? {
      id: discordPayload.id || "",
      username: discordPayload.username || "",
      displayName: discordPayload.display_name || discordPayload.username || "",
      avatarUrl: discordPayload.avatar_url || ""
    } : null;
  } catch (_error) {
    state.isAdmin = false;
    state.username = "";
    state.discordAuthConfigured = false;
    state.discordUser = null;
  } finally {
    state.authReady = true;
  }
}

async function refreshSiteData() {
  try {
    const response = await fetch("/api/site-data", {
      headers: authHeaders()
    });
    const payload = await response.json();
    if (response.ok && payload.ok && payload.data) {
      state.data = payload.data;
      normalizeData();
    }
  } catch (_error) {
    // keep current in-memory state if the server call fails
  }
}

async function saveSiteData() {
  const response = await fetch("/api/site-data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ data: state.data })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Could not save website changes.");
  }
}

async function refreshSecurityData() {
  if (!state.isAdmin) {
    state.security = null;
    return;
  }
  const response = await fetch("/api/admin/security", {
    headers: authHeaders()
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Could not load control panel.");
  }
  state.security = payload.security || null;
}

async function refreshDeployStatus() {
  if (!state.isAdmin) {
    state.deployStatus = null;
    return;
  }
  const response = await fetch("/api/admin/deploy-status", {
    headers: authHeaders()
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Could not load deploy status.");
  }
  state.deployStatus = payload.deploy_status || null;
}

async function deployWebsite() {
  if (state.deploying) return;
  state.deploying = true;
  render();
  try {
    const response = await fetch("/api/admin/deploy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({})
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.stderr || payload.error || "Could not update the live website.");
    }
    await refreshSecurityData();
    await refreshDeployStatus();
    setToast("Live website updated.");
  } catch (error) {
    setToast(error.message || "Could not update the live website.", "danger");
  } finally {
    state.deploying = false;
    render();
  }
}

async function loginAdmin(username, password) {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "Login failed.");
  }

  localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
  await refreshAuthStatus();
  await refreshSiteData();
  await refreshSecurityData();
  await refreshDeployStatus();
}

async function logoutAdmin() {
  await fetch("/api/logout", {
    method: "POST",
    headers: authHeaders()
  });
  localStorage.removeItem(AUTH_TOKEN_KEY);
  await refreshAuthStatus();
  await refreshSiteData();
  state.security = null;
  state.deployStatus = null;
}

async function logoutDiscordUser() {
  await fetch("/api/discord-logout", {
    method: "POST",
    credentials: "same-origin"
  });
  await refreshAuthStatus();
  await refreshSiteData();
}

function deployStatusPill(label, active) {
  return `<span class="choice-pill">${escapeHtml(label)}: ${active ? "Ready" : "Missing"}</span>`;
}

function setToast(message, type = "success") {
  state.toast = { message, type };
  render();
}

function clearToast() {
  state.toast = null;
}

function route() {
  const hash = window.location.hash.replace(/^#/, "");
  const [name = "dashboard", value = ""] = hash.split("/");
  return { name, value };
}

function controlView() {
  return route().value || "visitors";
}

function setRoute(name, value = "") {
  const next = value ? `#${name}/${value}` : `#${name}`;
  if (window.location.hash === next) {
    render();
    return;
  }
  window.location.hash = next;
}

function createForm() {
  const form = {
    id: makeId(),
    title: "Untitled Form",
    description: "Describe what this form is for.",
    style: "default",
    maxResponses: 0,
    maxAcceptedResponses: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    questions: [
      {
        id: makeId(),
        type: "short",
        label: "New question",
        required: true,
        options: []
      }
    ],
    responses: []
  };

  state.data.forms.unshift(form);
  persist();
  setToast("New form created.");
  setRoute("builder", form.id);
}

function deleteForm(id) {
  state.data.forms = state.data.forms.filter((form) => form.id !== id);
  persist();
  setToast("Form deleted.", "danger");
  setRoute("dashboard");
}

function updateForm(id, updater) {
  const form = formById(id);
  if (!form) return;
  updater(form);
  form.updatedAt = Date.now();
  persist();
  renderFormsList();
}

function copyShareLink(id) {
  const url = `${window.location.origin}${window.location.pathname}#form/${id}`;
  navigator.clipboard.writeText(url)
    .then(() => setToast("Share link copied."))
    .catch(() => setToast("Could not copy link. You can still copy it manually.", "danger"));
}

function addQuestion(formId) {
  updateForm(formId, (form) => {
    form.questions.push({
      id: makeId(),
      type: "short",
      label: "New question",
      required: false,
      options: []
    });
  });
  setToast("Question added.");
  render();
}

function defaultOptionsForType(type) {
  if (type === "multiple" || type === "checkbox" || type === "dropdown") {
    return ["Choice 1", "Choice 2"];
  }
  if (type === "emoji") {
    return ["🔥", "👍", "🎉", "💯"];
  }
  if (type === "yesno") {
    return ["Yes", "No"];
  }
  if (type === "rating") {
    return ["1", "2", "3", "4", "5"];
  }
  if (type === "scale") {
    return ["1", "2", "3", "4", "5"];
  }
  return [];
}

function defaultBranchFillBranches() {
  return Array.from({ length: BRANCH_FILL_COUNT }, (_item, index) => ({
    match: `Option ${index + 1}`,
    prompts: []
  }));
}

function normalizeQuestion(question) {
  if (!question.type) question.type = "short";
  if (!("required" in question)) question.required = false;
  if (!Array.isArray(question.options)) question.options = [];
  if (!question.id) question.id = makeId();
  if (!("placeholder" in question)) question.placeholder = "";
  if (!("content" in question)) question.content = "";
  if (!("referenceCode" in question)) question.referenceCode = "";
  if (!Array.isArray(question.branches)) {
    question.branches = defaultBranchFillBranches();
  }
  while (question.branches.length < BRANCH_FILL_COUNT) {
    question.branches.push({
      match: `Option ${question.branches.length + 1}`,
      prompts: []
    });
  }
  question.branches = question.branches.slice(0, BRANCH_FILL_COUNT).map((branch, index) => ({
    match: typeof branch?.match === "string" ? branch.match : `Option ${index + 1}`,
    prompts: Array.isArray(branch?.prompts)
      ? branch.prompts.map((prompt) => String(prompt || "").trim()).filter(Boolean)
      : []
  }));
  if (!Array.isArray(question.graphPoints)) {
    question.graphPoints = [
      { label: "A", value: 4 },
      { label: "B", value: 7 },
      { label: "C", value: 5 }
    ];
  }

  if (!("scaleLeft" in question)) question.scaleLeft = "Low";
  if (!("scaleRight" in question)) question.scaleRight = "High";

  if ((question.type === "yesno" || question.type === "rating" || question.type === "emoji" || question.type === "scale") && question.options.length === 0) {
    question.options = defaultOptionsForType(question.type);
  }
}

function normalizeData() {
  for (const form of state.data.forms) {
    if (!form.style) form.style = "default";
    if (!("maxResponses" in form)) form.maxResponses = 0;
    if (!("maxAcceptedResponses" in form)) form.maxAcceptedResponses = 0;
    for (const question of form.questions) {
      normalizeQuestion(question);
    }
    for (const response of form.responses) {
      if (!response.id) response.id = makeId();
      if (!response.meta) {
        response.meta = {
          source: "",
          customSource: "",
          platformLabel: "",
          username: "",
          status: "pending",
          decisionReason: ""
        };
      }
    }
  }
}

function approvedResponseCount(form) {
  return form.responses.filter((response) => response.meta?.status === "approved").length;
}

function responseLimitReached(form) {
  return Number(form.maxResponses) > 0 && form.responses.length >= Number(form.maxResponses);
}

function acceptedLimitReached(form) {
  return Number(form.maxAcceptedResponses) > 0 && approvedResponseCount(form) >= Number(form.maxAcceptedResponses);
}

function remainingResponses(form) {
  if (!(Number(form.maxResponses) > 0)) return "Unlimited";
  return String(Math.max(0, Number(form.maxResponses) - form.responses.length));
}

function remainingAcceptedResponses(form) {
  if (!(Number(form.maxAcceptedResponses) > 0)) return "Unlimited";
  return String(Math.max(0, Number(form.maxAcceptedResponses) - approvedResponseCount(form)));
}

function formClosedReason(form) {
  if (acceptedLimitReached(form)) {
    return `This form has reached its accepted limit of ${form.maxAcceptedResponses}.`;
  }
  if (responseLimitReached(form)) {
    return `This form has reached its submission limit of ${form.maxResponses}.`;
  }
  return "";
}

function removeQuestion(formId, questionId) {
  updateForm(formId, (form) => {
    form.questions = form.questions.filter((question) => question.id !== questionId);
  });
  render();
}

function createTextBlock(title, content) {
  return {
    id: makeId(),
    type: "text",
    label: title,
    required: false,
    options: [],
    placeholder: "",
    content
  };
}

function createNoteBlock(title, content, referenceCode = "") {
  return {
    id: makeId(),
    type: "note",
    label: title,
    required: false,
    options: [],
    placeholder: "",
    content,
    referenceCode
  };
}

function createImportedQuestion(type, label, extra = {}) {
  const question = {
    id: makeId(),
    type,
    label: label || "Imported question",
    required: false,
    options: defaultOptionsForType(type),
    placeholder: "",
    content: "",
    graphPoints: [
      { label: "A", value: 4 },
      { label: "B", value: 7 },
      { label: "C", value: 5 }
    ],
    scaleLeft: "Low",
    scaleRight: "High",
    ...extra
  };
  normalizeQuestion(question);
  return question;
}

function parsePipeParts(text) {
  return text.split("|").map((part) => part.trim()).filter(Boolean);
}

function parseGraphPoints(parts) {
  const points = [];
  for (const part of parts) {
    const [label, value] = part.split("=").map((item) => item.trim());
    if (!label) continue;
    points.push({ label, value: Number(value) || 0 });
  }
  return points.length ? points : [
    { label: "A", value: 4 },
    { label: "B", value: 7 },
    { label: "C", value: 5 }
  ];
}

function markerTypeMap(rawMarker) {
  const marker = rawMarker.toLowerCase().trim();
  const mapping = {
    "form title": "formTitle",
    "title": "formTitle",
    "form description": "formDescription",
    "description": "formDescription",
    "form style": "formStyle",
    "style": "formStyle",
    "form max submissions": "formMaxResponses",
    "max submissions": "formMaxResponses",
    "max total submissions": "formMaxResponses",
    "form max accepted": "formMaxAcceptedResponses",
    "max accepted": "formMaxAcceptedResponses",
    "max accepted submissions": "formMaxAcceptedResponses",
    "text": "text",
    "note": "note",
    "note pdf": "note",
    "image": "image",
    "gif": "gif",
    "drawing": "drawing",
    "draw": "drawing",
    "code": "code",
    "code block": "code",
    "animation": "animation",
    "short answer": "short",
    "fill in the blank": "fillblank",
    "branch fill": "branchfill",
    "branching fill": "branchfill",
    "paragraph": "long",
    "multiple choice": "multiple",
    "check off": "checkbox",
    "checkbox": "checkbox",
    "dropdown": "dropdown",
    "emoji reaction": "emoji",
    "yes no": "yesno",
    "rating scale": "rating",
    "linear scale": "scale",
    "date": "date",
    "time": "time",
    "email": "email",
    "number": "number",
    "graph": "graph"
  };
  return mapping[marker] || null;
}

function buildQuestionFromImportedBlock(marker, body) {
  const rawMarker = marker.toLowerCase().trim();
  const required = /\brequired\b/.test(rawMarker);
  const normalizedMarker = rawMarker.replace(/\brequired\b/g, "").replace(/\s+/g, " ").trim();
  const type = markerTypeMap(normalizedMarker);
  const cleaned = body.replace(/\s+/g, " ").trim();

  if (!type) {
    return createTextBlock(`Imported ${marker}`, cleaned);
  }

  if (type === "formTitle" || type === "formDescription" || type === "formStyle") {
    return {
      type,
      value: cleaned
    };
  }

  if (type === "formMaxResponses" || type === "formMaxAcceptedResponses") {
    return {
      type,
      value: Math.max(0, Number(cleaned) || 0)
    };
  }

  if (type === "text") {
    return createTextBlock("Imported Text", cleaned);
  }

  if (type === "note") {
    const parts = cleaned.split("|");
    const label = (parts.shift() || "").trim() || "Imported Note";
    const referenceCode = (parts.shift() || "").trim();
    const content = parts.join("|").trim() || "Add note text here.";
    return createNoteBlock(label, content, referenceCode);
  }

  if (type === "image" || type === "gif") {
    const parts = parsePipeParts(cleaned);
    return createImportedQuestion(type, parts.shift() || `Imported ${QUESTION_TYPES[type]}`, {
      content: parts.shift() || "",
      placeholder: parts[0] || ""
    });
  }

  if (type === "drawing") {
    const parts = parsePipeParts(cleaned);
    return createImportedQuestion(type, parts.shift() || "Drawing prompt", {
      placeholder: parts[0] || "Draw your answer in the box."
    });
  }

  if (type === "code") {
    const parts = parsePipeParts(cleaned);
    return createImportedQuestion(type, parts.shift() || "Code prompt", {
      placeholder: parts[0] || "// Type your code here"
    });
  }

  if (type === "animation") {
    const parts = parsePipeParts(cleaned);
    return createImportedQuestion(type, parts.shift() || "Animation prompt", {
      placeholder: parts[0] || "Draw a simple 4-frame animation below."
    });
  }

  const parts = parsePipeParts(cleaned);
  const label = parts.shift() || `Imported ${QUESTION_TYPES[type]}`;

  if (type === "multiple" || type === "checkbox" || type === "dropdown" || type === "emoji") {
    return createImportedQuestion(type, label, {
      options: parts.length ? parts : defaultOptionsForType(type),
      required
    });
  }

  if (type === "fillblank" || type === "short" || type === "email" || type === "number") {
    return createImportedQuestion(type, label, {
      placeholder: parts[0] || "",
      required
    });
  }

  if (type === "branchfill") {
    const placeholder = parts.shift() || "Type one of the branch matches";
    const branches = defaultBranchFillBranches();
    for (let index = 0; index < BRANCH_FILL_COUNT; index += 1) {
      const rawBranch = parts[index] || "";
      if (!rawBranch) continue;
      const [match, promptsText = ""] = rawBranch.split("=>").map((item) => item.trim());
      branches[index] = {
        match: match || branches[index].match,
        prompts: promptsText
          ? promptsText.split(";;").map((item) => item.trim()).filter(Boolean)
          : []
      };
    }
    return createImportedQuestion(type, label, {
      placeholder,
      branches,
      required
    });
  }

  if (type === "graph") {
    return createImportedQuestion(type, label, {
      content: parts.shift() || "",
      graphPoints: parseGraphPoints(parts),
      required
    });
  }

  if (type === "scale") {
    const left = parts[0] || "Low";
    const right = parts[1] || "High";
    const size = Number(parts[2]) || 5;
    return createImportedQuestion(type, label, {
      scaleLeft: left,
      scaleRight: right,
      options: Array.from({ length: size }, (_item, index) => String(index + 1)),
      required
    });
  }

  if (type === "rating") {
    const size = Number(parts[0]) || 5;
    return createImportedQuestion(type, label, {
      options: Array.from({ length: size }, (_item, index) => String(index + 1)),
      required
    });
  }

  return createImportedQuestion(type, label, { required });
}

function parseImportedPdfText(text) {
  const blocks = [];
  const formMeta = {};
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const markerLineRegex = /^\s*\((?:\*([^*\n]+)\*|([^\)\n]+))\)\s*(.*)$/;
  let currentMarker = null;
  let currentBodyLines = [];

  const commitCurrentBlock = () => {
    const body = currentBodyLines.join("\n").trim();
    if (!currentMarker || !body) return;
    const parsed = buildQuestionFromImportedBlock(currentMarker, body);
    if (parsed?.type === "formTitle") formMeta.title = parsed.value;
    else if (parsed?.type === "formDescription") formMeta.description = parsed.value;
    else if (parsed?.type === "formStyle") formMeta.style = parsed.value.toLowerCase().replace(/\s+/g, "_");
    else if (parsed?.type === "formMaxResponses") formMeta.maxResponses = parsed.value;
    else if (parsed?.type === "formMaxAcceptedResponses") formMeta.maxAcceptedResponses = parsed.value;
    else blocks.push(parsed);
  };

  for (const line of lines) {
    const markerMatch = line.match(markerLineRegex);
    if (markerMatch) {
      commitCurrentBlock();
      currentMarker = markerMatch[1] || markerMatch[2] || null;
      currentBodyLines = markerMatch[3] ? [markerMatch[3]] : [];
      continue;
    }
    if (currentMarker) {
      currentBodyLines.push(line);
    }
  }

  commitCurrentBlock();

  if (!blocks.length && !Object.keys(formMeta).length) {
    const tail = String(text || "").trim();
    if (tail) {
      blocks.push(createTextBlock("Imported PDF Text", tail));
    }
  }

  return { blocks, formMeta };
}

function applyImportedContentToForm(formId, parsed, sourceLabel) {
  const importedBlocks = parsed.blocks;

  if (!importedBlocks.length) {
    if (!parsed.formMeta.title && !parsed.formMeta.description && !parsed.formMeta.style && parsed.formMeta.maxResponses == null && parsed.formMeta.maxAcceptedResponses == null) {
      setToast(`No readable import markers were found in that ${sourceLabel}.`, "danger");
      return;
    }
  }

  const shouldOverwrite = window.confirm(
    `Would you like to overwrite the current form with the imported ${sourceLabel} content?\n\n` +
    "Press OK to replace the title, description, and questions.\n" +
    "Press Cancel to keep the current form and append the imported blocks."
  );

  updateForm(formId, (form) => {
    if (shouldOverwrite) {
      form.title = parsed.formMeta.title || form.title;
      form.description = parsed.formMeta.description || form.description;
      form.style = FORM_STYLES[parsed.formMeta.style] ? parsed.formMeta.style : form.style;
      form.maxResponses = parsed.formMeta.maxResponses ?? form.maxResponses;
      form.maxAcceptedResponses = parsed.formMeta.maxAcceptedResponses ?? form.maxAcceptedResponses;
      form.questions = importedBlocks.length ? importedBlocks : form.questions;
      form.responses = [];
      return;
    }

    if (parsed.formMeta.title && form.title === "Untitled Form") form.title = parsed.formMeta.title;
    if (parsed.formMeta.description && !form.description) form.description = parsed.formMeta.description;
    if (parsed.formMeta.style && FORM_STYLES[parsed.formMeta.style] && form.style === "default") form.style = parsed.formMeta.style;
    if (parsed.formMeta.maxResponses != null && !form.maxResponses) form.maxResponses = parsed.formMeta.maxResponses;
    if (parsed.formMeta.maxAcceptedResponses != null && !form.maxAcceptedResponses) form.maxAcceptedResponses = parsed.formMeta.maxAcceptedResponses;
    form.questions.push(...importedBlocks);
  });

  setToast(
    shouldOverwrite
      ? `Current form replaced with ${importedBlocks.length} imported ${sourceLabel} blocks.`
      : `Imported ${importedBlocks.length} ${sourceLabel} blocks into the current form.`
  );
  render();
}

async function importPdfIntoForm(formId, file) {
  const response = await fetch("/api/import-pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf"
    },
    body: file
  });

  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    setToast(payload.error || "PDF import failed.", "danger");
    return;
  }

  const parsed = parseImportedPdfText(payload.text || "");
  if (!parsed.blocks.length && !parsed.formMeta.title && !parsed.formMeta.description && !parsed.formMeta.style && parsed.formMeta.maxResponses == null && parsed.formMeta.maxAcceptedResponses == null) {
    setToast("No readable text was found in that PDF.", "danger");
    return;
  }
  applyImportedContentToForm(formId, parsed, "PDF");
}

function importTextIntoForm(formId, text) {
  const parsed = parseImportedPdfText(text || "");
  applyImportedContentToForm(formId, parsed, "text");
}

function duplicateQuestion(formId, questionId) {
  updateForm(formId, (form) => {
    const index = form.questions.findIndex((question) => question.id === questionId);
    if (index === -1) return;
    const copy = structuredClone(form.questions[index]);
    copy.id = makeId();
    copy.label = `${copy.label} (copy)`;
    form.questions.splice(index + 1, 0, copy);
  });
  setToast("Question duplicated.");
  render();
}

function saveResponse(formId, answers, meta) {
  return fetch("/api/submit-response", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      form_id: formId,
      answers,
      meta
    })
  })
    .then((response) => response.json().then((payload) => ({ response, payload })))
    .then(({ response, payload }) => {
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not submit response.");
      }
      return payload.response;
    });
}

function renderFormsList() {
  if (!state.isAdmin) {
    formsList.innerHTML = "";
    return;
  }

  const current = route().value;
  formsList.innerHTML = "";

  for (const form of state.data.forms) {
    const button = document.createElement("button");
    button.className = `sidebar-form${current === form.id ? " active" : ""}`;
    button.innerHTML = `
      <div class="sidebar-form-title">${escapeHtml(form.title)}</div>
      <div class="sidebar-form-meta">${form.questions.length} questions • ${form.responses.length} responses</div>
      <div class="sidebar-form-meta">Submits Left: ${escapeHtml(remainingResponses(form))}</div>
      <div class="sidebar-form-meta">Accepts Left: ${escapeHtml(remainingAcceptedResponses(form))}</div>
    `;
    button.addEventListener("click", () => setRoute("builder", form.id));
    formsList.appendChild(button);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightedCodeHtml(value) {
  const source = String(value || "");
  const tokenRegex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|async|await|import|export|from|try|catch|finally|throw|true|false|null|undefined|this|super|extends|static|get|set|typeof|instanceof|in|of|yield)\b|\b(?:Array|Object|String|Number|Boolean|Promise|Map|Set|Date|Math|JSON|console|document|window)\b|\b[A-Za-z_$][\w$]*(?=\()|\b\d+(?:\.\d+)?\b|=>|===|!==|==|!=|<=|>=|&&|\|\||[=+\-*/%<>!]+|[()[\]{}.,;:])/g;
  let html = "";
  let lastIndex = 0;

  for (const match of source.matchAll(tokenRegex)) {
    const token = match[0];
    const index = match.index || 0;
    html += escapeHtml(source.slice(lastIndex, index));

    let className = "code-token-keyword";
    if (token.startsWith("//") || token.startsWith("/*")) className = "code-token-comment";
    else if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) className = "code-token-string";
    else if (/^\d/.test(token)) className = "code-token-number";
    else if (/^(true|false|null|undefined)$/.test(token)) className = "code-token-constant";
    else if (/^(Array|Object|String|Number|Boolean|Promise|Map|Set|Date|Math|JSON|console|document|window)$/.test(token)) className = "code-token-builtin";
    else if (/^[A-Za-z_$][\w$]*$/.test(token)) className = "code-token-function";
    else if (/^(=>|===|!==|==|!=|<=|>=|&&|\|\||[=+\-*/%<>!]+)$/.test(token)) className = "code-token-operator";
    else if (/^[()[\]{}.,;:]$/.test(token)) className = "code-token-punctuation";

    html += `<span class="${className}">${escapeHtml(token)}</span>`;
    lastIndex = index + token.length;
  }

  html += escapeHtml(source.slice(lastIndex));
  return html || " ";
}

function codeLineNumbersHtml(value) {
  const lines = String(value || "").split("\n");
  return lines.map((_line, index) => `<span>${index + 1}</span>`).join("");
}

function renderTopbarActions(content = "") {
  topbarActions.innerHTML = content;
}

function renderTopbarActionsWithHome(content = "") {
  const homeButton = `<button class="ghost-button" data-go-dashboard="1">Home</button>`;
  const extra = String(content || "").trim();
  renderTopbarActions(extra ? `${homeButton}${extra}` : homeButton);
}

function isEmbeddedMediaContent(value) {
  return String(value || "").startsWith("data:image/");
}

function mediaContentInputValue(value) {
  return isEmbeddedMediaContent(value) ? "" : String(value || "");
}

function renderBrandIcon() {
  if (!state.discordUser?.avatarUrl) {
    brandIcon.innerHTML = "DF";
    brandIcon.classList.remove("brand-avatar");
    return;
  }

  brandIcon.classList.add("brand-avatar");
  brandIcon.innerHTML = `<img src="${escapeHtml(state.discordUser.avatarUrl)}" alt="${escapeHtml(state.discordUser.username)}">`;
}

function renderToast() {
  if (!state.toast) return "";
  const klass = state.toast.type === "danger" ? "toast error-toast" : "toast";
  return `<div class="${klass}">${escapeHtml(state.toast.message)}</div>`;
}

function trackActivity(action, detail = {}) {
  fetch("/api/activity", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders()
    },
    body: JSON.stringify({ action, detail })
  }).catch(() => {});
}

const WIZARD_STEPS = [
  { key: "welcome", label: "Welcome" },
  { key: "forms", label: "Forms" },
  { key: "moderation", label: "Moderation" },
  { key: "finish", label: "Finish" }
];

function wizardStepCount() {
  return WIZARD_STEPS.length;
}

function currentWizardForm() {
  return formById(state.wizardInstaller.selectedFormId) || state.data.forms[0] || null;
}

function normalizeWizardState() {
  if (!state.data.forms.some((form) => form.id === state.wizardInstaller.selectedFormId)) {
    state.wizardInstaller.selectedFormId = state.data.forms[0]?.id || "";
  }
  const validControlViews = new Set(["visitors", "banned", "activity", "deploys"]);
  if (!validControlViews.has(state.wizardInstaller.selectedControlView)) {
    state.wizardInstaller.selectedControlView = "visitors";
  }
  const validFinishActions = new Set([
    "open_selected_form",
    "create_form",
    "open_control_panel",
    "open_blocked_list",
    "open_activity_log",
    "open_deploy_history",
    "deploy_now"
  ]);
  if (!validFinishActions.has(state.wizardInstaller.finishAction)) {
    state.wizardInstaller.finishAction = state.wizardInstaller.selectedFormId ? "open_selected_form" : "open_control_panel";
  }
  state.wizardInstaller.step = Math.max(0, Math.min(wizardStepCount() - 1, Number(state.wizardInstaller.step) || 0));
}

function setWizardStep(step) {
  state.wizardInstaller.step = Math.max(0, Math.min(wizardStepCount() - 1, step));
  render();
}

function stepWizard(direction) {
  setWizardStep((Number(state.wizardInstaller.step) || 0) + direction);
}

function resetWizardInstaller() {
  state.wizardInstaller.step = 0;
  state.wizardInstaller.selectedFormId = state.data.forms[0]?.id || "";
  state.wizardInstaller.selectedControlView = "visitors";
  state.wizardInstaller.finishAction = state.wizardInstaller.selectedFormId ? "open_selected_form" : "open_control_panel";
}

function finishWizardInstaller() {
  const action = state.wizardInstaller.finishAction;
  if (action === "create_form") {
    createForm();
    return;
  }
  if (action === "open_selected_form") {
    const form = currentWizardForm();
    if (form) {
      setRoute("builder", form.id);
      return;
    }
    createForm();
    return;
  }
  if (action === "open_control_panel") {
    setRoute("control", state.wizardInstaller.selectedControlView || "visitors");
    return;
  }
  if (action === "open_blocked_list") {
    setRoute("control", "banned");
    return;
  }
  if (action === "open_activity_log") {
    setRoute("control", "activity");
    return;
  }
  if (action === "open_deploy_history") {
    setRoute("control", "deploys");
    return;
  }
  if (action === "deploy_now") {
    deployWebsite();
    return;
  }
}

function systemClockLabel() {
  return new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

async function initializeApp() {
  render();
  try {
    await refreshAuthStatus();
    await refreshSiteData();
    if (state.isAdmin) {
      try {
        await refreshSecurityData();
        await refreshDeployStatus();
      } catch (error) {
        setToast(error.message || "Could not load admin status.", "danger");
      }
    } else {
      state.security = null;
      state.deployStatus = null;
    }
    normalizeData();
    trackActivity("page_load", { hash: window.location.hash || "#dashboard" });
  } catch (_error) {
    state.authReady = true;
  } finally {
    render();
  }
}

function renderDashboard() {
  if (!state.isAdmin) {
    renderPublicHome();
    return;
  }
  normalizeWizardState();

  const security = state.security || {
    visitors: [],
    activity_log: [],
    banned_device_ips: [],
    banned_network_ips: [],
    deployments: []
  };
  const latestDeployment = security.deployments?.[0] || null;
  const deployStatus = state.deployStatus || {
    configured: false,
    method: "not-configured",
    target_summary: "Not configured",
    script_exists: false,
    webhooks: { reset: false, submission: false, decision: false },
    discord_oauth: { configured: false }
  };
  const isWiiUTheme = state.homeTheme === "wii_u_menu";
  const isWizardTheme = state.homeTheme === "windows_wizard_setup";
  const wizardForm = currentWizardForm();
  const wizardStep = Number(state.wizardInstaller.step) || 0;

  pageTitle.textContent = "Forms Dashboard";
  routeBadge.textContent = "Dashboard";
  renderTopbarActionsWithHome(`
    <button class="primary-button" data-action="new-form">Create Form</button>
    <button class="secondary-button" data-action="deploy-live">${state.deploying ? "Updating..." : "Update Live Website"}</button>
    <button class="secondary-button" data-open-control="visitors">Control Panel</button>
    <button class="ghost-button" data-open-banned="1">Blocked List</button>
    <button class="ghost-button" data-action="logout-admin">Logout</button>
  `);

  if (!state.data.forms.length) {
    pageContent.innerHTML = document.getElementById("empty-state-template").innerHTML;
    return;
  }

  const latestForms = state.data.forms.slice(0, 4).map((form) => `
    <div class="question-card">
      <div class="question-toolbar">
        <div>
          <div class="question-type">Form</div>
          <strong>${escapeHtml(form.title)}</strong>
        </div>
        <div class="question-meta">
          <button class="ghost-button" data-open-builder="${form.id}">Edit</button>
          <button class="secondary-button" data-open-form="${form.id}">Fill</button>
        </div>
      </div>
      <div class="section-copy">${escapeHtml(form.description)}</div>
      <div class="choice-pill">${form.questions.length} questions</div>
      <div class="choice-pill">${form.responses.length} responses</div>
      <div class="choice-pill">Updated ${formatDate(form.updatedAt)}</div>
    </div>
  `).join("");
  const tileForms = state.data.forms.slice(0, 8).map((form, index) => `
    <button class="launcher-tile launcher-tile-form ${index % 3 === 0 ? "launcher-tile-wide" : ""}" data-console-target="launcher:form:${form.id}" data-open-builder="${form.id}">
      <div class="launcher-tile-icon">${escapeHtml((form.title || "F").slice(0, 2).toUpperCase())}</div>
      <div class="launcher-tile-title">${escapeHtml(form.title)}</div>
      <div class="launcher-tile-meta">${form.questions.length} questions</div>
      <div class="launcher-tile-meta">${form.responses.length} responses</div>
    </button>
  `).join("");
  const launcherTiles = `
    <section class="launcher-grid">
      <button class="launcher-tile launcher-tile-system" data-console-target="launcher:new-form" data-action="new-form">
        <div class="launcher-tile-icon">+</div>
        <div class="launcher-tile-title">Create Form</div>
        <div class="launcher-tile-meta">Start a new form</div>
      </button>
      <button class="launcher-tile launcher-tile-system" data-console-target="launcher:control" data-open-control="visitors">
        <div class="launcher-tile-icon">CP</div>
        <div class="launcher-tile-title">Control Panel</div>
        <div class="launcher-tile-meta">${security.visitors.length} visitors tracked</div>
      </button>
      <button class="launcher-tile launcher-tile-system" data-console-target="launcher:blocked" data-open-banned="1">
        <div class="launcher-tile-icon">BL</div>
        <div class="launcher-tile-title">Blocked List</div>
        <div class="launcher-tile-meta">${security.banned_device_ips.length + security.banned_network_ips.length} active bans</div>
      </button>
      <button class="launcher-tile launcher-tile-system" data-console-target="launcher:deploy" data-action="deploy-live">
        <div class="launcher-tile-icon">UP</div>
        <div class="launcher-tile-title">Update Live Website</div>
        <div class="launcher-tile-meta">${latestDeployment ? escapeHtml(latestDeployment.status || "unknown") : "Not run yet"}</div>
      </button>
      ${tileForms}
    </section>
  `;

  const totalResponses = state.data.forms.reduce((sum, form) => sum + form.responses.length, 0);
  const themeSelectorCard = `
    <div class="card">
      <h3 class="section-title">Home Screen Style</h3>
      <p class="section-copy">Switch the whole website layout style from here. This changes the dashboard and control center chrome, not just button colors.</p>
      <div class="field-group">
        <label>Website Theme</label>
        <select id="home-theme-input" class="select-input">
          ${Object.entries(FORM_STYLES).map(([value, label]) => `<option value="${value}" ${state.homeTheme === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
        </select>
      </div>
    </div>
  `;

  const standardDashboard = `
    <section class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Forms</div>
        <div class="stat-value">${state.data.forms.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Questions</div>
        <div class="stat-value">${state.data.forms.reduce((sum, form) => sum + form.questions.length, 0)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Responses</div>
        <div class="stat-value">${totalResponses}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Website Style</div>
        <div class="stat-value" style="font-size:16px">${escapeHtml(FORM_STYLES[state.homeTheme] || "Default")}</div>
      </div>
    </section>
    <section class="dashboard-grid">
      <div class="hero-card">
        <div class="hero-copy">
          <span class="hero-chip">Website + Builder</span>
          <h3>Run your forms site here, then push these files to the live website when you are ready.</h3>
          <p>Your working website files stay on this computer. Use the live update button after editing the local files, or run the watcher script to auto-sync them.</p>
          <div class="builder-actions">
            <button class="primary-button" data-action="new-form">Create Another Form</button>
            <button class="secondary-button" data-action="deploy-live">${state.deploying ? "Updating..." : "Update Live Website"}</button>
            <button class="ghost-button" data-open-control="visitors">Open Control Panel</button>
            <button class="ghost-button" data-open-banned="1">Blocked List</button>
          </div>
        </div>
        <div class="hero-preview">
          <div class="message-card">
            <div class="message-avatar"></div>
            <div>
              <div class="message-name">Forms Control</div>
              <div class="message-body">${latestDeployment ? `Last live update: ${escapeHtml(formatDate(latestDeployment.timestamp || 0))} (${escapeHtml(latestDeployment.status || "unknown")})` : "Live website updates are ready after deploy setup."}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3 class="section-title">Website Ops</h3>
        <div class="questions-stack">
          <div class="question-card">
            <div class="question-toolbar">
              <div>
                <div class="question-type">Live Sync</div>
                <strong>${deployStatus.configured ? "Deploy target configured" : "Deploy setup still needed"}</strong>
              </div>
              <div class="question-meta">
                <div class="choice-pill">${escapeHtml(deployStatus.method || "not-configured")}</div>
              </div>
            </div>
            <div class="section-copy">${escapeHtml(deployStatus.target_summary || "Not configured")}</div>
            <div class="builder-actions">
              ${deployStatusPill("Deploy Script", deployStatus.script_exists)}
              ${deployStatusPill("Submission Webhook", Boolean(deployStatus.webhooks?.submission))}
              ${deployStatusPill("Decision Webhook", Boolean(deployStatus.webhooks?.decision))}
              ${deployStatusPill("Reset Webhook", Boolean(deployStatus.webhooks?.reset))}
              ${deployStatusPill("Discord OAuth", Boolean(deployStatus.discord_oauth?.configured))}
            </div>
          </div>
          <div class="question-card">
            <div class="question-toolbar">
              <div>
                <div class="question-type">Visitors</div>
                <strong>${security.visitors.length} tracked visitor${security.visitors.length === 1 ? "" : "s"}</strong>
              </div>
              <div class="question-meta">
                <div class="choice-pill">${security.activity_log.length} events</div>
              </div>
            </div>
            <div class="section-copy">${security.banned_device_ips.length + security.banned_network_ips.length} banned IP entries are currently active.</div>
          </div>
        </div>
      </div>
      <div class="card">
        <h3 class="section-title">Live Website Setup</h3>
        <p class="section-copy">Keep all passwords, codes, webhook URLs, and OAuth secrets in the server-only <code>.env</code>. They stay off the browser and are excluded from deploy copies by <code>deploy_website.sh</code>.</p>
        <p class="section-copy">Current target: ${escapeHtml(deployStatus.target_summary || "Not configured")}<br>Method: ${escapeHtml(deployStatus.method || "not-configured")}</p>
        <p class="section-copy">To publish this as a real site, set either <code>DEPLOY_LOCAL_DIR</code> or <code>DEPLOY_HOST</code> plus <code>DEPLOY_PATH</code>. Then edit locally and press <strong>Update Live Website</strong>.</p>
      </div>
      ${themeSelectorCard}
      <div class="card">
        <h3 class="section-title">Recent Forms</h3>
        <div class="questions-stack">${latestForms}</div>
      </div>
    </section>
  `;

  const wiiUDashboard = `
    <section class="console-home-screen">
      <div class="console-atmosphere" aria-hidden="true">
        <div class="console-glow console-glow-left"></div>
        <div class="console-glow console-glow-right"></div>
        <div class="console-orb console-orb-a"></div>
        <div class="console-orb console-orb-b"></div>
      </div>
      <div class="console-statusbar console-statusbar-top">
        <div class="console-statusbar-left"><span class="console-mini-dot"></span>Home Menu</div>
        <div class="console-statusbar-center">Discord Forms Console</div>
        <div class="console-statusbar-right">${systemClockLabel()}</div>
      </div>
      <div class="console-stage">
        <header class="console-header">
          <div class="console-header-copy">
            <div class="console-eyebrow">Launcher</div>
            <h3 class="console-title">Choose a tile</h3>
            <p class="console-subtitle">Forms, moderation, and live update controls are arranged like a system menu. Move between tiles, then open the current selection.</p>
          </div>
          <div class="console-status-cluster">
            <div class="console-status-pill">
              <span class="console-status-label">Forms</span>
              <strong>${state.data.forms.length}</strong>
            </div>
            <div class="console-status-pill">
              <span class="console-status-label">Visitors</span>
              <strong>${security.visitors.length}</strong>
            </div>
            <div class="console-status-pill">
              <span class="console-status-label">Deploy</span>
              <strong>${latestDeployment ? escapeHtml(latestDeployment.status || "idle") : "idle"}</strong>
            </div>
          </div>
        </header>
        <section class="console-launcher-shell">
          <div class="console-launcher-frame">
            ${launcherTiles}
          </div>
        </section>
        <aside class="console-sidecard">
          <div class="console-sidecard-title">System Message</div>
          <div class="console-sidecard-copy">${latestDeployment ? `Last deploy ${escapeHtml(latestDeployment.status || "unknown")} on ${escapeHtml(formatDate(latestDeployment.timestamp || 0))}.` : "No deploy has been run yet. Use the update tile or the dock to push this local site live."}</div>
        </aside>
      </div>
      <footer class="console-dock">
        <button class="console-dock-item" data-console-target="dock:create" data-action="new-form">
          <span class="console-dock-icon">+</span>
          <span>Create</span>
        </button>
        <button class="console-dock-item" data-console-target="dock:control" data-open-control="visitors">
          <span class="console-dock-icon">CP</span>
          <span>Control</span>
        </button>
        <button class="console-dock-item" data-console-target="dock:blocked" data-open-banned="1">
          <span class="console-dock-icon">BL</span>
          <span>Blocked</span>
        </button>
        <button class="console-dock-item" data-console-target="dock:update" data-action="deploy-live">
          <span class="console-dock-icon">UP</span>
          <span>Update</span>
        </button>
      </footer>
      <div class="console-statusbar console-statusbar-bottom">
        <div class="console-statusbar-left">Use arrows to move between the grid and dock</div>
        <div class="console-statusbar-center">${totalResponses} responses • ${escapeHtml(FORM_STYLES[state.homeTheme] || "Default")}</div>
        <div class="console-statusbar-right">
          <label class="console-theme-switch">
            <span>Theme</span>
            <select id="home-theme-input" class="console-theme-select">
              ${Object.entries(FORM_STYLES).map(([value, label]) => `<option value="${value}" ${state.homeTheme === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
            </select>
          </label>
        </div>
      </div>
    </section>
  `;

  const wizardDashboard = `
    <section class="setup-backdrop">
      <div class="setup-window" role="dialog" aria-modal="true" aria-labelledby="wizard-window-title">
        <header class="setup-titlebar">
          <div class="setup-titlebar-caption">
            <span class="setup-titlebar-icon">DF</span>
            <span id="wizard-window-title">Discord Forms Setup Wizard</span>
          </div>
          <div class="setup-titlebar-theme">
            <label>
              <span>Theme</span>
              <select id="home-theme-input" class="setup-theme-select">
                ${Object.entries(FORM_STYLES).map(([value, label]) => `<option value="${value}" ${state.homeTheme === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
              </select>
            </label>
          </div>
        </header>
        <aside class="setup-sidebar">
          <div class="setup-sidebar-title">Setup Steps</div>
          <div class="setup-sidebar-copy">Follow each page in order to configure the local forms system.</div>
          ${WIZARD_STEPS.map((step, index) => `
            <div class="setup-step ${index === wizardStep ? "active" : ""} ${index < wizardStep ? "complete" : ""}"><span>${index < wizardStep ? "✓" : index + 1}</span><strong>${escapeHtml(step.label)}</strong></div>
          `).join("")}
        </aside>
        <div class="setup-main">
          <div class="setup-body">
            <div class="wizard-step-shell">
            <section class="wizard-step-screen ${wizardStep === 0 ? "active" : ""}">
              <div class="wizard-step-header">
                <div class="wizard-step-kicker">Step 1 of ${wizardStepCount()}</div>
                <h3>Welcome To Discord Forms Setup</h3>
                <p>This wizard configures what you want to open next and guides you through the local forms system one page at a time.</p>
              </div>
              <div class="wizard-summary-grid">
                <div class="wizard-summary-card">
                  <div class="wizard-summary-label">Forms</div>
                  <div class="wizard-summary-value">${state.data.forms.length}</div>
                </div>
                <div class="wizard-summary-card">
                  <div class="wizard-summary-label">Visitors</div>
                  <div class="wizard-summary-value">${security.visitors.length}</div>
                </div>
                <div class="wizard-summary-card">
                  <div class="wizard-summary-label">Blocked</div>
                  <div class="wizard-summary-value">${security.banned_device_ips.length + security.banned_network_ips.length}</div>
                </div>
                <div class="wizard-summary-card">
                  <div class="wizard-summary-label">Activity</div>
                  <div class="wizard-summary-value">${security.activity_log.length}</div>
                </div>
              </div>
              <div class="wizard-info-card">
                <div class="wizard-info-title">What this wizard does</div>
                <p>Each page replaces the previous one, your selections stay saved while you move back and forward, and Finish opens the destination you choose on the last page.</p>
              </div>
            </section>
            <section class="wizard-step-screen ${wizardStep === 1 ? "active" : ""}">
              <div class="wizard-step-header">
                <div class="wizard-step-kicker">Step 2 of ${wizardStepCount()}</div>
                <h3>Select A Form Workspace</h3>
                <p>Pick the form that should stay selected as you continue through the installer.</p>
              </div>
              <div class="setup-panel-grid">
                ${state.data.forms.map((form) => `
                  <button class="setup-choice-card ${state.wizardInstaller.selectedFormId === form.id ? "wizard-choice-selected" : ""}" data-wizard-form="${form.id}">
                    <div class="setup-choice-title">${escapeHtml(form.title)}</div>
                    <div class="setup-choice-copy">${escapeHtml(form.description || "No description yet.")}</div>
                    <div class="wizard-choice-meta">${form.questions.length} questions • ${form.responses.length} responses</div>
                  </button>
                `).join("") || `
                  <div class="wizard-info-card">
                    <div class="wizard-info-title">No forms yet</div>
                    <p>Create one on the Finish step or leave the wizard and start from the builder.</p>
                  </div>
                `}
              </div>
              ${wizardForm ? `
                <div class="wizard-info-card">
                  <div class="wizard-info-title">Current selection</div>
                  <p><strong>${escapeHtml(wizardForm.title)}</strong><br>${escapeHtml(wizardForm.description || "No description yet.")}</p>
                </div>
              ` : ""}
            </section>
            <section class="wizard-step-screen ${wizardStep === 2 ? "active" : ""}">
              <div class="wizard-step-header">
                <div class="wizard-step-kicker">Step 3 of ${wizardStepCount()}</div>
                <h3>Choose A Moderation Focus</h3>
                <p>This selection is used as the default admin destination when you choose a control-panel finish action.</p>
              </div>
              <div class="setup-panel-grid">
                <button class="setup-choice-card ${state.wizardInstaller.selectedControlView === "visitors" ? "wizard-choice-selected" : ""}" data-wizard-control="visitors">
                  <div class="setup-choice-title">Visitors</div>
                  <div class="setup-choice-copy">${security.visitors.length} tracked visitors are available to review.</div>
                </button>
                <button class="setup-choice-card ${state.wizardInstaller.selectedControlView === "banned" ? "wizard-choice-selected" : ""}" data-wizard-control="banned">
                  <div class="setup-choice-title">Blocked List</div>
                  <div class="setup-choice-copy">${security.banned_device_ips.length + security.banned_network_ips.length} active bans are stored.</div>
                </button>
                <button class="setup-choice-card ${state.wizardInstaller.selectedControlView === "activity" ? "wizard-choice-selected" : ""}" data-wizard-control="activity">
                  <div class="setup-choice-title">Activity Log</div>
                  <div class="setup-choice-copy">${security.activity_log.length} activity events can be reviewed.</div>
                </button>
                <button class="setup-choice-card ${state.wizardInstaller.selectedControlView === "deploys" ? "wizard-choice-selected" : ""}" data-wizard-control="deploys">
                  <div class="setup-choice-title">Deploy History</div>
                  <div class="setup-choice-copy">${security.deployments.length} deploy records are saved.</div>
                </button>
              </div>
            </section>
            <section class="wizard-step-screen ${wizardStep === 3 ? "active" : ""}">
              <div class="wizard-step-header">
                <div class="wizard-step-kicker">Step 4 of ${wizardStepCount()}</div>
                <h3>Finish Setup</h3>
                <p>Choose what should happen when you press Finish.</p>
              </div>
              <div class="wizard-finish-options">
                <label class="wizard-radio-card ${state.wizardInstaller.finishAction === "open_selected_form" ? "wizard-choice-selected" : ""}">
                  <input type="radio" name="wizard-finish-action" value="open_selected_form" ${state.wizardInstaller.finishAction === "open_selected_form" ? "checked" : ""}>
                  <span>
                    <strong>Open Selected Form</strong>
                    <span>${wizardForm ? escapeHtml(wizardForm.title) : "Open the current form selection"}</span>
                  </span>
                </label>
                <label class="wizard-radio-card ${state.wizardInstaller.finishAction === "create_form" ? "wizard-choice-selected" : ""}">
                  <input type="radio" name="wizard-finish-action" value="create_form" ${state.wizardInstaller.finishAction === "create_form" ? "checked" : ""}>
                  <span>
                    <strong>Create A New Form</strong>
                    <span>Start a brand new builder session.</span>
                  </span>
                </label>
                <label class="wizard-radio-card ${state.wizardInstaller.finishAction === "open_control_panel" ? "wizard-choice-selected" : ""}">
                  <input type="radio" name="wizard-finish-action" value="open_control_panel" ${state.wizardInstaller.finishAction === "open_control_panel" ? "checked" : ""}>
                  <span>
                    <strong>Open Control Panel</strong>
                    <span>Open the default moderation view.</span>
                  </span>
                </label>
                <label class="wizard-radio-card ${state.wizardInstaller.finishAction === "open_blocked_list" ? "wizard-choice-selected" : ""}">
                  <input type="radio" name="wizard-finish-action" value="open_blocked_list" ${state.wizardInstaller.finishAction === "open_blocked_list" ? "checked" : ""}>
                  <span>
                    <strong>Open Blocked List</strong>
                    <span>Go straight to the banned users screen.</span>
                  </span>
                </label>
                <label class="wizard-radio-card ${state.wizardInstaller.finishAction === "open_activity_log" ? "wizard-choice-selected" : ""}">
                  <input type="radio" name="wizard-finish-action" value="open_activity_log" ${state.wizardInstaller.finishAction === "open_activity_log" ? "checked" : ""}>
                  <span>
                    <strong>Open Activity Log</strong>
                    <span>Review recent website events first.</span>
                  </span>
                </label>
                <label class="wizard-radio-card ${state.wizardInstaller.finishAction === "open_deploy_history" ? "wizard-choice-selected" : ""}">
                  <input type="radio" name="wizard-finish-action" value="open_deploy_history" ${state.wizardInstaller.finishAction === "open_deploy_history" ? "checked" : ""}>
                  <span>
                    <strong>Open Deploy History</strong>
                    <span>Inspect past deploy output before changing anything.</span>
                  </span>
                </label>
                <label class="wizard-radio-card ${state.wizardInstaller.finishAction === "deploy_now" ? "wizard-choice-selected" : ""}">
                  <input type="radio" name="wizard-finish-action" value="deploy_now" ${state.wizardInstaller.finishAction === "deploy_now" ? "checked" : ""}>
                  <span>
                    <strong>Deploy Now</strong>
                    <span>Run the live website update immediately.</span>
                  </span>
                </label>
              </div>
              <div class="wizard-info-card">
                <div class="wizard-info-title">Current wizard state</div>
                <p>Selected form: <strong>${escapeHtml(wizardForm?.title || "None")}</strong><br>Moderation focus: <strong>${escapeHtml(state.wizardInstaller.selectedControlView)}</strong><br>Finish action: <strong>${escapeHtml(state.wizardInstaller.finishAction.split("_").join(" "))}</strong></p>
              </div>
            </section>
          </div>
          </div>
          <footer class="setup-footer">
            <div class="setup-footer-spacer"></div>
            <div class="setup-footer-actions">
              <button class="secondary-button" type="button" data-wizard-back="1" ${wizardStep === 0 ? "disabled" : ""}>Back</button>
              <button class="primary-button" type="button" data-wizard-next="1">${wizardStep === wizardStepCount() - 1 ? "Finish" : "Next"}</button>
              <button class="ghost-button" type="button" data-wizard-cancel="1">Cancel</button>
            </div>
          </footer>
        </div>
      </div>
    </section>
  `;

  pageContent.innerHTML = `
    ${renderToast()}
    ${isWizardTheme ? wizardDashboard : isWiiUTheme ? wiiUDashboard : standardDashboard}
  `;
  document.getElementById("home-theme-input")?.addEventListener("change", (event) => {
    setHomeTheme(event.currentTarget.value);
  });
  if (isWiiUTheme) {
    initializeConsoleHome();
  }
  initializeAnimationResponsePreviews();
}

function renderPublicHome() {
  const forms = [...state.data.forms].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

  pageTitle.textContent = "Discord Forms";
  routeBadge.textContent = "Public Site";
  renderTopbarActions("");

  pageContent.innerHTML = `
    ${renderToast()}
    <section class="hero-card">
      <div class="hero-copy">
        <span class="hero-chip">Open Website</span>
        <h3>Browse forms and submit them directly from the website.</h3>
        <p>Share this homepage with visitors. Admin login stays here for editing, moderation, and live updates.</p>
      </div>
      <div class="card auth-card public-home-login-card">
        <h3 class="section-title">Admin Login</h3>
        <p class="section-copy">Only admins can create, edit, moderate, and deploy the site.</p>
        <form id="admin-login-form" class="questions-stack">
          <div class="field-group">
            <label>Username</label>
            <input class="text-input" name="username" autocomplete="username">
          </div>
          <div class="field-group">
            <label>Password</label>
            <input class="text-input" type="password" name="password" autocomplete="current-password">
          </div>
          <div class="builder-actions">
            <button class="primary-button" type="submit">Login</button>
            <button class="ghost-button" type="button" data-action="request-reset-link">Reset Login</button>
          </div>
        </form>
      </div>
    </section>
    <section class="card">
      <div class="public-home-section-header">
        <div>
          <h3 class="section-title">Available Forms</h3>
          <p class="section-copy">Visitors can open any form below without the admin password.</p>
        </div>
      </div>
      ${forms.length ? `
        <div class="public-form-grid">
          ${forms.map((form) => {
            const closedReason = formClosedReason(form);
            const availabilityLabel = closedReason ? "Closed" : `${remainingResponses(form)} spots left`;
            return `
              <section class="question-card public-form-card">
                <div class="question-toolbar">
                  <div>
                    <div class="question-type">${closedReason ? "Closed Form" : "Open Form"}</div>
                    <strong>${escapeHtml(form.title)}</strong>
                  </div>
                  <div class="question-meta">
                    <button class="primary-button" data-open-form="${form.id}">${closedReason ? "View Form" : "Open Form"}</button>
                  </div>
                </div>
                <p class="section-copy">${escapeHtml(form.description || "No description yet.")}</p>
                <div>
                  <span class="choice-pill">${form.questions.length} question${form.questions.length === 1 ? "" : "s"}</span>
                  <span class="choice-pill">${escapeHtml(availabilityLabel)}</span>
                  <span class="choice-pill">Updated ${formatDate(form.updatedAt)}</span>
                </div>
                ${closedReason ? `<p class="public-form-status">${escapeHtml(closedReason)}</p>` : ""}
              </section>
            `;
          }).join("")}
        </div>
      ` : `
        <div class="question-card public-empty-state">
          <div class="question-type">No Forms Yet</div>
          <strong>The website is ready, but there are no public forms listed yet.</strong>
          <p class="section-copy">Log in as admin to create the first form.</p>
        </div>
      `}
    </section>
  `;

  document.getElementById("admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      await loginAdmin(
        String(formData.get("username") || ""),
        String(formData.get("password") || "")
      );
      setToast("Logged in.");
      setRoute("dashboard");
    } catch (error) {
      setToast(error.message, "danger");
    }
  });
}

async function renderControlPanel() {
  if (!state.isAdmin) {
    renderPublicLogin();
    return;
  }

  if (!state.security) {
    try {
      await refreshSecurityData();
      await refreshDeployStatus();
    } catch (error) {
      setToast(error.message || "Could not load control panel.", "danger");
    }
  }

  const security = state.security || {
    visitors: [],
    activity_log: [],
    banned_device_ips: [],
    banned_network_ips: [],
    deployments: []
  };
  const deployStatus = state.deployStatus || {
    configured: false,
    method: "not-configured",
    target_summary: "Not configured",
    script_exists: false,
    webhooks: { reset: false, submission: false, decision: false },
    discord_oauth: { configured: false }
  };
  const isWizardTheme = state.homeTheme === "windows_wizard_setup";
  const view = controlView();
  const controlHeading = view === "banned"
    ? "Blocked Visitors"
    : view === "activity"
      ? "Activity Log"
      : view === "deploys"
        ? "Deploy History"
        : "Visitors";

  pageTitle.textContent = `Control Panel • ${controlHeading}`;
  routeBadge.textContent = "Moderation";
  renderTopbarActionsWithHome(`
    <button class="secondary-button" data-open-control="visitors">Visitors</button>
    <button class="secondary-button" data-open-control="banned">Blocked / Banned</button>
    <button class="secondary-button" data-open-control="activity">Activity</button>
    <button class="secondary-button" data-open-control="deploys">Deploys</button>
    <button class="primary-button" data-action="deploy-live">${state.deploying ? "Updating..." : "Update Live Website"}</button>
    <button class="secondary-button" data-refresh-control="1">Refresh</button>
    <button class="ghost-button" data-action="logout-admin">Logout</button>
  `);

  const visitorsMarkup = `
    <section class="responses-grid">
      <div class="card">
        <h3 class="section-title">Visitors Entering The Website</h3>
        <div class="responses-stack">
          ${security.visitors.map((visitor) => `
            <div class="answer-block">
              <div class="answer-label">${escapeHtml(visitorDisplayName(visitor))}</div>
              <div class="answer-value">
                <div>Role: ${escapeHtml(visitor.is_admin ? "Admin" : "Visitor")}</div>
                <div>IP Username: ${escapeHtml(visitorDisplayName(visitor))}</div>
                <div>Device IP: ${escapeHtml(visitor.device_ip || "Unknown")}</div>
                <div>Wi-Fi / Network IP: ${escapeHtml(visitor.network_ip || "Unknown")}</div>
                <div>Last Path: ${escapeHtml(visitor.last_path || "/")}</div>
                <div>Requests: ${escapeHtml(visitor.request_count || 0)}</div>
                <div>Activity Events: ${escapeHtml(visitor.activity_count || 0)}</div>
                <div>Last Action: ${escapeHtml(visitor.last_action || "Unknown")}</div>
                <div>Last Seen: ${escapeHtml(formatDate(visitor.last_seen || 0))}</div>
                <div class="field-group" style="margin-top:12px">
                  <label>Ban Reason They Will See</label>
                  <textarea id="${banReasonInputId("device", visitor.device_ip || visitor.network_ip || "")}" class="text-area" placeholder="Say why they were banned. This shows on the ban page."></textarea>
                </div>
                <div class="builder-actions" style="margin-top:12px">
                  <button class="danger-button" data-ban-device="${escapeHtml(visitor.device_ip || "")}">Ban Device IP</button>
                  <button class="danger-button" data-ban-network="${escapeHtml(visitor.network_ip || "")}">Ban Wi-Fi / Network IP</button>
                </div>
              </div>
            </div>
          `).join("") || '<div class="empty-inline">No visitors logged yet.</div>'}
        </div>
      </div>
    </section>
  `;

  const bannedMarkup = `
    <section class="responses-grid">
      <div class="card">
        <h3 class="section-title">Blocked / Banned List</h3>
        <div class="responses-stack">
          ${security.banned_device_ips.map((entry) => `
            <div class="answer-block">
              <div class="answer-label">Device IP Ban</div>
              <div class="answer-value">
                <div>IP Username: ${escapeHtml(entry.value || "")}</div>
                <div>Reason: ${escapeHtml(entry.reason || "No reason added.")}</div>
                <div>Added: ${escapeHtml(formatDate(entry.created_at || 0))}</div>
                <div class="builder-actions" style="margin-top:12px">
                  <button class="secondary-button" data-unban-device="${escapeHtml(entry.value || "")}">Unban Device IP</button>
                </div>
              </div>
            </div>
          `).join("")}
          ${security.banned_network_ips.map((entry) => `
            <div class="answer-block">
              <div class="answer-label">Wi-Fi / Network Ban</div>
              <div class="answer-value">
                <div>Wi-Fi / Network IP: ${escapeHtml(entry.value || "")}</div>
                <div>Reason: ${escapeHtml(entry.reason || "No reason added.")}</div>
                <div>Added: ${escapeHtml(formatDate(entry.created_at || 0))}</div>
                <div class="builder-actions" style="margin-top:12px">
                  <button class="secondary-button" data-unban-network="${escapeHtml(entry.value || "")}">Unban Wi-Fi / Network IP</button>
                </div>
              </div>
            </div>
          `).join("") || '<div class="empty-inline">No banned IPs yet.</div>'}
        </div>
      </div>
    </section>
  `;

  const activityMarkup = `
    <section class="card">
      <h3 class="section-title">Activity Log</h3>
      <div class="responses-stack">
        ${security.activity_log.map((entry) => `
          <div class="answer-block">
            <div class="answer-label">${escapeHtml(entry.category || "event")} • ${escapeHtml(entry.action || "")}</div>
            <div class="answer-value">
              <div>Time: ${escapeHtml(formatDate(entry.timestamp || 0))}</div>
              <div>User: ${escapeHtml(activityDisplayName(entry))}</div>
              <div>Path: ${escapeHtml(entry.path || "/")}</div>
              <div>Device IP: ${escapeHtml(entry.device_ip || "Unknown")}</div>
              <div>Wi-Fi / Network IP: ${escapeHtml(entry.network_ip || "Unknown")}</div>
              <div>Role: ${escapeHtml(entry.is_admin ? "Admin" : "Visitor")}</div>
              <div>Detail: <pre>${escapeHtml(JSON.stringify(entry.detail || {}, null, 2))}</pre></div>
              ${state.activityInsights[activityEntryKey(entry)]?.translation ? `<div><strong>AI Translate:</strong> ${escapeHtml(state.activityInsights[activityEntryKey(entry)].translation)}</div>` : ""}
              ${state.activityInsights[activityEntryKey(entry)]?.intent ? `<div><strong>Likely Intent:</strong> ${escapeHtml(state.activityInsights[activityEntryKey(entry)].intent)}</div>` : ""}
              <div class="builder-actions" style="margin-top:12px">
                <button class="secondary-button" data-translate-activity="${escapeHtml(activityEntryKey(entry))}">AI Translate</button>
                ${state.activityInsights[activityEntryKey(entry)]?.translation ? `<button class="ghost-button" data-intent-activity="${escapeHtml(activityEntryKey(entry))}">AI Likely Intent</button>` : ""}
              </div>
            </div>
          </div>
        `).join("") || '<div class="empty-inline">No activity logged yet.</div>'}
      </div>
    </section>
  `;

  const deploysMarkup = `
    <section class="responses-grid">
      <div class="card">
        <h3 class="section-title">Live Website Update</h3>
        <div class="responses-stack">
          <div class="answer-block">
            <div class="answer-label">Push local files to live website</div>
            <div class="answer-value">
              <div>Click the button below after editing files in this project.</div>
              <div>Target: ${escapeHtml(deployStatus.target_summary || "Not configured")}</div>
              <div>Method: ${escapeHtml(deployStatus.method || "not-configured")}</div>
              <div class="builder-actions" style="margin-top:12px">
                ${deployStatusPill("Deploy Script", deployStatus.script_exists)}
                ${deployStatusPill("Submission Webhook", Boolean(deployStatus.webhooks?.submission))}
                ${deployStatusPill("Decision Webhook", Boolean(deployStatus.webhooks?.decision))}
                ${deployStatusPill("Reset Webhook", Boolean(deployStatus.webhooks?.reset))}
              </div>
              <div class="builder-actions" style="margin-top:12px">
                <button class="primary-button" data-action="deploy-live">${state.deploying ? "Updating..." : "Update Live Website"}</button>
              </div>
            </div>
          </div>
          ${(security.deployments || []).map((deploy) => `
            <div class="answer-block">
              <div class="answer-label">${escapeHtml(deploy.status || "unknown")} • ${escapeHtml(formatDate(deploy.timestamp || 0))}</div>
              <div class="answer-value">
                <div>Ran By: ${escapeHtml(deploy.ran_by || "Unknown")}</div>
                <div>Exit Code: ${escapeHtml(deploy.exit_code ?? "Unknown")}</div>
                <div>Output:</div>
                <pre>${escapeHtml(deploy.stderr || deploy.stdout || "No deploy output stored.")}</pre>
              </div>
            </div>
          `).join("") || '<div class="empty-inline">No deploy history yet.</div>'}
        </div>
      </div>
    </section>
  `;

  const controlBody = `
    ${renderToast()}
    <section class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Visitors</div>
        <div class="stat-value">${security.visitors.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Activity Events</div>
        <div class="stat-value">${security.activity_log.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Banned IPs</div>
        <div class="stat-value">${security.banned_device_ips.length + security.banned_network_ips.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Deploy Runs</div>
        <div class="stat-value">${security.deployments.length}</div>
      </div>
    </section>
    ${view === "banned" ? bannedMarkup : ""}
    ${view === "activity" ? activityMarkup : ""}
    ${view === "deploys" ? deploysMarkup : ""}
    ${view === "visitors" ? visitorsMarkup : ""}
  `;

  pageContent.innerHTML = isWizardTheme ? `
    <section class="setup-window">
      <aside class="setup-sidebar">
        <div class="setup-sidebar-title">Discord Forms Setup</div>
        <div class="setup-step"><span>1</span><strong>Welcome</strong></div>
        <div class="setup-step active"><span>2</span><strong>${escapeHtml(controlHeading)}</strong></div>
        <div class="setup-step"><span>3</span><strong>Review</strong></div>
        <div class="setup-step"><span>4</span><strong>Finish</strong></div>
      </aside>
      <div class="setup-main">
        <div class="setup-body">${controlBody}</div>
        <footer class="setup-footer">
          <button class="ghost-button" type="button" data-go-dashboard="1">Cancel</button>
          <div class="setup-footer-actions">
            <button class="secondary-button" type="button" data-go-dashboard="1">Back</button>
            <button class="primary-button" type="button" data-refresh-control="1">Next</button>
          </div>
        </footer>
      </div>
    </section>
  ` : controlBody;
}

function renderPublicLogin() {
  pageTitle.textContent = "Admin Login";
  routeBadge.textContent = "Restricted";
  renderTopbarActionsWithHome("");

  pageContent.innerHTML = `
    ${renderToast()}
    <section class="hero-card">
      <div class="hero-copy">
        <span class="hero-chip">Admin Only</span>
        <h3>Only the admin can make or edit forms.</h3>
        <p>Anyone with a direct form link can still fill out forms, but the builder stays locked unless you log in.</p>
      </div>
      <div class="card auth-card">
        <h3 class="section-title">Login</h3>
        <p class="section-copy">This is the admin builder login. Discord login is separate and only used for filling forms.</p>
        <form id="admin-login-form" class="questions-stack">
          <div class="field-group">
            <label>Username</label>
            <input class="text-input" name="username" autocomplete="username">
          </div>
          <div class="field-group">
            <label>Password</label>
            <input class="text-input" type="password" name="password" autocomplete="current-password">
          </div>
          <div class="builder-actions">
            <button class="primary-button" type="submit">Login</button>
            <button class="ghost-button" type="button" data-action="request-reset-link">Reset Login</button>
          </div>
        </form>
      </div>
    </section>
  `;

  document.getElementById("admin-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      await loginAdmin(
        String(formData.get("username") || ""),
        String(formData.get("password") || "")
      );
      setToast("Logged in.");
      setRoute("dashboard");
    } catch (error) {
      setToast(error.message, "danger");
    }
  });
}

function renderCreateAccountRoute() {
  pageTitle.textContent = "Create Extra Account";
  routeBadge.textContent = "Secret";
  renderTopbarActionsWithHome("");
  pageContent.innerHTML = `
    ${renderToast()}
    <section class="card auth-card">
      <h3 class="section-title">Create Another Account</h3>
      <p class="section-copy">Use the extra account code to make another builder login without changing the main one.</p>
      <form id="create-account-form" class="questions-stack">
        <div class="field-group">
          <label>Secret Code</label>
          <input class="text-input" name="code">
        </div>
        <div class="field-group">
          <label>Username</label>
          <input class="text-input" name="username" autocomplete="username">
        </div>
        <div class="field-group">
          <label>Password</label>
          <input class="text-input" type="password" name="password" autocomplete="new-password">
        </div>
        <div class="builder-actions">
          <button class="primary-button" type="submit">Create Account</button>
          <button class="ghost-button" type="button" data-go-dashboard="1">Back</button>
        </div>
      </form>
    </section>
  `;

  document.getElementById("create-account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/create-account", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: String(formData.get("code") || ""),
        username: String(formData.get("username") || ""),
        password: String(formData.get("password") || "")
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setToast(payload.error || "Could not create account.", "danger");
      return;
    }
    setToast("Extra account created.");
    setRoute("dashboard");
  });
}

function renderResetRoute(token) {
  pageTitle.textContent = "Reset Admin Login";
  routeBadge.textContent = "Reset";
  renderTopbarActionsWithHome("");
  pageContent.innerHTML = `
    ${renderToast()}
    <section class="card auth-card">
      <h3 class="section-title">Reset Login</h3>
      <p class="section-copy">Use the reset code to change the main login.</p>
      <form id="reset-login-form" class="questions-stack">
        <div class="field-group">
          <label>New Username</label>
          <input class="text-input" name="username" autocomplete="username">
        </div>
        <div class="field-group">
          <label>New Password</label>
          <input class="text-input" type="password" name="password" autocomplete="new-password">
        </div>
        <div class="builder-actions">
          <button class="primary-button" type="submit">Save New Login</button>
        </div>
      </form>
    </section>
  `;

  document.getElementById("reset-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    const response = await fetch("/api/reset-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token,
        username: String(formData.get("username") || ""),
        password: String(formData.get("password") || "")
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      setToast(payload.error || "Reset failed.", "danger");
      return;
    }

    localStorage.removeItem(AUTH_TOKEN_KEY);
    await refreshAuthStatus();
    setToast("Login reset. Sign in with your new info.");
    setRoute("dashboard");
  });
}

function builderQuestionHtml(formId, question, index) {
  const optionsHtml = (question.options || []).map((option, optionIndex) => `
    <div class="choice-row">
      <input class="text-input" data-option-input="${formId}:${question.id}:${optionIndex}" value="${escapeHtml(option)}">
      <button class="ghost-button" data-remove-option="${formId}:${question.id}:${optionIndex}">Remove</button>
    </div>
  `).join("");
  const branchConfigHtml = (question.branches || []).map((branch, branchIndex) => `
    <div class="branchfill-config-card">
      <div class="branchfill-config-head">Branch ${branchIndex + 1}</div>
      <div class="field-group">
        <label>Match Value</label>
        <input
          class="text-input"
          data-branch-match="${formId}:${question.id}:${branchIndex}"
          value="${escapeHtml(branch.match || "")}"
          placeholder="Option ${branchIndex + 1}"
        >
      </div>
      <div class="field-group">
        <label>Follow-Up Questions</label>
        <textarea
          class="text-area branchfill-prompts-area"
          data-branch-prompts="${formId}:${question.id}:${branchIndex}"
          placeholder="One follow-up question per line"
        >${escapeHtml((branch.prompts || []).join("\n"))}</textarea>
      </div>
    </div>
  `).join("");

  return `
    <article class="question-card">
      <div class="question-toolbar">
        <div>
          <div class="question-type">Question ${index + 1}</div>
          <strong>${escapeHtml(question.label)}</strong>
        </div>
        <div class="question-meta">
          <button class="ghost-button" data-duplicate-question="${formId}:${question.id}">Duplicate</button>
          <button class="danger-button" data-remove-question="${formId}:${question.id}">Delete</button>
        </div>
      </div>

      <div class="field-group">
        <label>Question Text</label>
        <input class="text-input" data-question-label="${formId}:${question.id}" value="${escapeHtml(question.label)}">
      </div>

      ${question.type === "text" ? `
        <div class="field-group">
          <label>Text Content</label>
          <textarea class="text-area" data-question-content="${formId}:${question.id}" placeholder="Put text here for the user to read">${escapeHtml(question.content || "")}</textarea>
        </div>
      ` : ""}

      ${question.type === "note" ? `
        <div class="field-group">
          <label>Note Text</label>
          <textarea class="text-area" data-question-content="${formId}:${question.id}" placeholder="Write the note that should go into the PDF">${escapeHtml(question.content || "")}</textarea>
        </div>
        <div class="field-group">
          <label>Reference Code</label>
          <input class="text-input" data-question-reference-code="${formId}:${question.id}" value="${escapeHtml(question.referenceCode || "")}" placeholder="REF-001">
        </div>
      ` : ""}

      ${question.type === "graph" ? `
        <div class="field-group">
          <label>Graph Caption</label>
          <textarea class="text-area" data-question-content="${formId}:${question.id}" placeholder="Explain what this graph is showing">${escapeHtml(question.content || "")}</textarea>
        </div>
        <div class="field-group">
          <label>Graph Data</label>
          ${(question.graphPoints || []).map((point, pointIndex) => `
            <div class="graph-row">
              <input class="text-input" data-graph-label="${formId}:${question.id}:${pointIndex}" value="${escapeHtml(point.label)}" placeholder="Label">
              <input class="text-input" type="number" data-graph-value="${formId}:${question.id}:${pointIndex}" value="${escapeHtml(point.value)}" placeholder="Value">
              <button class="ghost-button" data-remove-graph-point="${formId}:${question.id}:${pointIndex}">Remove</button>
            </div>
          `).join("")}
          <button class="secondary-button" data-add-graph-point="${formId}:${question.id}">Add Bar</button>
        </div>
      ` : ""}

      ${(question.type === "image" || question.type === "gif") ? `
        <div class="field-group">
          <label>Preview</label>
          <div class="media-builder-card">
            ${question.content ? `<img class="media-block-image" src="${escapeHtml(question.content)}" alt="${escapeHtml(question.label)}">` : `<div class="empty-inline">No ${question.type === "gif" ? "GIF" : "image"} selected yet.</div>`}
          </div>
        </div>
        <div class="field-group">
          <label>Upload ${question.type === "gif" ? "GIF" : "Image"}</label>
          <input class="text-input" type="file" accept="image/*" data-media-upload="${formId}:${question.id}">
        </div>
        <div class="field-group">
          <label>${question.type === "gif" ? "GIF URL" : "Image URL"}</label>
          <input class="text-input" data-question-content="${formId}:${question.id}" value="${escapeHtml(mediaContentInputValue(question.content))}" placeholder="https://example.com/media.${question.type === "gif" ? "gif" : "png"}">
          ${isEmbeddedMediaContent(question.content) ? `<div class="media-inline-note">An uploaded file is saved for this block. Paste a URL here only if you want to replace it.</div>` : ""}
        </div>
        <div class="field-group">
          <label>Caption</label>
          <input class="text-input" data-question-placeholder="${formId}:${question.id}" value="${escapeHtml(question.placeholder || "")}" placeholder="Optional caption">
        </div>
      ` : ""}

      ${question.type === "drawing" ? `
        <div class="field-group">
          <label>Drawing Instructions</label>
          <input class="text-input" data-question-placeholder="${formId}:${question.id}" value="${escapeHtml(question.placeholder || "")}" placeholder="Draw your answer in the box.">
        </div>
      ` : ""}

      ${question.type === "code" ? `
        <div class="field-group">
          <label>Code Placeholder</label>
          <input class="text-input" data-question-placeholder="${formId}:${question.id}" value="${escapeHtml(question.placeholder || "")}" placeholder="// Type your code here">
        </div>
      ` : ""}

      ${question.type === "animation" ? `
        <div class="field-group">
          <label>Animation Instructions</label>
          <input class="text-input" data-question-placeholder="${formId}:${question.id}" value="${escapeHtml(question.placeholder || "")}" placeholder="Draw a simple 4-frame animation below.">
        </div>
      ` : ""}

      ${(question.type === "short" || question.type === "fillblank" || question.type === "branchfill" || question.type === "email" || question.type === "number") ? `
        <div class="field-group">
          <label>${question.type === "fillblank" ? "Blank Hint / Placeholder" : question.type === "branchfill" ? "Main Fill Placeholder" : "Placeholder"}</label>
          <input class="text-input" data-question-placeholder="${formId}:${question.id}" value="${escapeHtml(question.placeholder || "")}" placeholder="${question.type === "fillblank" ? "Type the missing word here" : question.type === "branchfill" ? "Type one of the branch matches" : "Optional placeholder"}">
        </div>
      ` : ""}

      ${question.type === "branchfill" ? `
        <div class="field-group">
          <label>Branch Paths</label>
          <div class="branchfill-config-grid">
            ${branchConfigHtml}
          </div>
          <div class="builder-inline-note">The user types one main answer. If it matches one of these six branch values, that branch's follow-up questions appear.</div>
        </div>
      ` : ""}

      <div class="field-group">
        <label>Question Type</label>
        <select class="select-input" data-question-type="${formId}:${question.id}">
          <option value="short" ${question.type === "short" ? "selected" : ""}>Short Answer</option>
          <option value="fillblank" ${question.type === "fillblank" ? "selected" : ""}>Fill In The Blank</option>
          <option value="branchfill" ${question.type === "branchfill" ? "selected" : ""}>Branch Fill</option>
          <option value="text" ${question.type === "text" ? "selected" : ""}>Text Block</option>
          <option value="note" ${question.type === "note" ? "selected" : ""}>Note PDF</option>
          <option value="graph" ${question.type === "graph" ? "selected" : ""}>Graph Block</option>
          <option value="image" ${question.type === "image" ? "selected" : ""}>Image</option>
          <option value="gif" ${question.type === "gif" ? "selected" : ""}>GIF</option>
          <option value="drawing" ${question.type === "drawing" ? "selected" : ""}>Drawing</option>
          <option value="code" ${question.type === "code" ? "selected" : ""}>Code</option>
          <option value="animation" ${question.type === "animation" ? "selected" : ""}>Animation</option>
          <option value="long" ${question.type === "long" ? "selected" : ""}>Paragraph</option>
          <option value="multiple" ${question.type === "multiple" ? "selected" : ""}>Multiple Choice</option>
          <option value="checkbox" ${question.type === "checkbox" ? "selected" : ""}>Checkboxes</option>
          <option value="dropdown" ${question.type === "dropdown" ? "selected" : ""}>Dropdown</option>
          <option value="emoji" ${question.type === "emoji" ? "selected" : ""}>Emoji Reaction</option>
          <option value="yesno" ${question.type === "yesno" ? "selected" : ""}>Yes / No</option>
          <option value="rating" ${question.type === "rating" ? "selected" : ""}>Rating Scale</option>
          <option value="scale" ${question.type === "scale" ? "selected" : ""}>Linear Scale</option>
          <option value="date" ${question.type === "date" ? "selected" : ""}>Date</option>
          <option value="time" ${question.type === "time" ? "selected" : ""}>Time</option>
          <option value="email" ${question.type === "email" ? "selected" : ""}>Email</option>
          <option value="number" ${question.type === "number" ? "selected" : ""}>Number</option>
        </select>
      </div>

      <div class="field-group">
        <label>
          <input type="checkbox" data-question-required="${formId}:${question.id}" ${question.required ? "checked" : ""}>
          Required
        </label>
      </div>

      ${OPTION_BASED_TYPES.has(question.type) ? `
        <div class="field-group">
          <label>Choices</label>
          ${optionsHtml || '<div class="empty-inline">No choices yet.</div>'}
          <button class="secondary-button" data-add-option="${formId}:${question.id}">Add Choice</button>
        </div>
      ` : ""}

      ${question.type === "yesno" ? `
        <div class="field-group">
          <label>Style</label>
          <div class="choice-pill">Fixed options: Yes / No</div>
        </div>
      ` : ""}

      ${question.type === "rating" ? `
        <div class="field-group">
          <label>Scale</label>
          <select class="select-input" data-rating-size="${formId}:${question.id}">
            <option value="3" ${question.options.length === 3 ? "selected" : ""}>1 to 3</option>
            <option value="5" ${question.options.length === 5 ? "selected" : ""}>1 to 5</option>
            <option value="10" ${question.options.length === 10 ? "selected" : ""}>1 to 10</option>
          </select>
        </div>
      ` : ""}

      ${question.type === "scale" ? `
        <div class="field-group">
          <label>Scale Size</label>
          <select class="select-input" data-scale-size="${formId}:${question.id}">
            <option value="3" ${question.options.length === 3 ? "selected" : ""}>1 to 3</option>
            <option value="5" ${question.options.length === 5 ? "selected" : ""}>1 to 5</option>
            <option value="7" ${question.options.length === 7 ? "selected" : ""}>1 to 7</option>
            <option value="10" ${question.options.length === 10 ? "selected" : ""}>1 to 10</option>
          </select>
        </div>
        <div class="field-group">
          <label>Left Label</label>
          <input class="text-input" data-scale-left="${formId}:${question.id}" value="${escapeHtml(question.scaleLeft || "Low")}">
        </div>
        <div class="field-group">
          <label>Right Label</label>
          <input class="text-input" data-scale-right="${formId}:${question.id}" value="${escapeHtml(question.scaleRight || "High")}">
        </div>
      ` : ""}

      ${question.type === "emoji" ? `
        <div class="field-group">
          <label>Reaction Preview</label>
          <div class="emoji-preview-row">
            ${(question.options || []).map((option) => `<span class="emoji-chip">${escapeHtml(option)}</span>`).join("")}
          </div>
        </div>
      ` : ""}
    </article>
  `;
}

function renderBuilder(formId) {
  if (!state.isAdmin) {
    renderPublicLogin();
    return;
  }

  const form = formById(formId);
  if (!form) {
    setRoute("dashboard");
    return;
  }

  pageTitle.textContent = form.title;
  routeBadge.textContent = "Builder";
  renderTopbarActionsWithHome(`
    <button class="secondary-button" data-open-fill="${form.id}">Preview Form</button>
    <button class="ghost-button" data-open-responses="${form.id}">Responses</button>
    <button class="primary-button" data-copy-link="${form.id}">Copy Share Link</button>
    <button class="ghost-button" data-action="logout-admin">Logout</button>
  `);

  pageContent.innerHTML = `
    ${renderToast()}
    <section class="builder-grid">
      <div class="card">
        <h3 class="section-title">Form Settings</h3>
        <div class="field-group">
          <label>Title</label>
          <input id="form-title-input" class="text-input" value="${escapeHtml(form.title)}">
        </div>
        <div class="field-group">
          <label>Description</label>
          <textarea id="form-description-input" class="text-area">${escapeHtml(form.description)}</textarea>
        </div>
        <div class="field-group">
          <label>Max Total Submissions</label>
          <input id="form-max-responses-input" class="text-input" type="number" min="0" value="${Number(form.maxResponses) || 0}">
        </div>
        <div class="field-group">
          <label>Max Accepted Submissions</label>
          <input id="form-max-accepted-input" class="text-input" type="number" min="0" value="${Number(form.maxAcceptedResponses) || 0}">
        </div>
        <div class="builder-actions">
          <button class="primary-button" data-save-form="${form.id}">Save Form</button>
          <button class="secondary-button" data-add-question="${form.id}">Add Question</button>
          <button class="danger-button" data-delete-form="${form.id}">Delete Form</button>
        </div>
      </div>

      <div class="card">
        <h3 class="section-title">Share</h3>
        <p class="section-copy">Use this link to open the fillable version of your form.</p>
        <div class="share-box">
          <input id="share-link-input" class="text-input" readonly value="${window.location.origin}${window.location.pathname}#form/${form.id}">
          <button class="primary-button" data-copy-link="${form.id}">Copy</button>
        </div>
        <p class="section-copy">Questions: ${form.questions.length}<br>Responses: ${form.responses.length}<br>Accepted: ${approvedResponseCount(form)}<br>Updated: ${formatDate(form.updatedAt)}</p>
        <div class="builder-actions">
          <button class="secondary-button" data-import-pdf="${form.id}">Import PDF</button>
          <button class="secondary-button" data-import-text="${form.id}">Import Text</button>
        </div>
        <details class="pdf-guide">
          <summary>PDF Import Info</summary>
          <div class="pdf-guide-copy">
            <p><strong>Strict rules:</strong></p>
            <p>1. Every marker must start at the beginning of its own line.</p>
            <p>2. Use one marker per block. Do not put normal text before the marker on the same line.</p>
            <p>3. Normal parentheses inside sentences are ignored unless the whole line starts with a marker.</p>
            <p>4. Use <code>|</code> to split parts inside one marker block.</p>
            <p>5. Use <code>required</code> inside the marker name only, like <code>(*short answer required*)</code>.</p>
            <p>6. For best results, use the <code>(*marker*)</code> format exactly. Plain <code>(marker)</code> also works, but the starred format is safer.</p>
            <p>7. For branch fill, each branch must use <code>Match =&gt; Question 1 ;; Question 2</code>.</p>
            <p>You can either upload a PDF or paste plain text with the same markers using <code>Import Text</code>.</p>
            <p><strong>Good format:</strong></p>
            <p><code>(*short answer required*) What is your username? | Optional hint</code></p>
            <p><strong>Bad format:</strong></p>
            <p><code>Some intro text (*short answer*) What is your username?</code></p>
            <p><strong>Examples:</strong></p>
            <p><code>(*form title*) My Server Event Form</code></p>
            <p><code>(*form description*) Read this form and answer everything before Friday.</code></p>
            <p><code>(*form style*) windows_xp_pdf</code> or <code>(*form style*) windows_98_pdf</code> or <code>(*form style*) wizard_exe_setup</code> or <code>(*form style*) windows_wizard_setup</code> or <code>(*form style*) wii_u_menu</code> or <code>(*form style*) default</code></p>
            <p><code>(*form max submissions*) 25</code></p>
            <p><code>(*form max accepted*) 10</code></p>
            <p><code>(*max total submissions*) 25</code></p>
            <p><code>(*max accepted submissions*) 10</code></p>
            <p><code>(*text*) Read this before answering.</code></p>
            <p><code>(*note*) Staff Note | REF-001 | This PDF note explains the next step.</code></p>
            <p><code>(*image*) Banner | https://example.com/banner.png | Optional caption</code></p>
            <p><code>(*gif*) Loading Animation | https://example.com/loading.gif | Optional caption</code></p>
            <p><code>(*drawing*) Draw your server logo | Use the box below to sketch it.</code></p>
            <p><code>(*code*) Write a hello world program | // Type your code here</code></p>
            <p><code>(*animation*) Make a bouncing ball | Draw a simple 4-frame animation below.</code></p>
            <p><code>(*short answer*) What is your username? | Optional hint</code></p>
            <p><code>(*short answer required*) What is your username? | Optional hint</code></p>
            <p><code>(*fill in the blank*) The capital of France is _____. | Type the missing word</code></p>
            <p><code>(*branch fill*) Pick your path | Type one of the branch names | Gaming =&gt; What games do you play? ;; What is your rank? | Art =&gt; What do you draw? ;; How long have you drawn? | Music =&gt; What do you make? | Code =&gt; What languages do you know? | Testing =&gt; How do you test? | Other =&gt; Explain</code></p>
            <p><code>(*paragraph*) Tell us about yourself.</code></p>
            <p><code>(*multiple choice*) Pick one color | Red | Blue | Green</code></p>
            <p><code>(*multiple choice required*) Pick one color | Red | Blue | Green</code></p>
            <p><code>(*check off*) Pick all snacks | Chips | Cookies | Fruit</code></p>
            <p><code>(*dropdown*) Choose a role | Member | Mod | Admin</code></p>
            <p><code>(*emoji reaction*) React to this update | 🔥 | 👍 | 🎉 | 💯</code></p>
            <p><code>(*yes no*) Do you agree?</code></p>
            <p><code>(*rating scale*) Rate this event | 5</code></p>
            <p><code>(*linear scale*) How hard was it? | Easy | Hard | 7</code></p>
            <p><code>(*date*) Pick a day</code></p>
            <p><code>(*time*) Pick a time</code></p>
            <p><code>(*email*) Enter your email | name@example.com</code></p>
            <p><code>(*number*) How many tickets? | 0</code></p>
            <p><code>(*graph*) Sales chart | Monthly sales | Jan=4 | Feb=9 | Mar=6</code></p>
            <p>Supported markers also include <code>(*branch fill*)</code> or <code>(*branching fill*)</code> for six-way fill-in branching.</p>
          </div>
        </details>
        <div class="field-group">
          <label>Form Style</label>
          <select id="form-style-input" class="select-input">
            <option value="default" ${form.style === "default" ? "selected" : ""}>Default</option>
            <option value="windows_xp_pdf" ${form.style === "windows_xp_pdf" ? "selected" : ""}>Windows XP PDF</option>
            <option value="windows_98_pdf" ${form.style === "windows_98_pdf" ? "selected" : ""}>Windows 98 PDF</option>
            <option value="wizard_exe_setup" ${form.style === "wizard_exe_setup" ? "selected" : ""}>Wizard EXE Setup</option>
            <option value="windows_wizard_setup" ${form.style === "windows_wizard_setup" ? "selected" : ""}>Windows Wizard Setup</option>
            <option value="wii_u_menu" ${form.style === "wii_u_menu" ? "selected" : ""}>Wii U Menu</option>
          </select>
        </div>
      </div>
    </section>

    <section class="card">
      <h3 class="section-title">Questions</h3>
      <div class="questions-stack">
        ${form.questions.length ? form.questions.map((question, index) => builderQuestionHtml(form.id, question, index)).join("") : '<div class="empty-inline">This form has no questions yet.</div>'}
      </div>
      <div class="builder-actions">
        <button class="primary-button" data-add-question="${form.id}">Add Another Question</button>
      </div>
    </section>
  `;
  initializeAnimationResponsePreviews();
}

function responseAnswerValue(answer, question = null) {
  if (typeof answer === "string" && answer.startsWith("data:image/")) {
    return `<img class="answer-image" src="${answer}" alt="Submitted drawing">`;
  }
  if ((question?.type === "image" || question?.type === "gif")) {
    return `
      <div class="media-block">
        ${question.content ? `<img class="media-block-image" src="${escapeHtml(question.content)}" alt="${escapeHtml(question.label)}">` : `<div class="empty-inline">No media URL</div>`}
        ${question.placeholder ? `<div class="media-block-caption">${escapeHtml(question.placeholder)}</div>` : ""}
      </div>
    `;
  }
  if ((question?.type === "animation") && typeof answer === "string" && answer) {
    let frames = [];
    try {
      frames = JSON.parse(answer);
    } catch (_error) {
      frames = [];
    }
    const validFrames = frames.filter((frame) => typeof frame === "string" && frame);
    if (!validFrames.length) return "No answer";
    return `
      <div class="animation-response-player" data-animation-preview="${escapeHtml(answer)}">
        <img class="animation-response-screen" src="${validFrames[0]}" alt="Animation preview">
        <div class="animation-response-strip">
          ${validFrames.map((frame, index) => `<img class="animation-thumb" src="${frame}" alt="Animation frame ${index + 1}">`).join("")}
        </div>
      </div>
    `;
  }
  if ((question?.type === "code") && typeof answer === "string" && answer) {
    return `<pre class="code-response"><code>${highlightedCodeHtml(answer)}</code></pre>`;
  }
  if ((question?.type === "branchfill") && answer && typeof answer === "object") {
    const branch = typeof answer.branchIndex === "number" ? question.branches?.[answer.branchIndex] : null;
    const followUps = branch?.prompts || [];
    return `
      <div class="branchfill-answer">
        <div><strong>Main Answer:</strong> ${escapeHtml(answer.value || "No answer")}</div>
        ${branch ? `<div><strong>Matched Branch:</strong> ${escapeHtml(branch.match || `Branch ${answer.branchIndex + 1}`)}</div>` : ""}
        ${followUps.length ? `
          <div class="branchfill-answer-list">
            ${followUps.map((prompt, index) => `
              <div class="branchfill-answer-item">
                <div class="branchfill-answer-prompt">${escapeHtml(prompt)}</div>
                <div>${escapeHtml(answer.followUps?.[index] || "No answer")}</div>
              </div>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  }
  if (Array.isArray(answer)) {
    return answer.length ? answer.map((item) => `<span class="choice-pill">${escapeHtml(item)}</span>`).join("") : "<em>No answer</em>";
  }
  return escapeHtml(answer || "No answer");
}

function questionShowsResponseValue(question) {
  return !["text", "note", "graph", "image", "gif"].includes(question?.type);
}

function wrapPdfText(text, maxChars = 88) {
  const sourceLines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const wrapped = [];

  for (const sourceLine of sourceLines) {
    const trimmed = sourceLine.trim();
    if (!trimmed) {
      wrapped.push("");
      continue;
    }
    const words = trimmed.split(/\s+/);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > maxChars && line) {
        wrapped.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    wrapped.push(line);
  }

  return wrapped;
}

function pdfHexString(value) {
  const bytes = [0xfe, 0xff];
  for (const char of String(value || "")) {
    const code = char.charCodeAt(0);
    bytes.push((code >> 8) & 0xff, code & 0xff);
  }
  return `<${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function buildSimplePdfBlob({ title, referenceCode, content }) {
  const titleLines = wrapPdfText(title || "Note PDF", 52);
  const bodyLines = [
    ...(referenceCode ? wrapPdfText(`Reference Code: ${referenceCode}`, 78) : ["Reference Code: Not set"]),
    "",
    ...wrapPdfText(content || "No note text was added.", 92)
  ];

  const operations = [
    "BT",
    "/F1 18 Tf",
    "50 790 Td",
    "24 TL"
  ];

  for (const line of titleLines) {
    operations.push(`${pdfHexString(line)} Tj`);
    operations.push("T*");
  }

  operations.push("ET");
  operations.push("BT");
  operations.push("/F1 11 Tf");
  operations.push("50 740 Td");
  operations.push("16 TL");

  for (const line of bodyLines) {
    operations.push(`${pdfHexString(line)} Tj`);
    operations.push("T*");
  }

  operations.push("ET");

  const stream = operations.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([new TextEncoder().encode(pdf)], { type: "application/pdf" });
}

function sanitizeFilenamePart(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}

function downloadNotePdf(question) {
  const blob = buildSimplePdfBlob({
    title: question?.label || "Note PDF",
    referenceCode: question?.referenceCode || "",
    content: question?.content || ""
  });
  const filename = `${sanitizeFilenamePart(question?.label, "note")}-${sanitizeFilenamePart(question?.referenceCode, "ref")}.pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reviewRouteValue(formId, responseId) {
  return `${formId}:${responseId}`;
}

function parseReviewRouteValue(value) {
  const [formId = "", responseId = ""] = value.split(":");
  return { formId, responseId };
}

function actionRouteValue(formId, responseId) {
  return `${formId}:${responseId}`;
}

function parseActionRouteValue(value) {
  const [formId = "", responseId = ""] = value.split(":");
  return { formId, responseId };
}

function collectAnswers(form) {
  const answers = {};

  for (const question of form.questions) {
    if (question.type === "text" || question.type === "note" || question.type === "graph" || question.type === "image" || question.type === "gif") continue;

    if (question.type === "drawing") {
      answers[question.id] = document.querySelector(`[data-drawing-output="${question.id}"]`)?.value || "";
      continue;
    }
    if (question.type === "animation") {
      answers[question.id] = document.querySelector(`[data-animation-output="${question.id}"]`)?.value || "[]";
      continue;
    }

    if (question.type === "checkbox") {
      answers[question.id] = [...document.querySelectorAll(`input[name="${question.id}"]:checked`)].map((input) => input.value);
      continue;
    }

    if (question.type === "branchfill") {
      const mainValue = document.querySelector(`[data-branchfill-input="${question.id}"]`)?.value?.trim() || "";
      const matchedIndex = (question.branches || []).findIndex((branch) => (branch.match || "").trim().toLowerCase() === mainValue.toLowerCase());
      const followUps = {};
      if (matchedIndex >= 0) {
        document.querySelectorAll(`[data-branchfill-followup^="${question.id}:${matchedIndex}:"]`).forEach((input) => {
          const [_questionId, _branchIndex, promptIndex] = (input.dataset.branchfillFollowup || "").split(":");
          followUps[promptIndex] = input.value.trim();
        });
      }
      answers[question.id] = {
        value: mainValue,
        branchIndex: matchedIndex,
        followUps
      };
      continue;
    }

    const fields = document.querySelectorAll(`[name="${question.id}"]`);
    if (question.type === "multiple" || question.type === "yesno" || question.type === "rating" || question.type === "emoji" || question.type === "scale") {
      answers[question.id] = [...fields].find((field) => field.checked)?.value || "";
      continue;
    }
    if (question.type === "code") {
      answers[question.id] = fields[0]?.value || "";
      continue;
    }

    answers[question.id] = fields[0]?.value?.trim() || "";
  }

  return answers;
}

function findMissingRequiredQuestion(form, answers = collectAnswers(form)) {
  for (const question of form.questions) {
    if (!question.required || question.type === "text" || question.type === "note" || question.type === "graph" || question.type === "image" || question.type === "gif") continue;
    const value = answers[question.id];
    if (question.type === "checkbox" && (!Array.isArray(value) || value.length === 0)) return question.label;
    if (question.type === "drawing" && !value) return question.label;
    if (question.type === "animation") {
      try {
        const frames = JSON.parse(value || "[]");
        if (!Array.isArray(frames) || !frames.some(Boolean)) return question.label;
      } catch (_error) {
        return question.label;
      }
      continue;
    }
    if (question.type === "branchfill") {
      if (!value || typeof value !== "object") return question.label;
      if (!value.value) return question.label;
      if (value.branchIndex >= 0) {
        const branch = question.branches?.[value.branchIndex];
        const prompts = branch?.prompts || [];
        for (let index = 0; index < prompts.length; index += 1) {
          if (!(value.followUps?.[index] || "").trim()) return `${question.label} - ${prompts[index]}`;
        }
      }
      continue;
    }
    if (question.type !== "checkbox" && !value) return question.label;
  }
  return "";
}

function renderResponses(formId) {
  if (!state.isAdmin) {
    renderPublicLogin();
    return;
  }

  const form = formById(formId);
  if (!form) {
    setRoute("dashboard");
    return;
  }

  pageTitle.textContent = `${form.title} Responses`;
  routeBadge.textContent = "Responses";
  renderTopbarActionsWithHome(`
    <button class="ghost-button" data-open-builder="${form.id}">Back To Builder</button>
    <button class="secondary-button" data-open-fill="${form.id}">Open Form</button>
    <button class="ghost-button" data-action="logout-admin">Logout</button>
  `);

  const responsesHtml = form.responses.map((response, index) => `
    <article class="response-card">
      <div class="question-toolbar">
        <div>
          <div class="question-type">Response ${form.responses.length - index}</div>
          <strong>${escapeHtml(form.title)}</strong>
        </div>
      </div>
      <div class="response-meta">Submitted ${formatDate(response.createdAt)}</div>
      <div class="response-meta">Source: ${escapeHtml(response.meta?.platformLabel || "Unknown")} • Username: ${escapeHtml(response.meta?.username || "Unknown")} • Status: ${escapeHtml(response.meta?.status || "pending")}</div>
      ${form.questions.filter(questionShowsResponseValue).map((question) => `
        <div class="answer-block">
          <div class="answer-label">${escapeHtml(question.label)}</div>
          <div class="answer-value">${responseAnswerValue(response.answers[question.id], question)}</div>
        </div>
      `).join("")}
    </article>
  `).join("");

  pageContent.innerHTML = `
    ${renderToast()}
    <section class="stats-row">
      <div class="stat-card">
        <div class="stat-label">Responses</div>
        <div class="stat-value">${form.responses.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Questions</div>
        <div class="stat-value">${form.questions.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Latest Update</div>
        <div class="stat-value" style="font-size:16px">${formatDate(form.updatedAt)}</div>
      </div>
    </section>
    <section class="responses-grid">
      <div class="card">
        <h3 class="section-title">Incoming Answers</h3>
        <div class="responses-stack">
          ${responsesHtml || '<div class="empty-inline">No responses yet.</div>'}
        </div>
      </div>
      <div class="card">
        <h3 class="section-title">Summary</h3>
        <p class="section-copy">Use this local view to inspect answers. When you move this into a real website later, we can replace local storage with a real backend and user accounts.</p>
      </div>
    </section>
  `;
}

function fillInputHtml(question) {
  if (question.type === "text") {
    return `<div class="text-block-read">${escapeHtml(question.content || "")}</div>`;
  }
  if (question.type === "note") {
    return `
      <div class="note-pdf-block">
        <div class="note-pdf-topline">
          <span class="note-pdf-badge">Note PDF</span>
          <span class="note-pdf-reference">${escapeHtml(question.referenceCode || "No reference code")}</span>
        </div>
        <div class="note-pdf-body">${escapeHtml(question.content || "No note text added yet.")}</div>
        <button class="secondary-button" type="button" data-download-note-pdf="${question.id}">Download PDF</button>
      </div>
    `;
  }
  if (question.type === "image" || question.type === "gif") {
    return `
      <div class="media-block">
        ${question.content ? `<img class="media-block-image" src="${escapeHtml(question.content)}" alt="${escapeHtml(question.label)}">` : `<div class="empty-inline">Add a ${question.type === "gif" ? "GIF" : "image"} URL in the builder.</div>`}
        ${question.placeholder ? `<div class="media-block-caption">${escapeHtml(question.placeholder)}</div>` : ""}
      </div>
    `;
  }
  if (question.type === "graph") {
    const maxValue = Math.max(...(question.graphPoints || []).map((point) => Number(point.value) || 0), 1);
    return `
      <div class="graph-block">
        ${question.content ? `<div class="graph-caption">${escapeHtml(question.content)}</div>` : ""}
        <div class="graph-bars">
          ${(question.graphPoints || []).map((point) => `
            <div class="graph-bar-card">
              <div class="graph-bar-label">${escapeHtml(point.label)}</div>
              <div class="graph-bar-track">
                <div class="graph-bar-fill" style="height:${Math.max(8, (Number(point.value) || 0) / maxValue * 140)}px"></div>
              </div>
              <div class="graph-bar-value">${escapeHtml(point.value)}</div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }
  if (question.type === "drawing") {
    return `
      <div class="drawing-input-wrap">
        ${question.placeholder ? `<div class="drawing-help">${escapeHtml(question.placeholder)}</div>` : ""}
        <canvas
          class="drawing-canvas"
          width="720"
          height="360"
          data-drawing-canvas="${question.id}"
          aria-label="${escapeHtml(question.label)}"
        ></canvas>
        <input type="hidden" name="${question.id}" data-drawing-output="${question.id}" ${question.required ? "required" : ""}>
        <div class="drawing-actions">
          <button class="ghost-button" type="button" data-clear-drawing="${question.id}">Clear Drawing</button>
        </div>
      </div>
    `;
  }
  if (question.type === "code") {
    return `
      <div class="code-input-wrap">
        <div class="code-editor-shell">
          <div class="code-editor-bar">
            <span class="code-editor-dot code-editor-dot-red"></span>
            <span class="code-editor-dot code-editor-dot-yellow"></span>
            <span class="code-editor-dot code-editor-dot-green"></span>
            <span class="code-editor-title">Code</span>
          </div>
          <div class="code-editor-stage">
            <div class="code-editor-lines" aria-hidden="true" data-code-lines="${question.id}">${codeLineNumbersHtml(question.placeholder || "")}</div>
            <pre class="code-editor-highlight" aria-hidden="true" data-code-highlight="${question.id}">${highlightedCodeHtml(question.placeholder || "")}</pre>
            <textarea class="code-editor-textarea" name="${question.id}" data-code-input="${question.id}" placeholder="${escapeHtml(question.placeholder || "// Type your code here")}" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" ${question.required ? "required" : ""}></textarea>
          </div>
        </div>
      </div>
    `;
  }
  if (question.type === "animation") {
    return `
      <div class="animation-input-wrap">
        ${question.placeholder ? `<div class="drawing-help">${escapeHtml(question.placeholder)}</div>` : ""}
        <div class="animation-studio" data-animation-studio="${question.id}">
          <div class="animation-stage-card">
            <div class="animation-stage-topbar">
              <div class="animation-stage-badge">Animation Studio</div>
              <div class="animation-stage-meta">Inspired by a timeline editor</div>
            </div>
            <div class="animation-stage-stack">
              <div class="animation-stage-checker" aria-hidden="true"></div>
              <img class="animation-onion-skin" data-animation-onion="${question.id}" alt="">
              <canvas
                class="drawing-canvas animation-stage-canvas"
                width="720"
                height="420"
                data-animation-stage="${question.id}"
                aria-label="${escapeHtml(question.label)} animation stage"
              ></canvas>
            </div>
            <input type="hidden" name="${question.id}" data-animation-output="${question.id}">
            <div class="animation-onion-controls">
              <button class="secondary-button" type="button" data-animation-onion-toggle="${question.id}">Show Last Frame</button>
              <label class="animation-opacity-control">
                <span>Last Frame Transparency</span>
                <input type="range" min="5" max="90" value="45" data-animation-opacity="${question.id}">
              </label>
            </div>
            <div class="animation-toolbar">
              <button class="ghost-button" type="button" data-animation-prev="${question.id}">Prev Frame</button>
              <button class="ghost-button" type="button" data-animation-next="${question.id}">Next Frame</button>
              <button class="ghost-button" type="button" data-animation-duplicate="${question.id}">Duplicate Frame</button>
              <button class="ghost-button" type="button" data-animation-clear="${question.id}">Clear Frame</button>
              <button class="primary-button" type="button" data-animation-play="${question.id}">Play</button>
            </div>
          </div>
          <div class="animation-timeline">
            ${Array.from({ length: ANIMATION_FRAME_COUNT }, (_item, index) => `
              <button class="animation-timeline-frame${index === 0 ? " active" : ""}" type="button" data-animation-select="${question.id}:${index}">
                <div class="animation-timeline-number">Frame ${index + 1}</div>
                <img class="animation-timeline-thumb" data-animation-thumb="${question.id}:${index}" alt="Frame ${index + 1} thumbnail">
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }
  if (question.type === "short") {
    return `<input class="text-input" name="${question.id}" placeholder="${escapeHtml(question.placeholder || "")}" ${question.required ? "required" : ""}>`;
  }
  if (question.type === "fillblank") {
    return `
      <div class="fillblank-wrap">
        <div class="fillblank-prompt">${escapeHtml(question.label)}</div>
        <input class="text-input fillblank-input" name="${question.id}" placeholder="${escapeHtml(question.placeholder || "Type your answer")}" ${question.required ? "required" : ""}>
      </div>
    `;
  }
  if (question.type === "branchfill") {
    const branchOptions = (question.branches || []).map((branch) => branch.match).filter(Boolean);
    return `
      <div class="branchfill-wrap" data-branchfill="${question.id}">
        <div class="fillblank-prompt">${escapeHtml(question.label)}</div>
        <input
          class="text-input fillblank-input"
          name="${question.id}"
          data-branchfill-input="${question.id}"
          list="branchfill-list-${question.id}"
          placeholder="${escapeHtml(question.placeholder || "Type one of the branch matches")}"
          ${question.required ? "required" : ""}
        >
        <datalist id="branchfill-list-${question.id}">
          ${branchOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`).join("")}
        </datalist>
        <div class="branchfill-helper">Available matches: ${branchOptions.map((option) => `<span class="choice-pill">${escapeHtml(option)}</span>`).join("") || "<span class=\"empty-inline\">No branch values yet.</span>"}</div>
        <div class="branchfill-panels">
          ${(question.branches || []).map((branch, branchIndex) => `
            <div class="branchfill-panel" data-branchfill-panel="${question.id}:${branchIndex}">
              <div class="branchfill-panel-title">${escapeHtml(branch.match || `Branch ${branchIndex + 1}`)}</div>
              ${(branch.prompts || []).length ? (branch.prompts || []).map((prompt, promptIndex) => `
                <label class="branchfill-followup">
                  <span>${escapeHtml(prompt)}</span>
                  <input class="text-input" type="text" data-branchfill-followup="${question.id}:${branchIndex}:${promptIndex}" placeholder="Type your answer">
                </label>
              `).join("") : `<div class="empty-inline">No follow-up questions configured for this branch.</div>`}
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }
  if (question.type === "long") {
    return `<textarea class="text-area" name="${question.id}" ${question.required ? "required" : ""}></textarea>`;
  }
  if (question.type === "email") {
    return `<input class="text-input" type="email" name="${question.id}" placeholder="${escapeHtml(question.placeholder || "name@example.com")}" ${question.required ? "required" : ""}>`;
  }
  if (question.type === "number") {
    return `<input class="text-input" type="number" name="${question.id}" placeholder="${escapeHtml(question.placeholder || "")}" ${question.required ? "required" : ""}>`;
  }
  if (question.type === "date") {
    return `<input class="text-input" type="date" name="${question.id}" ${question.required ? "required" : ""}>`;
  }
  if (question.type === "time") {
    return `<input class="text-input" type="time" name="${question.id}" ${question.required ? "required" : ""}>`;
  }
  if (question.type === "multiple") {
    return (question.options || []).map((option, index) => `
      <label class="choice-pill">
        <input type="radio" name="${question.id}" value="${escapeHtml(option)}" ${question.required && index === 0 ? "required" : ""}>
        ${escapeHtml(option)}
      </label>
    `).join("");
  }
  if (question.type === "checkbox") {
    return (question.options || []).map((option) => `
      <label class="choice-pill">
        <input type="checkbox" name="${question.id}" value="${escapeHtml(option)}">
        ${escapeHtml(option)}
      </label>
    `).join("");
  }
  if (question.type === "dropdown") {
    return `
      <select class="select-input" name="${question.id}" ${question.required ? "required" : ""}>
        <option value="">Select one</option>
        ${(question.options || []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}
      </select>
    `;
  }
  if (question.type === "emoji") {
    return `
      <div class="emoji-react-row">
        ${(question.options || []).map((option, index) => `
          <label class="emoji-react-pill">
            <input type="radio" name="${question.id}" value="${escapeHtml(option)}" ${question.required && index === 0 ? "required" : ""}>
            <span class="emoji-react-icon">${escapeHtml(option)}</span>
          </label>
        `).join("")}
      </div>
    `;
  }
  if (question.type === "yesno") {
    return ["Yes", "No"].map((option, index) => `
      <label class="choice-pill">
        <input type="radio" name="${question.id}" value="${option}" ${question.required && index === 0 ? "required" : ""}>
        ${option}
      </label>
    `).join("");
  }
  if (question.type === "rating") {
    return `
      <div class="rating-row">
        ${(question.options || []).map((option, index) => `
          <label class="rating-pill">
            <input type="radio" name="${question.id}" value="${escapeHtml(option)}" ${question.required && index === 0 ? "required" : ""}>
            <span>${escapeHtml(option)}</span>
          </label>
        `).join("")}
      </div>
    `;
  }
  if (question.type === "scale") {
    return `
      <div class="scale-wrap">
        <div class="scale-labels">
          <span>${escapeHtml(question.scaleLeft || "Low")}</span>
          <span>${escapeHtml(question.scaleRight || "High")}</span>
        </div>
        <div class="rating-row">
          ${(question.options || []).map((option, index) => `
            <label class="rating-pill">
              <input type="radio" name="${question.id}" value="${escapeHtml(option)}" ${question.required && index === 0 ? "required" : ""}>
              <span>${escapeHtml(option)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }
  return "";
}

function renderFill(formId) {
  const form = formById(formId);
  if (!form) {
    pageTitle.textContent = "Form Not Found";
    routeBadge.textContent = "Missing";
    renderTopbarActions(`<button class="ghost-button" data-go-dashboard="1">Dashboard</button>`);
    pageContent.innerHTML = `<div class="card">That form does not exist in this browser yet.</div>`;
    return;
  }

  pageTitle.textContent = form.title;
  routeBadge.textContent = "Fill Form";
  renderTopbarActions("");
  const closedReason = formClosedReason(form);

  pageContent.innerHTML = `
    ${renderToast()}
    <section class="card fill-header">
      <h3 class="fill-title">${escapeHtml(form.title)}</h3>
      <p class="fill-description">${escapeHtml(form.description)}</p>
    </section>
    <section class="card">
      <h3 class="section-title">Discord Login</h3>
      <p class="section-copy">Discord sign-in only fills in your Discord username and avatar for this form. Builder access still uses the admin login.</p>
      ${state.discordUser ? `
        <div class="discord-user-row">
          <div class="discord-user-card">
            ${state.discordUser.avatarUrl ? `<img class="discord-user-avatar" src="${escapeHtml(state.discordUser.avatarUrl)}" alt="${escapeHtml(state.discordUser.username)}">` : `<div class="discord-user-avatar discord-user-fallback">DF</div>`}
            <div>
              <div><strong>${escapeHtml(state.discordUser.displayName)}</strong></div>
              <div class="section-copy">@${escapeHtml(state.discordUser.username)}</div>
            </div>
          </div>
          <button class="ghost-button" type="button" data-action="discord-logout">Logout Discord</button>
        </div>
      ` : `
        <div class="builder-actions">
          ${state.discordAuthConfigured
            ? `<a class="primary-button discord-login-button" href="/auth/discord/start?next=${encodeURIComponent(window.location.hash || `#form/${form.id}`)}">Login With Discord</a>`
            : `<button class="secondary-button" type="button" disabled>Login With Discord</button>`}
        </div>
        ${state.discordAuthConfigured ? "" : `<p class="section-copy">Discord OAuth is not configured yet. Set the Discord app client ID and secret on the server first.</p>`}
      `}
    </section>
    ${closedReason ? `
      <section class="card">
        <h3 class="section-title">Form Closed</h3>
        <p class="section-copy">${escapeHtml(closedReason)}</p>
      </section>
    ` : `
    <form id="fill-form" class="questions-stack">
      ${form.questions.map((question) => `
        <section class="question-card">
          <label class="question-label">
            ${escapeHtml(question.label)}
            ${question.required ? '<span class="required-tag">Required</span>' : ""}
          </label>
          ${fillInputHtml(question)}
        </section>
      `).join("")}
      <section class="card">
        <div class="submit-row">
          <button class="primary-button" type="submit">Submit Response</button>
        </div>
      </section>
    </form>
    `}
  `;

  if (closedReason) return;

  document.getElementById("fill-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const answers = collectAnswers(form);
    const missingRequired = findMissingRequiredQuestion(form, answers);
    if (missingRequired) {
      setToast(`Fill out required question: ${missingRequired}`, "danger");
      return;
    }
    state.pendingSubmission = { formId: form.id, answers };
    persistPendingSubmission();
    clearToast();
    setRoute("submit-meta", form.id);
  });

  initializeDrawingInputs(form);
  initializeCodeInputs(form);
  initializeAnimationInputs(form);
  initializeBranchFillInputs(form);
}

function renderSubmitMetaRoute(formId) {
  const form = formById(formId);
  const pendingSubmission = state.pendingSubmission;
  if (!form || !pendingSubmission || pendingSubmission.formId !== formId) {
    setToast("Start from the form before submitting.", "danger");
    setRoute("form", formId);
    return;
  }

  pageTitle.textContent = `${form.title} Submit`;
  routeBadge.textContent = "Submit";
  renderTopbarActions("");

  pageContent.innerHTML = `
    ${renderToast()}
    <section class="card fill-header">
      <h3 class="fill-title">${escapeHtml(form.title)}</h3>
      <p class="fill-description">${escapeHtml(form.description)}</p>
    </section>
    <section class="card">
      <div id="submit-step-1" class="submit-step">
        <h4 class="section-title">Where did you get this form?</h4>
        <div class="source-choice-row">
          ${SUBMISSION_SOURCES.map((source) => `
            <label class="source-choice">
              <input type="radio" name="submission-source" value="${source.value}">
              <span>${escapeHtml(source.label)}</span>
            </label>
          `).join("")}
        </div>
        <div id="custom-source-wrap" class="field-group" hidden>
          <label>Custom Platform</label>
          <input id="custom-source-input" class="text-input" placeholder="Put your platform here">
        </div>
        <div class="submit-row">
          <button class="primary-button" id="submit-next-button" type="button">Next</button>
        </div>
      </div>
      <div id="submit-step-2" class="submit-step" hidden>
        <h4 class="section-title" id="username-step-title">What is your username?</h4>
        <div class="field-group">
          <label id="username-input-label">Username</label>
          <div class="at-input-wrap">
            <span class="at-input-prefix">@</span>
            <input id="submit-username-input" class="text-input at-input-field" placeholder="Type your username">
          </div>
        </div>
        <div class="submit-row">
          <button class="ghost-button" id="submit-back-button" type="button">Back</button>
          <button class="primary-button" id="submit-final-button" type="button">Submit Response</button>
        </div>
      </div>
    </section>
  `;

  const submitStep1 = document.getElementById("submit-step-1");
  const submitStep2 = document.getElementById("submit-step-2");
  const customSourceWrap = document.getElementById("custom-source-wrap");
  const customSourceInput = document.getElementById("custom-source-input");
  const usernameInput = document.getElementById("submit-username-input");
  const usernameTitle = document.getElementById("username-step-title");
  const usernameLabel = document.getElementById("username-input-label");

  document.querySelectorAll('input[name="submission-source"]').forEach((input) => {
    input.addEventListener("change", () => {
      customSourceWrap.hidden = input.value !== "custom" || !input.checked;
    });
  });

  if (state.discordUser) {
    const discordSource = document.querySelector('input[name="submission-source"][value="discord"]');
    if (discordSource) discordSource.checked = true;
  }

  document.getElementById("submit-next-button").addEventListener("click", () => {
    const selectedSource = [...document.querySelectorAll('input[name="submission-source"]')].find((input) => input.checked)?.value || "";
    if (!selectedSource) {
      setToast("Pick where they got this form.", "danger");
      return;
    }

    if (selectedSource === "custom" && !customSourceInput.value.trim()) {
      setToast("Put the custom platform name.", "danger");
      return;
    }

    const platformLabel = selectedSource === "custom"
      ? customSourceInput.value.trim()
      : SUBMISSION_SOURCES.find((source) => source.value === selectedSource)?.label || selectedSource;

    usernameTitle.textContent = "What is your username?";
    usernameLabel.textContent = "Username";
    usernameInput.value = state.discordUser && selectedSource === "discord" ? state.discordUser.username || "" : "";
    submitStep1.hidden = true;
    submitStep2.hidden = false;
    usernameInput.focus();
  });

  document.getElementById("submit-back-button").addEventListener("click", () => {
    submitStep2.hidden = true;
    submitStep1.hidden = false;
  });

  document.getElementById("submit-final-button").addEventListener("click", async () => {
    const selectedSource = [...document.querySelectorAll('input[name="submission-source"]')].find((input) => input.checked)?.value || "";
    const customSource = customSourceInput.value.trim();
    const username = usernameInput.value.trim();
    const platformLabel = selectedSource === "custom"
      ? customSource
      : SUBMISSION_SOURCES.find((source) => source.value === selectedSource)?.label || "";

    if (!selectedSource) {
      setToast("Pick where they got this form.", "danger");
      return;
    }
    if (selectedSource === "custom" && !customSource) {
      setToast("Put the custom platform name.", "danger");
      return;
    }
    if (!username) {
      setToast("Put the username for that platform.", "danger");
      return;
    }

    try {
      const responseEntry = await saveResponse(form.id, pendingSubmission.answers, {
        source: selectedSource,
        customSource,
        platformLabel,
        username
      });
      await refreshSiteData();
      const webhookResponse = await fetch("/api/submit-response-notice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          form_id: form.id,
          form_title: form.title,
          response_id: responseEntry.id,
          form_link: `${window.location.origin}${window.location.pathname}#form/${form.id}`,
          review_link: `${window.location.origin}${window.location.pathname}#review/${reviewRouteValue(form.id, responseEntry.id)}`,
          actions_link: `${window.location.origin}${window.location.pathname}#actions/${actionRouteValue(form.id, responseEntry.id)}`,
          source: selectedSource,
          platform_label: platformLabel,
          username
        })
      });
      const payload = await webhookResponse.json();
      if (!webhookResponse.ok || !payload.ok) {
        throw new Error(payload.error || "Could not notify webhook.");
      }
    } catch (error) {
      setToast(error.message || "Response saved, but the webhook notice failed.", "danger");
      return;
    }

    state.pendingSubmission = null;
    persistPendingSubmission();
    clearToast();
    pageContent.innerHTML = `
      <section class="card fill-header">
        <h3 class="fill-title">Submitted</h3>
        <p class="fill-description">Your response was sent. Platform: ${escapeHtml(platformLabel)}. Username: @${escapeHtml(username)}.</p>
      </section>
    `;
  });
}

function renderReviewRoute(value) {
  if (!state.isAdmin) {
    renderPublicLogin();
    return;
  }
  const { formId, responseId } = parseReviewRouteValue(value);
  const form = formById(formId);
  const response = form?.responses.find((item) => item.id === responseId);

  if (!form || !response) {
    pageTitle.textContent = "Submission Review";
    routeBadge.textContent = "Missing";
    renderTopbarActionsWithHome("");
    pageContent.innerHTML = `<div class="card">That submission does not exist.</div>`;
    return;
  }

  pageTitle.textContent = `${form.title} Review`;
  routeBadge.textContent = "Review";
  renderTopbarActionsWithHome(`
    <button class="ghost-button" data-open-fill="${form.id}">Open Form</button>
    <button class="secondary-button" data-open-actions="${actionRouteValue(form.id, response.id)}">Actions</button>
    ${state.isAdmin ? `<button class="ghost-button" data-open-responses="${form.id}">Responses</button>` : ""}
  `);

  pageContent.innerHTML = `
    ${renderToast()}
    <section class="card">
      <h3 class="section-title">Submission Review</h3>
      <p class="section-copy">Platform: ${escapeHtml(response.meta?.platformLabel || "Unknown")}<br>Username: ${escapeHtml(response.meta?.username || "Unknown")}<br>Status: ${escapeHtml(response.meta?.status || "pending")}</p>
      <div class="share-box">
        <input class="text-input" readonly value="${window.location.origin}${window.location.pathname}#form/${form.id}">
        <button class="primary-button" data-copy-link="${form.id}">Copy Form Link</button>
      </div>
    </section>
    <section class="card">
      <h3 class="section-title">Actions</h3>
      <p class="section-copy">Open the actions page to approve or reject this submission.</p>
      <div class="builder-actions">
        <button class="primary-button" data-open-actions="${actionRouteValue(form.id, response.id)}">Open Actions Page</button>
      </div>
    </section>
    <section class="card">
      <h3 class="section-title">Answers</h3>
      <div class="responses-stack">
        ${form.questions.filter(questionShowsResponseValue).map((question) => `
          <div class="answer-block">
            <div class="answer-label">${escapeHtml(question.label)}</div>
            <div class="answer-value">${responseAnswerValue(response.answers[question.id], question)}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderActionsRoute(value) {
  if (!state.isAdmin) {
    renderPublicLogin();
    return;
  }
  const { formId, responseId } = parseActionRouteValue(value);
  const form = formById(formId);
  const response = form?.responses.find((item) => item.id === responseId);

  if (!form || !response) {
    pageTitle.textContent = "Submission Actions";
    routeBadge.textContent = "Missing";
    renderTopbarActionsWithHome("");
    pageContent.innerHTML = `<div class="card">That submission does not exist.</div>`;
    return;
  }

  pageTitle.textContent = `${form.title} Actions`;
  routeBadge.textContent = "Actions";
  renderTopbarActionsWithHome(`
    <button class="ghost-button" data-open-review="${reviewRouteValue(form.id, response.id)}">Review</button>
    <button class="ghost-button" data-open-fill="${form.id}">Open Form</button>
    ${state.isAdmin ? `<button class="ghost-button" data-open-responses="${form.id}">Responses</button>` : ""}
  `);

  pageContent.innerHTML = `
    ${renderToast()}
    <section class="card">
      <h3 class="section-title">Approve Or Reject</h3>
      <p class="section-copy">Platform: ${escapeHtml(response.meta?.platformLabel || "Unknown")}<br>Username: @${escapeHtml(response.meta?.username || "Unknown")}<br>Status: ${escapeHtml(response.meta?.status || "pending")}</p>
      <div class="builder-actions">
        <button class="primary-button" data-approve-response="${actionRouteValue(form.id, response.id)}">Approve</button>
      </div>
      <div class="field-group">
        <label>Reject Reason</label>
        <textarea id="reject-reason-input" class="text-area" placeholder="Put why you rejected it"></textarea>
      </div>
      <div class="builder-actions">
        <button class="danger-button" data-reject-response="${actionRouteValue(form.id, response.id)}">Reject</button>
      </div>
    </section>
  `;
}

function handleClick(event) {
  const target = event.target.closest("button");
  if (!target) return;
  trackActivity("button_click", {
    text: target.textContent?.trim() || "",
    route: `${route().name}/${route().value || ""}`
  });

  const [formId, questionId, optionIndex] = (target.dataset.removeOption || target.dataset.addOption || target.dataset.duplicateQuestion || target.dataset.removeQuestion || "").split(":");
  const [graphFormId, graphQuestionId, graphPointIndex] = (target.dataset.removeGraphPoint || target.dataset.addGraphPoint || "").split(":");

  if (target.dataset.action === "deploy-live") {
    deployWebsite();
    return;
  }
  if (target.dataset.action === "new-form" || target.dataset.action === "create-first-form") createForm();
  if (target.dataset.action === "logout-admin") {
    logoutAdmin().then(() => {
      setToast("Logged out.");
      setRoute("dashboard");
    });
    return;
  }
  if (target.dataset.action === "discord-logout") {
    logoutDiscordUser().then(() => {
      setToast("Discord login removed.");
      render();
    });
    return;
  }
  if (target.dataset.action === "request-reset-link") {
    const code = window.prompt("Enter the reset code:");
    if (!code) return;
    fetch("/api/send-reset-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code,
        base_url: `${window.location.origin}${window.location.pathname}`
      })
    })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.ok) {
          setToast(payload.error || "Could not send reset link.", "danger");
          return;
        }
        setToast("Reset link sent through the webhook.");
      })
      .catch(() => setToast("Could not send reset link.", "danger"));
    return;
  }
  if (target.dataset.goDashboard) {
    setRoute("dashboard");
    return;
  }
  if (target.dataset.openControl) {
    setRoute("control", target.dataset.openControl || "visitors");
    return;
  }
  if (target.dataset.openBanned) {
    setRoute("control", "banned");
    return;
  }
  if (target.dataset.refreshControl) {
    Promise.all([refreshSecurityData(), refreshDeployStatus()])
      .then(() => render())
      .catch((error) => setToast(error.message || "Could not refresh control panel.", "danger"));
    return;
  }
  if (target.dataset.openBuilder) setRoute("builder", target.dataset.openBuilder);
  if (target.dataset.openFill || target.dataset.openForm) setRoute("form", target.dataset.openFill || target.dataset.openForm);
  if (target.dataset.openReview) setRoute("review", target.dataset.openReview);
  if (target.dataset.openActions) setRoute("actions", target.dataset.openActions);
  if (target.dataset.openResponses) setRoute("responses", target.dataset.openResponses);
  if (target.dataset.approveResponse || target.dataset.rejectResponse) {
    const routeValue = target.dataset.approveResponse || target.dataset.rejectResponse;
    const { formId, responseId } = parseActionRouteValue(routeValue);
    const form = formById(formId);
    const response = form?.responses.find((item) => item.id === responseId);
    if (!form || !response) {
      setToast("That submission no longer exists.", "danger");
      return;
    }

    const decision = target.dataset.approveResponse ? "approved" : "rejected";
    const reason = document.getElementById("reject-reason-input")?.value.trim() || "";
    if (decision === "rejected" && !reason) {
      setToast("Put a reject reason first.", "danger");
      return;
    }

    fetch("/api/submission-decision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        decision,
        reason,
        form_title: form.title,
        form_link: `${window.location.origin}${window.location.pathname}#form/${form.id}`,
        platform_label: response.meta?.platformLabel || "",
        username: response.meta?.username || ""
      })
    })
      .then((serverResponse) => serverResponse.json().then((payload) => ({ serverResponse, payload })))
      .then(({ serverResponse, payload }) => {
        if (!serverResponse.ok || !payload.ok) {
          setToast(payload.error || "Could not send decision webhook.", "danger");
          return;
        }
        updateForm(formId, (formToUpdate) => {
          const responseToUpdate = formToUpdate.responses.find((item) => item.id === responseId);
          if (!responseToUpdate) return;
          responseToUpdate.meta.status = decision;
          responseToUpdate.meta.decisionReason = reason;
        });
        setToast(`Submission ${decision}.`);
        setRoute("review", reviewRouteValue(formId, responseId));
      })
      .catch(() => setToast("Could not send decision webhook.", "danger"));
    return;
  }
  if (target.dataset.copyLink) copyShareLink(target.dataset.copyLink);
  if (target.dataset.translateActivity) {
    const entry = (state.security?.activity_log || []).find((item) => activityEntryKey(item) === target.dataset.translateActivity);
    if (!entry) {
      setToast("Could not translate that activity event.", "danger");
      return;
    }
    state.activityInsights[target.dataset.translateActivity] = {
      ...(state.activityInsights[target.dataset.translateActivity] || {}),
      translation: translateActivityEntry(entry)
    };
    render();
    return;
  }
  if (target.dataset.intentActivity) {
    const entry = (state.security?.activity_log || []).find((item) => activityEntryKey(item) === target.dataset.intentActivity);
    if (!entry) {
      setToast("Could not infer intent for that activity event.", "danger");
      return;
    }
    state.activityInsights[target.dataset.intentActivity] = {
      ...(state.activityInsights[target.dataset.intentActivity] || {}),
      translation: state.activityInsights[target.dataset.intentActivity]?.translation || translateActivityEntry(entry),
      intent: inferActivityIntent(entry)
    };
    render();
    return;
  }
  if (target.dataset.banDevice || target.dataset.banNetwork || target.dataset.unbanDevice || target.dataset.unbanNetwork) {
    const scope = target.dataset.banDevice || target.dataset.unbanDevice ? "device" : "network";
    const value = target.dataset.banDevice || target.dataset.banNetwork || target.dataset.unbanDevice || target.dataset.unbanNetwork;
    const endpoint = target.dataset.banDevice || target.dataset.banNetwork ? "/api/admin/ban" : "/api/admin/unban";
    const reasonInput = target.closest(".answer-value")?.querySelector(".text-area") || document.getElementById(banReasonInputId(scope, value));
    const reason = endpoint.endsWith("/ban") ? (reasonInput?.value || "").trim() : "";
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ scope, value, reason })
    })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok || !payload.ok) {
          setToast(payload.error || "Could not update ban list.", "danger");
          return;
        }
        refreshSecurityData()
          .then(() => {
            setToast(endpoint.endsWith("/ban") ? "IP banned." : "IP unbanned.");
            render();
          })
          .catch((error) => setToast(error.message || "Could not refresh control panel.", "danger"));
      })
      .catch(() => setToast("Could not update ban list.", "danger"));
    return;
  }
  if (target.dataset.addQuestion) addQuestion(target.dataset.addQuestion);
  if (target.dataset.deleteForm && confirm("Delete this form?")) deleteForm(target.dataset.deleteForm);
  if (target.dataset.duplicateQuestion) duplicateQuestion(formId, questionId);
  if (target.dataset.removeQuestion) removeQuestion(formId, questionId);
  if (target.dataset.addOption) {
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      question.options.push(`Choice ${question.options.length + 1}`);
    });
    render();
  }
  if (target.dataset.removeOption) {
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      question.options.splice(Number(optionIndex), 1);
    });
    render();
  }
  if (target.dataset.addGraphPoint) {
    updateForm(graphFormId, (form) => {
      const question = form.questions.find((item) => item.id === graphQuestionId);
      if (!question) return;
      question.graphPoints.push({ label: `Bar ${question.graphPoints.length + 1}`, value: 5 });
    });
    render();
  }
  if (target.dataset.removeGraphPoint) {
    updateForm(graphFormId, (form) => {
      const question = form.questions.find((item) => item.id === graphQuestionId);
      if (!question) return;
      question.graphPoints.splice(Number(graphPointIndex), 1);
    });
    render();
  }
  if (target.dataset.importPdf) {
    pdfImportInput.dataset.formId = target.dataset.importPdf;
    pdfImportInput.click();
  }
  if (target.dataset.importText) {
    const pasted = window.prompt(
      "Paste the imported form text here.\n\nUse the same markers as PDF import, for example:\n(*form title*) My Form\n(*short answer*) What is your name?"
    );
    if (!pasted || !pasted.trim()) return;
    importTextIntoForm(target.dataset.importText, pasted);
    return;
  }
  if (target.dataset.clearDrawing) {
    clearDrawingPad(target.dataset.clearDrawing);
    return;
  }
  if (target.dataset.clearAnimationFrame) {
    clearAnimationFrame(target.dataset.clearAnimationFrame);
    return;
  }
  if (target.dataset.animationSelect) {
    const [questionId, frameIndex] = target.dataset.animationSelect.split(":");
    selectAnimationFrame(questionId, Number(frameIndex));
    return;
  }
  if (target.dataset.animationPrev) {
    stepAnimationFrame(target.dataset.animationPrev, -1);
    return;
  }
  if (target.dataset.animationNext) {
    stepAnimationFrame(target.dataset.animationNext, 1);
    return;
  }
  if (target.dataset.animationDuplicate) {
    duplicateAnimationFrame(target.dataset.animationDuplicate);
    return;
  }
  if (target.dataset.animationClear) {
    clearAnimationTimelineFrame(target.dataset.animationClear);
    return;
  }
  if (target.dataset.animationPlay) {
    toggleAnimationPlayback(target.dataset.animationPlay);
    return;
  }
  if (target.dataset.wizardForm) {
    state.wizardInstaller.selectedFormId = target.dataset.wizardForm;
    if (state.wizardInstaller.finishAction === "create_form") {
      state.wizardInstaller.finishAction = "open_selected_form";
    }
    render();
    return;
  }
  if (target.dataset.wizardControl) {
    state.wizardInstaller.selectedControlView = target.dataset.wizardControl;
    if (state.wizardInstaller.finishAction === "open_control_panel") {
      render();
      return;
    }
    render();
    return;
  }
  if (target.dataset.wizardBack) {
    stepWizard(-1);
    return;
  }
  if (target.dataset.wizardNext) {
    if ((Number(state.wizardInstaller.step) || 0) >= wizardStepCount() - 1) {
      finishWizardInstaller();
      return;
    }
    stepWizard(1);
    return;
  }
  if (target.dataset.wizardCancel) {
    resetWizardInstaller();
    render();
    return;
  }
  if (target.dataset.downloadNotePdf) {
    const currentRoute = route();
    const formId = currentRoute.value;
    const form = formById(formId);
    const question = form?.questions.find((item) => item.id === target.dataset.downloadNotePdf);
    if (!question) {
      setToast("That note block no longer exists.", "danger");
      return;
    }
    downloadNotePdf(question);
    setToast("Note PDF downloaded.");
    return;
  }
  if (target.dataset.animationOnionToggle) {
    const canvas = document.querySelector(`[data-animation-stage="${target.dataset.animationOnionToggle}"]`);
    if (!canvas) return;
    canvas.dataset.animationOnionEnabled = canvas.dataset.animationOnionEnabled === "true" ? "false" : "true";
    refreshAnimationOnionSkin(target.dataset.animationOnionToggle);
    return;
  }
  if (target.dataset.saveForm) {
    const title = document.getElementById("form-title-input").value.trim() || "Untitled Form";
    const description = document.getElementById("form-description-input").value.trim();
    const style = document.getElementById("form-style-input").value;
    const maxResponses = Math.max(0, Number(document.getElementById("form-max-responses-input").value) || 0);
    const maxAcceptedResponses = Math.max(0, Number(document.getElementById("form-max-accepted-input").value) || 0);
    updateForm(target.dataset.saveForm, (form) => {
      form.title = title;
      form.description = description;
      form.style = style;
      form.maxResponses = maxResponses;
      form.maxAcceptedResponses = maxAcceptedResponses;
    });
    setToast("Form saved.");
    render();
  }
}

function handleInput(event) {
  const target = event.target;

  if (target.dataset.animationOpacity) {
    const canvas = document.querySelector(`[data-animation-stage="${target.dataset.animationOpacity}"]`);
    if (!canvas) return;
    canvas.dataset.animationOnionOpacity = String((Number(target.value) || 0) / 100);
    refreshAnimationOnionSkin(target.dataset.animationOpacity);
    return;
  }
  if (target.name === "wizard-finish-action") {
    state.wizardInstaller.finishAction = target.value;
    render();
    return;
  }

  if (target.dataset.questionLabel) {
    const [formId, questionId] = target.dataset.questionLabel.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (question) question.label = target.value;
    });
    return;
  }

  if (target.dataset.questionType) {
    const [formId, questionId] = target.dataset.questionType.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      question.type = target.value;
      question.options = defaultOptionsForType(target.value);
      if (!["short", "fillblank", "branchfill", "email", "number"].includes(target.value)) {
        question.placeholder = "";
      }
      if (target.value === "text") {
        question.content = "Put something here for the user to read.";
      }
      if (target.value === "note") {
        question.content = "Write the note you want people to download.";
        question.referenceCode = "REF-001";
      }
      if (target.value === "graph") {
        question.content = "Read this graph before you continue.";
        question.graphPoints = [
          { label: "A", value: 4 },
          { label: "B", value: 7 },
          { label: "C", value: 5 }
        ];
      }
      if (target.value === "drawing") {
        question.placeholder = "Draw your answer in the box.";
        question.content = "";
      }
      if (target.value === "image") {
        question.content = "https://example.com/image.png";
        question.placeholder = "Optional caption";
      }
      if (target.value === "gif") {
        question.content = "https://example.com/animation.gif";
        question.placeholder = "Optional caption";
      }
      if (target.value === "code") {
        question.placeholder = "// Type your code here";
        question.content = "";
      }
      if (target.value === "animation") {
        question.placeholder = "Draw a simple 4-frame animation below.";
        question.content = "";
      }
      if (target.value === "branchfill") {
        question.placeholder = "Type one of the branch matches";
        question.content = "";
        question.branches = defaultBranchFillBranches();
      }
    });
    render();
    return;
  }

  if (target.dataset.questionPlaceholder) {
    const [formId, questionId] = target.dataset.questionPlaceholder.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (question) question.placeholder = target.value;
    });
    return;
  }

  if (target.dataset.questionContent) {
    const [formId, questionId] = target.dataset.questionContent.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (question) question.content = target.value;
    });
    return;
  }

  if (target.dataset.questionReferenceCode) {
    const [formId, questionId] = target.dataset.questionReferenceCode.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (question) question.referenceCode = target.value;
    });
    return;
  }

  if (target.dataset.graphLabel) {
    const [formId, questionId, pointIndex] = target.dataset.graphLabel.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      question.graphPoints[Number(pointIndex)].label = target.value;
    });
    return;
  }

  if (target.dataset.graphValue) {
    const [formId, questionId, pointIndex] = target.dataset.graphValue.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      question.graphPoints[Number(pointIndex)].value = Number(target.value) || 0;
    });
    return;
  }

  if (target.dataset.ratingSize) {
    const [formId, questionId] = target.dataset.ratingSize.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      question.options = Array.from({ length: Number(target.value) }, (_item, index) => String(index + 1));
    });
    render();
    return;
  }

  if (target.dataset.scaleSize) {
    const [formId, questionId] = target.dataset.scaleSize.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      question.options = Array.from({ length: Number(target.value) }, (_item, index) => String(index + 1));
    });
    render();
    return;
  }

  if (target.dataset.scaleLeft) {
    const [formId, questionId] = target.dataset.scaleLeft.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (question) question.scaleLeft = target.value;
    });
    return;
  }

  if (target.dataset.scaleRight) {
    const [formId, questionId] = target.dataset.scaleRight.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (question) question.scaleRight = target.value;
    });
    return;
  }

  if (target.dataset.questionRequired) {
    const [formId, questionId] = target.dataset.questionRequired.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (question) question.required = target.checked;
    });
    return;
  }

  if (target.dataset.optionInput) {
    const [formId, questionId, optionIndex] = target.dataset.optionInput.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      question.options[Number(optionIndex)] = target.value;
    });
    return;
  }

  if (target.dataset.branchMatch) {
    const [formId, questionId, branchIndex] = target.dataset.branchMatch.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      if (!Array.isArray(question.branches)) question.branches = defaultBranchFillBranches();
      question.branches[Number(branchIndex)].match = target.value;
    });
    return;
  }

  if (target.dataset.branchPrompts) {
    const [formId, questionId, branchIndex] = target.dataset.branchPrompts.split(":");
    updateForm(formId, (form) => {
      const question = form.questions.find((item) => item.id === questionId);
      if (!question) return;
      if (!Array.isArray(question.branches)) question.branches = defaultBranchFillBranches();
      question.branches[Number(branchIndex)].prompts = target.value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    });
  }
}

function handleChange(event) {
  const target = event.target;

  if (target.dataset.animationOpacity) {
    const canvas = document.querySelector(`[data-animation-stage="${target.dataset.animationOpacity}"]`);
    if (!canvas) return;
    canvas.dataset.animationOnionOpacity = String((Number(target.value) || 0) / 100);
    refreshAnimationOnionSkin(target.dataset.animationOpacity);
    return;
  }

  if (target.dataset.mediaUpload) {
    const [formId, questionId] = target.dataset.mediaUpload.split(":");
    const file = target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      updateForm(formId, (form) => {
        const question = form.questions.find((item) => item.id === questionId);
        if (!question) return;
        question.content = String(reader.result || "");
        if (!question.label || question.label === "New question") {
          question.label = question.type === "gif" ? "GIF Block" : "Image Block";
        }
      });
      setToast(`${file.name} added.`);
      render();
    };
    reader.readAsDataURL(file);
    return;
  }
}

function render() {
  const currentRoute = route();
  document.body.dataset.route = currentRoute.name;
  document.body.classList.toggle("standalone-form", ["form", "submit-meta"].includes(currentRoute.name));
  document.body.classList.toggle("logged-out", !state.isAdmin && !["form", "submit-meta"].includes(currentRoute.name));
  document.body.classList.remove(
    "theme-default",
    "theme-windows-xp-pdf",
    "theme-windows-98-pdf",
    "theme-wizard-exe-setup",
    "theme-windows-wizard-setup",
    "theme-wii-u-menu"
  );
  const themedFormId = ["builder", "form", "responses", "submit-meta"].includes(currentRoute.name)
    ? currentRoute.value
    : ["review", "actions"].includes(currentRoute.name)
      ? parseReviewRouteValue(currentRoute.value).formId
      : "";
  const themedForm = themedFormId ? formById(themedFormId) : null;
  const routeTheme = themedForm?.style
    || ((currentRoute.name === "dashboard" || currentRoute.name === "control" || currentRoute.name === "create-account" || currentRoute.name === "reset") ? state.homeTheme : "default");
  const themeClass = (routeTheme || "default").split("_").join("-");
  document.body.classList.add(`theme-${themeClass}`);
  renderFormsList();
  renderBrandIcon();

  if (!state.authReady) {
    pageTitle.textContent = "Loading";
    routeBadge.textContent = "Please Wait";
    renderTopbarActions("");
    pageContent.innerHTML = `<div class="card">Loading...</div>`;
    return;
  }

  if (currentRoute.name === "builder") renderBuilder(currentRoute.value);
  else if (currentRoute.name === "control") renderControlPanel();
  else if (currentRoute.name === "form") renderFill(currentRoute.value);
  else if (currentRoute.name === "submit-meta") renderSubmitMetaRoute(currentRoute.value);
  else if (currentRoute.name === "review") renderReviewRoute(currentRoute.value);
  else if (currentRoute.name === "actions") renderActionsRoute(currentRoute.value);
  else if (currentRoute.name === "responses") renderResponses(currentRoute.value);
  else if (currentRoute.name === "create-account") renderCreateAccountRoute();
  else if (currentRoute.name === "reset") renderResetRoute(currentRoute.value);
  else renderDashboard();
}

window.addEventListener("hashchange", () => {
  trackActivity("route_change", { hash: window.location.hash || "#dashboard" });
  render();
});
pageContent.addEventListener("click", handleClick);
pageContent.addEventListener("input", handleInput);
pageContent.addEventListener("change", handleChange);
topbarActions.addEventListener("click", handleClick);
newFormButton.addEventListener("click", createForm);
pdfImportInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  const formId = event.target.dataset.formId;
  if (!file || !formId) return;

  try {
    await importPdfIntoForm(formId, file);
  } catch (_error) {
    setToast("PDF import failed.", "danger");
  } finally {
    event.target.value = "";
  }
});

state.pendingSubmission = loadPendingSubmission();
normalizeData();
initializeApp();

function isConsoleDashboardActive() {
  return state.homeTheme === "wii_u_menu" && route().name === "dashboard";
}

function consoleTargets(zone = "") {
  const selector = zone
    ? `[data-console-target^="${zone}:"]`
    : "[data-console-target]";
  return [...document.querySelectorAll(selector)];
}

function defaultConsoleSelection() {
  const launcher = consoleTargets("launcher")[0];
  if (launcher) return { zone: "launcher", id: launcher.dataset.consoleTarget || "" };
  const dock = consoleTargets("dock")[0];
  if (dock) return { zone: "dock", id: dock.dataset.consoleTarget || "" };
  return { zone: "launcher", id: "" };
}

function applyConsoleSelection() {
  const selection = state.consoleSelection?.id ? state.consoleSelection : defaultConsoleSelection();
  state.consoleSelection = selection;
  const currentTarget = selection.id ? document.querySelector(`[data-console-target="${selection.id}"]`) : null;

  for (const node of consoleTargets()) {
    const isSelected = node === currentTarget;
    node.classList.toggle("console-selected", isSelected);
    node.classList.toggle("console-dimmed", Boolean(currentTarget) && !isSelected);
    node.setAttribute("aria-selected", isSelected ? "true" : "false");
    node.tabIndex = isSelected ? 0 : -1;
  }

  if (currentTarget && document.activeElement !== currentTarget) {
    currentTarget.focus({ preventScroll: true });
  }
}

function setConsoleSelection(id) {
  if (!id) return;
  const zone = id.startsWith("dock:") ? "dock" : "launcher";
  if (state.consoleSelection?.id === id && state.consoleSelection?.zone === zone) return;
  state.consoleSelection = { zone, id };
  applyConsoleSelection();
}

function consoleTargetCenter(node) {
  const rect = node.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function directionalConsoleTarget(current, candidates, direction) {
  const origin = consoleTargetCenter(current);
  const scored = candidates
    .filter((candidate) => candidate !== current)
    .map((candidate) => {
      const point = consoleTargetCenter(candidate);
      const dx = point.x - origin.x;
      const dy = point.y - origin.y;
      if (direction === "left" && dx >= -8) return null;
      if (direction === "right" && dx <= 8) return null;
      if (direction === "up" && dy >= -8) return null;
      if (direction === "down" && dy <= 8) return null;
      const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
      const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      return { candidate, score: primary + secondary * 0.45 };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score);
  return scored[0]?.candidate || null;
}

function moveConsoleSelection(direction) {
  const current = state.consoleSelection?.id
    ? document.querySelector(`[data-console-target="${state.consoleSelection.id}"]`)
    : null;
  if (!current) {
    applyConsoleSelection();
    return;
  }

  if (state.consoleSelection.zone === "launcher") {
    if (direction === "down") {
      const nextLauncher = directionalConsoleTarget(current, consoleTargets("launcher"), direction);
      if (nextLauncher) {
        setConsoleSelection(nextLauncher.dataset.consoleTarget || "");
        return;
      }
      const firstDock = consoleTargets("dock")[0];
      if (firstDock) setConsoleSelection(firstDock.dataset.consoleTarget || "");
      return;
    }
    const nextLauncher = directionalConsoleTarget(current, consoleTargets("launcher"), direction);
    if (nextLauncher) setConsoleSelection(nextLauncher.dataset.consoleTarget || "");
    return;
  }

  const dockTargets = consoleTargets("dock");
  const dockIndex = dockTargets.findIndex((node) => node === current);
  if (direction === "left" && dockIndex > 0) {
    setConsoleSelection(dockTargets[dockIndex - 1].dataset.consoleTarget || "");
    return;
  }
  if (direction === "right" && dockIndex >= 0 && dockIndex < dockTargets.length - 1) {
    setConsoleSelection(dockTargets[dockIndex + 1].dataset.consoleTarget || "");
    return;
  }
  if (direction === "up") {
    const launcherNodes = consoleTargets("launcher");
    const fallback = launcherNodes[launcherNodes.length - 1] || launcherNodes[0];
    if (fallback) setConsoleSelection(fallback.dataset.consoleTarget || "");
  }
}

function activateConsoleSelection() {
  const current = state.consoleSelection?.id
    ? document.querySelector(`[data-console-target="${state.consoleSelection.id}"]`)
    : null;
  if (!current) return;
  current.classList.add("console-activating");
  window.setTimeout(() => {
    current.classList.remove("console-activating");
    current.click();
  }, 110);
}

function handleConsoleHomeKeydown(event) {
  if (!isConsoleDashboardActive()) return;
  if (event.target instanceof HTMLSelectElement) return;
  const keyDirection = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down"
  }[event.key];
  if (keyDirection) {
    event.preventDefault();
    moveConsoleSelection(keyDirection);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activateConsoleSelection();
  }
}

function initializeConsoleHome() {
  if (!isConsoleDashboardActive()) return;
  const targets = consoleTargets();
  if (!targets.length) return;

  for (const node of targets) {
    if (node.dataset.consoleReady === "true") continue;
    node.addEventListener("mouseenter", () => setConsoleSelection(node.dataset.consoleTarget || ""));
    node.addEventListener("focus", () => setConsoleSelection(node.dataset.consoleTarget || ""));
    node.dataset.consoleReady = "true";
  }

  const existing = state.consoleSelection?.id
    ? document.querySelector(`[data-console-target="${state.consoleSelection.id}"]`)
    : null;
  if (!existing) {
    state.consoleSelection = defaultConsoleSelection();
  }
  applyConsoleSelection();
}

window.addEventListener("keydown", handleConsoleHomeKeydown);

function initializeDrawingInputs(form) {
  for (const question of form.questions) {
    if (question.type !== "drawing") continue;
    const canvas = document.querySelector(`[data-drawing-canvas="${question.id}"]`);
    const output = document.querySelector(`[data-drawing-output="${question.id}"]`);
    if (!canvas || !output) continue;
    setupDrawingCanvas(canvas, output);
  }
}

function initializeCodeInputs(form) {
  for (const question of form.questions) {
    if (question.type !== "code") continue;
    const input = document.querySelector(`[data-code-input="${question.id}"]`);
    const highlight = document.querySelector(`[data-code-highlight="${question.id}"]`);
    const lines = document.querySelector(`[data-code-lines="${question.id}"]`);
    if (!input || !highlight || !lines || input.dataset.ready === "true") continue;

    const syncCodeInput = () => {
      highlight.innerHTML = highlightedCodeHtml(input.value || input.placeholder || "");
      lines.innerHTML = codeLineNumbersHtml(input.value || input.placeholder || "");
      highlight.scrollTop = input.scrollTop;
      highlight.scrollLeft = input.scrollLeft;
      lines.scrollTop = input.scrollTop;
    };

    input.addEventListener("input", syncCodeInput);
    input.addEventListener("scroll", syncCodeInput, { passive: true });
    syncCodeInput();
    input.dataset.ready = "true";
  }
}

function initializeAnimationInputs(form) {
  for (const question of form.questions) {
    if (question.type !== "animation") continue;
    const canvas = document.querySelector(`[data-animation-stage="${question.id}"]`);
    const output = document.querySelector(`[data-animation-output="${question.id}"]`);
    if (!canvas || !output || canvas.dataset.animationReady === "true") continue;

    let frames = [];
    try {
      const parsed = JSON.parse(output.value || "[]");
      frames = Array.isArray(parsed) ? parsed.slice(0, ANIMATION_FRAME_COUNT) : [];
    } catch (_error) {
      frames = [];
    }
    while (frames.length < ANIMATION_FRAME_COUNT) frames.push("");

    setupDrawingCanvas(canvas, output, {
      initialValue: frames[0] || "",
      writeDirectlyToOutput: false,
      backgroundFill: false,
      onChange: (value) => {
        const state = getAnimationStudioState(question.id);
        state.frames[state.currentFrame] = value;
        persistAnimationStudio(question.id, state.frames);
      }
    });

    canvas.dataset.animationReady = "true";
    canvas.dataset.animationQuestionId = question.id;
    canvas.dataset.animationCurrentFrame = "0";
    canvas.dataset.animationPlaying = "false";
    canvas.dataset.animationOnionEnabled = "false";
    canvas.dataset.animationOnionOpacity = "0.45";
    output.value = JSON.stringify(frames);
    refreshAnimationTimeline(question.id);
  }
}

function refreshBranchFillQuestion(question) {
  const input = document.querySelector(`[data-branchfill-input="${question.id}"]`);
  if (!input) return;
  const normalized = input.value.trim().toLowerCase();
  const matchedIndex = (question.branches || []).findIndex((branch) => (branch.match || "").trim().toLowerCase() === normalized);
  document.querySelectorAll(`[data-branchfill-panel^="${question.id}:"]`).forEach((panel, index) => {
    panel.classList.toggle("active", index === matchedIndex);
  });
}

function initializeBranchFillInputs(form) {
  for (const question of form.questions) {
    if (question.type !== "branchfill") continue;
    const input = document.querySelector(`[data-branchfill-input="${question.id}"]`);
    if (!input || input.dataset.branchfillReady === "true") continue;
    const sync = () => refreshBranchFillQuestion(question);
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    input.dataset.branchfillReady = "true";
    sync();
  }
}

function getAnimationStudioState(questionId) {
  const canvas = document.querySelector(`[data-animation-stage="${questionId}"]`);
  const output = document.querySelector(`[data-animation-output="${questionId}"]`);
  if (!canvas || !output) {
    return { canvas: null, output: null, frames: [], currentFrame: 0, playing: false, playbackTimer: null };
  }
  let frames = [];
  try {
    const parsed = JSON.parse(output.value || "[]");
    frames = Array.isArray(parsed) ? parsed.slice(0, ANIMATION_FRAME_COUNT) : [];
  } catch (_error) {
    frames = [];
  }
  while (frames.length < ANIMATION_FRAME_COUNT) frames.push("");
  return {
    canvas,
    output,
    frames,
    currentFrame: Number(canvas.dataset.animationCurrentFrame || 0),
    playing: canvas.dataset.animationPlaying === "true",
    playbackTimer: Number(canvas.dataset.animationPlaybackTimer || 0)
  };
}

function persistAnimationStudio(questionId, frames = null) {
  const state = getAnimationStudioState(questionId);
  if (!state.output) return;
  const nextFrames = Array.isArray(frames) ? frames : state.frames;
  state.output.value = JSON.stringify(nextFrames);
  updateAnimationThumbs(questionId, nextFrames);
}

function updateAnimationThumbs(questionId, frames) {
  for (let index = 0; index < ANIMATION_FRAME_COUNT; index += 1) {
    const thumb = document.querySelector(`[data-animation-thumb="${questionId}:${index}"]`);
    if (!thumb) continue;
    const frame = frames[index] || "";
    thumb.src = frame || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    thumb.classList.toggle("filled", Boolean(frame));
  }
}

function refreshAnimationTimeline(questionId) {
  const state = getAnimationStudioState(questionId);
  if (!state.canvas) return;
  updateAnimationThumbs(questionId, state.frames);
  document.querySelectorAll(`[data-animation-select^="${questionId}:"]`).forEach((button, index) => {
    button.classList.toggle("active", index === state.currentFrame);
  });
  refreshAnimationOnionSkin(questionId, state.frames, state.currentFrame);
}

function previousAnimationFrameIndex(frames, currentFrame) {
  for (let offset = 1; offset < frames.length; offset += 1) {
    const index = (currentFrame - offset + frames.length) % frames.length;
    if (frames[index]) return index;
  }
  return -1;
}

function refreshAnimationOnionSkin(questionId, frames = null, currentFrame = null) {
  const state = getAnimationStudioState(questionId);
  const onion = document.querySelector(`[data-animation-onion="${questionId}"]`);
  const toggle = document.querySelector(`[data-animation-onion-toggle="${questionId}"]`);
  if (!state.canvas || !onion || !toggle) return;
  const activeFrames = Array.isArray(frames) ? frames : state.frames;
  const activeFrame = Number.isFinite(currentFrame) ? currentFrame : state.currentFrame;
  const previousIndex = previousAnimationFrameIndex(activeFrames, activeFrame);
  const onionEnabled = state.canvas.dataset.animationOnionEnabled === "true";
  const opacity = Number(state.canvas.dataset.animationOnionOpacity || 0.45);
  const previousFrame = previousIndex >= 0 ? activeFrames[previousIndex] || "" : "";

  onion.src = previousFrame || "";
  onion.style.opacity = onionEnabled && previousFrame ? String(opacity) : "0";
  onion.classList.toggle("visible", Boolean(onionEnabled && previousFrame));
  toggle.textContent = onionEnabled ? "Hide Last Frame" : "Show Last Frame";
  toggle.disabled = !previousFrame;
}

function loadAnimationFrame(questionId, frameIndex) {
  const state = getAnimationStudioState(questionId);
  if (!state.canvas) return;
  const nextFrame = Math.max(0, Math.min(ANIMATION_FRAME_COUNT - 1, frameIndex));
  state.canvas.dataset.animationCurrentFrame = String(nextFrame);
  setDrawingCanvasValue(state.canvas, state.frames[nextFrame] || "");
  refreshAnimationTimeline(questionId);
}

function selectAnimationFrame(questionId, frameIndex) {
  stopAnimationPlayback(questionId);
  loadAnimationFrame(questionId, frameIndex);
}

function stepAnimationFrame(questionId, direction) {
  const state = getAnimationStudioState(questionId);
  if (!state.canvas) return;
  const nextFrame = (state.currentFrame + direction + ANIMATION_FRAME_COUNT) % ANIMATION_FRAME_COUNT;
  selectAnimationFrame(questionId, nextFrame);
}

function duplicateAnimationFrame(questionId) {
  const state = getAnimationStudioState(questionId);
  if (!state.canvas) return;
  const sourceFrame = state.frames[state.currentFrame] || "";
  const targetFrame = Math.min(ANIMATION_FRAME_COUNT - 1, state.currentFrame + 1);
  state.frames[targetFrame] = sourceFrame;
  state.output.value = JSON.stringify(state.frames);
  selectAnimationFrame(questionId, targetFrame);
}

function clearAnimationTimelineFrame(questionId) {
  const state = getAnimationStudioState(questionId);
  if (!state.canvas) return;
  state.frames[state.currentFrame] = "";
  state.output.value = JSON.stringify(state.frames);
  setDrawingCanvasValue(state.canvas, "");
  refreshAnimationTimeline(questionId);
}

function stopAnimationPlayback(questionId) {
  const state = getAnimationStudioState(questionId);
  if (!state.canvas) return;
  const playButton = document.querySelector(`[data-animation-play="${questionId}"]`);
  if (state.playbackTimer) window.clearInterval(state.playbackTimer);
  state.canvas.dataset.animationPlaying = "false";
  state.canvas.dataset.animationPlaybackTimer = "0";
  if (playButton) playButton.textContent = "Play";
}

function toggleAnimationPlayback(questionId) {
  const state = getAnimationStudioState(questionId);
  if (!state.canvas) return;
  const playButton = document.querySelector(`[data-animation-play="${questionId}"]`);
  if (state.playing) {
    stopAnimationPlayback(questionId);
    return;
  }
  state.canvas.dataset.animationPlaying = "true";
  if (playButton) playButton.textContent = "Pause";
  const timer = window.setInterval(() => {
    const current = getAnimationStudioState(questionId);
    const nextFrame = (current.currentFrame + 1) % ANIMATION_FRAME_COUNT;
    loadAnimationFrame(questionId, nextFrame);
  }, 180);
  state.canvas.dataset.animationPlaybackTimer = String(timer);
}

function initializeAnimationResponsePreviews() {
  document.querySelectorAll("[data-animation-preview]").forEach((node) => {
    if (node.dataset.ready === "true") return;
    const screen = node.querySelector(".animation-response-screen");
    if (!screen) return;
    let frames = [];
    try {
      const parsed = JSON.parse(node.dataset.animationPreview || "[]");
      frames = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_error) {
      frames = [];
    }
    if (frames.length < 2) {
      node.dataset.ready = "true";
      return;
    }
    let index = 0;
    const timer = window.setInterval(() => {
      index = (index + 1) % frames.length;
      screen.src = frames[index];
    }, 180);
    node.dataset.ready = "true";
    node.dataset.previewTimer = String(timer);
  });
}

function clearDrawingPad(questionId) {
  const canvas = document.querySelector(`[data-drawing-canvas="${questionId}"]`);
  if (!canvas) return;
  setDrawingCanvasValue(canvas, "");
}

function clearAnimationFrame(value) {
  const [questionId = "", frameIndex = "0"] = value.split(":");
  const canvas = document.querySelector(`[data-animation-canvas="${questionId}:${frameIndex}"]`);
  const output = document.querySelector(`[data-animation-output="${questionId}:${frameIndex}"]`);
  if (!canvas || !output) return;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  output.value = "";
}

function setDrawingCanvasValue(canvas, value = "") {
  const controller = canvas._drawingController;
  if (!controller) return;
  controller.render(value);
  controller.setOutput(value);
}

function setupDrawingCanvas(canvas, output, options = {}) {
  if (canvas.dataset.ready === "true") {
    if (options.initialValue != null) setDrawingCanvasValue(canvas, options.initialValue);
    return;
  }

  const context = canvas.getContext("2d");
  const pointerState = { drawing: false, moved: false };
  let logicalWidth = 0;
  let logicalHeight = 0;
  const fillBackground = options.backgroundFill !== false;
  const notifyChange = () => {
    const value = canvas.toDataURL("image/png");
    if (output && options.writeDirectlyToOutput !== false) output.value = value;
    options.onChange?.(value);
  };

  const resizeCanvas = () => {
    const bounds = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const nextWidth = Math.max(320, Math.floor(bounds.width));
    const nextHeight = Math.max(220, Math.floor(nextWidth * 0.5));
    const snapshot = canvas.dataset.snapshotValue || options.initialValue || "";
    logicalWidth = nextWidth;
    logicalHeight = nextHeight;

    canvas.width = Math.floor(nextWidth * ratio);
    canvas.height = Math.floor(nextHeight * ratio);
    canvas.style.height = `${nextHeight}px`;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.scale(ratio, ratio);
    context.clearRect(0, 0, nextWidth, nextHeight);
    if (fillBackground) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, nextWidth, nextHeight);
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#1f2937";
    context.lineWidth = 3;

    if (snapshot) {
      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, nextWidth, nextHeight);
      };
      image.src = snapshot;
    }
  };

  const pointFromEvent = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const scaleX = logicalWidth && bounds.width ? logicalWidth / bounds.width : 1;
    const scaleY = logicalHeight && bounds.height ? logicalHeight / bounds.height : 1;
    return {
      x: (event.clientX - bounds.left) * scaleX,
      y: (event.clientY - bounds.top) * scaleY
    };
  };

  const renderSnapshot = (snapshot = "") => {
    context.clearRect(0, 0, logicalWidth || canvas.width, logicalHeight || canvas.height);
    if (fillBackground) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, logicalWidth || canvas.width, logicalHeight || canvas.height);
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#1f2937";
    context.lineWidth = 3;
    if (!snapshot) return;
    const image = new Image();
    image.onload = () => {
      context.drawImage(image, 0, 0, logicalWidth, logicalHeight);
    };
    image.src = snapshot;
  };

  const beginStroke = (event) => {
    pointerState.drawing = true;
    pointerState.moved = false;
    const point = pointFromEvent(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  };

  const continueStroke = (event) => {
    if (!pointerState.drawing) return;
    pointerState.moved = true;
    const point = pointFromEvent(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const endStroke = (event) => {
    if (!pointerState.drawing) return;
    if (!pointerState.moved) {
      const point = pointFromEvent(event);
      context.beginPath();
      context.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
      context.fillStyle = "#1f2937";
      context.fill();
    }
    pointerState.drawing = false;
    notifyChange();
    if (event.pointerId != null) canvas.releasePointerCapture(event.pointerId);
  };

  resizeCanvas();
  canvas.addEventListener("pointerdown", beginStroke);
  canvas.addEventListener("pointermove", continueStroke);
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointerleave", endStroke);
  window.addEventListener("resize", resizeCanvas, { passive: true });
  canvas.dataset.ready = "true";
  canvas._drawingController = {
    render(snapshot = "") {
      canvas.dataset.snapshotValue = snapshot;
      renderSnapshot(snapshot);
    },
    setOutput(snapshot = "") {
      canvas.dataset.snapshotValue = snapshot;
      if (output && options.writeDirectlyToOutput !== false) output.value = snapshot;
      options.onChange?.(snapshot);
    }
  };
  if (options.initialValue) {
    setDrawingCanvasValue(canvas, options.initialValue);
  }
}
