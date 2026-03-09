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

  const now = new Date();
  const timestamp = now.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });

  let text = `\n\n--- JOHN'S SHOW SCHEDULE ---\n`;
  text += `CURRENT DATE/TIME: ${timestamp}\n`;

  if (upcoming.length) {
    text += '\nUPCOMING SHOWS:\n';
    upcoming.forEach(s => {
      const daysUntil = Math.ceil((new Date(s.date) - now) / (1000 * 60 * 60 * 24));
      text += `• ${s.date} (${daysUntil} days away) — ${s.venue}, ${s.city}, ${s.state}`;
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

const PARSE_PROMPT = `You are a data extraction tool. Parse the following into a JSON array of show objects. Extract every show/performance you can find.

Each object must have these fields (use empty string "" if not found):
- "date": YYYY-MM-DD format
- "venue": venue/club name
- "city": city name
- "state": state abbreviation (e.g. OH, TN, MI)
- "showTimes": show times if listed (e.g. "7pm & 9:30pm")
- "ticketLink": ticket URL if found
- "dealType": one of "Guarantee", "SOB", "GBOR", "Door Deal", "Aggregate Bonus", "Travel Buyout", or ""
- "guarantee": dollar amount as number (no $ sign), or ""
- "notes": any other relevant details

Respond with ONLY a valid JSON array. No other text.`;

export async function parseShowsWithAI(apiKey, content) {
  // content can be a string (pasted text) or { type: 'file', base64, mediaType } for PDFs
  let userContent;
  if (typeof content === 'string') {
    userContent = content;
  } else {
    // PDF or other file sent as document to Claude
    userContent = [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: content.mediaType,
          data: content.base64,
        },
      },
      { type: 'text', text: 'Extract all show dates and details from this document.' },
    ];
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: PARSE_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const responseText = data.content?.[0]?.text || '[]';
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Could not parse shows from the text.');

  const parsed = JSON.parse(jsonMatch[0]);
  return parsed.map(s => ({ ...s, id: Date.now() + Math.random() }));
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
