// Show data persistence via localStorage

const STORAGE_KEY = 'heffron_shows';

export function loadShows() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveShows(shows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shows));
}

export function formatShowsForAgents(shows) {
  if (!shows.length) return '';

  const upcoming = shows
    .filter(s => new Date(s.date) >= new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const past = shows
    .filter(s => new Date(s.date) < new Date(new Date().toDateString()))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  let text = '\n\n--- JOHN\'S SHOW SCHEDULE ---\n';

  if (upcoming.length) {
    text += '\nUPCOMING SHOWS:\n';
    upcoming.forEach(s => {
      text += `• ${s.date} — ${s.venue}, ${s.city}, ${s.state}`;
      if (s.dealType) text += ` | Deal: ${s.dealType}`;
      if (s.guarantee) text += ` | Guarantee: $${s.guarantee}`;
      if (s.ticketLink) text += ` | Tickets: ${s.ticketLink}`;
      if (s.showTimes) text += ` | Times: ${s.showTimes}`;
      if (s.notes) text += ` | Notes: ${s.notes}`;
      text += '\n';
    });
  }

  if (past.length) {
    text += '\nRECENT PAST SHOWS:\n';
    past.forEach(s => {
      text += `• ${s.date} — ${s.venue}, ${s.city}, ${s.state}`;
      if (s.notes) text += ` | Notes: ${s.notes}`;
      text += '\n';
    });
  }

  text += '--- END SHOW SCHEDULE ---\n';
  return text;
}
