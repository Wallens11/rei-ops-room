function normalizeSection(section = {}, index = 0) {
  const items = Array.isArray(section.items)
    ? section.items.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return {
    id: section.id || `section-${index}`,
    title: section.title || `Section ${index + 1}`,
    items
  };
}

function formatSectionNote(items = []) {
  if (items.length <= 1) {
    return "Open the source note for the full recap.";
  }

  return items.slice(1).join(" | ");
}

export function createEmptyDailyHandoffState() {
  return {
    status: "loading",
    date: null,
    sections: [],
    detail: "Checking the latest daily recap."
  };
}

export function createDailyHandoffErrorState(
  previous = createEmptyDailyHandoffState(),
  error
) {
  return {
    ...previous,
    status: "error",
    detail: error instanceof Error ? error.message : String(error || "Daily handoff unavailable")
  };
}

export function normalizeDailyHandoffPayload(payload = {}) {
  const sections = Array.isArray(payload.sections)
    ? payload.sections.map((section, index) => normalizeSection(section, index))
    : [];

  return {
    status: payload.status || (sections.length > 0 ? "ready" : "empty"),
    date: payload.date || null,
    sections,
    detail: payload.detail || null,
    sourcePath: payload.sourcePath || null
  };
}

export function buildDailyHandoffViewModel(state = createEmptyDailyHandoffState()) {
  if (state.status === "loading") {
    return {
      title: "Today Handoff",
      meta: "checking latest recap",
      rows: [
        {
          id: "handoff-loading",
          title: "Loading handoff...",
          detail: "Reading the daily device note from the knowledge repo.",
          note: state.detail || "Checking the newest appended day.",
          tone: "loading"
        }
      ]
    };
  }

  if (state.status === "error") {
    return {
      title: "Today Handoff",
      meta: state.date || "handoff offline",
      rows: [
        {
          id: "handoff-error",
          title: "Handoff unavailable",
          detail: state.detail || "The daily handoff note could not be read.",
          note: "Open the source note manually once the repo is synced.",
          tone: "error"
        }
      ]
    };
  }

  if (state.status === "missing" || !state.sections?.length) {
    return {
      title: "Today Handoff",
      meta: state.date || "no handoff yet",
      rows: [
        {
          id: "handoff-empty",
          title: "No daily recap yet",
          detail: state.detail || "The handoff note has no dated recap ready.",
          note: "Update the knowledge repo to make cross-device continuity visible here.",
          tone: state.status === "missing" ? "error" : "empty"
        }
      ]
    };
  }

  return {
    title: "Today Handoff",
    meta: state.date || "latest recap",
    rows: state.sections.map((section, index) => ({
      id: section.id || `section-${index}`,
      title: section.title,
      detail: section.items[0] || "No bullet captured yet.",
      note: formatSectionNote(section.items),
      tone: "ready"
    }))
  };
}
