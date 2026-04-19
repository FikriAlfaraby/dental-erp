/**
 * OpenAI-compatible chat client.
 * Defaults to NVIDIA NIM and provides completion + SSE helpers.
 */

import type { ModelConfig } from './models'

const NVIDIA_NIM_BASE = 'https://integrate.api.nvidia.com/v1'
const DEFAULT_MODEL = 'minimaxai/minimax-m2.7'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompletionUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface CompletionResponse {
  content: string
  usage: CompletionUsage
  model: string
}

function sanitizeAIOutput(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim()
}

function getBaseUrl(): string {
  return (process.env.AI_BASE_URL || NVIDIA_NIM_BASE).replace(/\/$/, '')
}

function isCustomBaseUrl(baseUrl: string): boolean {
  return baseUrl !== NVIDIA_NIM_BASE
}

function getHeaders(): Record<string, string> {
  const baseUrl = getBaseUrl()
  const apiKey =
    process.env.AI_API_KEY || process.env.NVIDIA_API_KEY || process.env.OPENROUTER_API_KEY

  if (isCustomBaseUrl(baseUrl)) {
    return {
      Authorization: `Bearer ${apiKey || 'lm-studio'}`,
      'Content-Type': 'application/json',
    }
  }

  const key = process.env.NVIDIA_API_KEY || process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('NVIDIA_API_KEY is not set. Add it to your .env file.')
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Non-streaming chat completion.
 */
export async function complete(
  messages: ChatMessage[],
  config: Partial<ModelConfig> = {}
): Promise<CompletionResponse> {
  const res = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model: config.model || process.env.AI_MODEL || DEFAULT_MODEL,
      messages,
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
    }),
  })

  if (!res.ok) {
    throw new Error(`AI provider [${res.status}]: ${await res.text()}`)
  }

  const data = await res.json()
  return {
    content: sanitizeAIOutput(data.choices?.[0]?.message?.content || ''),
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    },
    model: data.model || config.model || 'unknown',
  }
}

/**
 * Streaming SSE response.
 * Returns a fetch Response with Content-Type: text/event-stream.
 * Client receives: data: {"text":"..."}\n\n events, then data: {"done":true}\n\n
 */
export async function streamResponse(
  messages: ChatMessage[],
  config: Partial<ModelConfig> = {}
): Promise<Response> {
  const res = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model: config.model || process.env.AI_MODEL || DEFAULT_MODEL,
      messages,
      max_tokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
      stream: true,
    }),
  })

  if (!res.ok) {
    throw new Error(`AI provider stream [${res.status}]: ${await res.text()}`)
  }

  const body = res.body
  if (!body) throw new Error('Empty response body from AI provider')

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let rawOutput = ''
  let emittedOutput = ''
  const reader = body.getReader()

  const output = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = ''

      const flushLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) return false

        const payload = trimmed.slice(6)
        if (payload === '[DONE]') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
          return true
        }

        try {
          const parsed = JSON.parse(payload)
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            rawOutput += content
            const sanitized = sanitizeAIOutput(rawOutput)
            const nextText = sanitized.slice(emittedOutput.length)
            emittedOutput = sanitized

            if (nextText) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: nextText })}\n\n`))
            }
          }
        } catch {
          // skip malformed SSE chunks
        }

        return false
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          while (true) {
            const newlineIndex = buffer.indexOf('\n')
            if (newlineIndex === -1) break

            const line = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)

            const receivedDone = flushLine(line)
            if (receivedDone) {
              controller.close()
              return
            }
          }
        }

        if (buffer) flushLine(buffer)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
        controller.close()
      } catch {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, interrupted: true })}\n\n`)
        )
        controller.close()
      } finally {
        reader.releaseLock()
      }
    },
    cancel() {
      void reader.cancel().catch(() => undefined)
    },
  })

  return new Response(output, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

/**
 * Extract JSON from AI output that may be wrapped in markdown code blocks.
 */
export function extractJSON(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return match ? match[1].trim() : text.trim()
}

export { sanitizeAIOutput }
