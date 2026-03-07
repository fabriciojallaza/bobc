/**
 * llm.js — OpenRouter client with tool calling support
 * Model: google/gemini-3-flash-preview
 */

import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'google/gemini-3-flash-preview';
const BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Call the LLM with tools, handle tool call loop until model stops.
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {Array} tools - OpenAI-format tool definitions
 * @param {Function} toolExecutor - async (name, args) => result string
 * @param {string|null} imageBase64 - optional base64 image for multimodal
 * @returns {string} final text response
 */
export async function callWithTools(systemPrompt, userMessage, tools, toolExecutor, imageBase64 = null) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');

  const userContent = imageBase64
    ? [
        { type: 'text', text: userMessage },
        { type: 'image_url', image_url: { url: imageBase64 } },
      ]
    : userMessage;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  // Tool call loop
  for (let round = 0; round < 10; round++) {
    const body = {
      model: MODEL,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    };

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://bobc.condordev.xyz',
        'X-Title': 'BOBC Agent',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from model');

    const msg = choice.message;
    messages.push(msg);

    // No more tool calls — return final text
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content || '';
    }

    // Execute tool calls
    for (const toolCall of msg.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments || '{}');
      console.log(`[agent] calling tool: ${toolCall.function.name}`, JSON.stringify(args));

      let result;
      try {
        result = await toolExecutor(toolCall.function.name, args);
      } catch (e) {
        result = `ERROR: ${e.message}`;
      }

      console.log(`[agent] tool result: ${String(result).slice(0, 200)}`);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
  }

  return 'Max tool call rounds reached';
}

/**
 * Simple call without tools — for receipt validation (structured JSON output)
 */
export async function callForJson(systemPrompt, userMessage, imageBase64 = null) {
  if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');

  let imageUrl = null;
  if (imageBase64) {
    // Ensure proper data URI format required by OpenRouter
    imageUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;
  }

  const userContent = imageUrl
    ? [
        { type: 'text', text: userMessage },
        { type: 'image_url', image_url: { url: imageUrl } },
      ]
    : userMessage;

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://bobc.condordev.xyz',
      'X-Title': 'BOBC Agent',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(text);
}
