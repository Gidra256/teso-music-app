export function statusLabel(status) {
  const labels = {
    open: "Open",
    in_progress: "In Progress",
    waiting_on_user: "Waiting for You",
    resolved: "Resolved",
    closed: "Closed",
  };
  return labels[status || "open"] || String(status).replaceAll("_", " ");
}

export function supportReferenceLabel(reference) {
  if (!reference) return "Support Request";
  // Keep the stored reference intact; TSH is the user-facing display prefix.
  return `Request #${String(reference).replace(/^SUP-/, "TSH-")}`;
}

// Apply only to system copy, never to user subjects, messages, or support replies.
export function supportCopy(text) {
  return String(text || "")
    .replace(/\bSubmit Support Ticket\b/g, "Submit a Support Request")
    .replace(/\b(Support|support) (Tickets|tickets|Ticket|ticket)\b/g, (_, support, ticket) =>
      `${support} ${ticket[0] === "T" ? "Request" : "request"}${/s$/.test(ticket) ? "s" : ""}`,
    )
    .replace(/\b(Tickets|tickets|Ticket|ticket)\b/g, (ticket) =>
      `${ticket[0] === "T" ? "Support Request" : "support request"}${/s$/.test(ticket) ? "s" : ""}`,
    );
}
