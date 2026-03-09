import { AGENTS } from './agents';

const API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaude(apiKey, systemPrompt, userMessage) {
  try {
    const response = await fetch(API_URL, {
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
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || 'No response generated.';
  } catch (error) {
    console.error('API call failed:', error);
    throw error;
  }
}

export async function callAgent(apiKey, codename, userMessage, showContext = '') {
  const agent = AGENTS[codename];
  if (!agent) return `Unknown agent: ${codename}`;

  const systemWithShows = showContext
    ? `${agent.systemPrompt}\n${showContext}`
    : agent.systemPrompt;

  try {
    return await callClaude(apiKey, systemWithShows, userMessage);
  } catch (error) {
    return `Error from ${codename}: ${error.message}`;
  }
}

export async function routeRequest(apiKey, userMessage, showContext = '') {
  const routingPrompt = `${AGENTS.DISPATCH.systemPrompt}${showContext}

IMPORTANT: You must respond with ONLY a valid JSON object, no other text. The JSON must have these fields:
- "assessment": string (1-2 sentence summary)
- "agents": array of agent codenames to activate (from: LEDGER, GHOSTLIGHT, CLIPSHOT, BOOST, MARQUEE, FRONTDESK, GRID, PULSE)
- "sequence": array of objects with "agent", "task", "depends_on" fields
- "manual_tasks": array of strings (tasks that need human action)

Do NOT include GATEKEEPER in the agents array — it runs automatically as the final step.
Do NOT include DISPATCH in the agents array.`;

  try {
    const response = await callClaude(apiKey, routingPrompt, userMessage);

    // Try to parse JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    // Fallback: if we can't parse routing, use a sensible default
    return {
      assessment: 'Processing your request.',
      agents: inferAgents(userMessage),
      sequence: [],
      manual_tasks: [],
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Simple keyword-based fallback if DISPATCH routing fails
function inferAgents(text) {
  const lower = text.toLowerCase();
  const agents = [];

  if (lower.includes('show') || lower.includes('venue') || lower.includes('perform')) {
    if (lower.includes('deal') || lower.includes('money') || lower.includes('pay') || lower.includes('guarantee') || lower.includes('commission')) {
      agents.push('LEDGER');
    }
    if (lower.includes('promo') || lower.includes('announce')) {
      agents.push('MARQUEE');
    }
    if (!agents.includes('MARQUEE') && !agents.includes('LEDGER')) {
      agents.push('MARQUEE');
      agents.push('LEDGER');
    }
  }

  if (lower.includes('reel') || lower.includes('video') || lower.includes('script')) {
    agents.push('CLIPSHOT');
  }

  if (lower.includes('email') || lower.includes('description') || lower.includes('press') || lower.includes('substack')) {
    agents.push('GHOSTLIGHT');
  }

  if (lower.includes('ad') || lower.includes('facebook ad') || lower.includes('boost')) {
    agents.push('BOOST');
  }

  if (lower.includes('instagram') || lower.includes('ig ') || lower.includes('grid')) {
    agents.push('GRID');
  }

  if (lower.includes('corporate') || lower.includes('private') || lower.includes('booking') || lower.includes('outreach')) {
    agents.push('FRONTDESK');
  }

  if (lower.includes('trend') || lower.includes('idea') || lower.includes('content idea') || lower.includes('topic')) {
    agents.push('PULSE');
  }

  if (agents.length === 0) {
    agents.push('GHOSTLIGHT');
  }

  return [...new Set(agents)];
}
