import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120; // Allow up to 2 minutes for synthesis

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch('http://localhost:3001/api/prds/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Synthesis proxy error:', error);
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    const isNetwork = error instanceof TypeError;
    const message = isTimeout
      ? 'Synthesis timed out (>3min)'
      : isNetwork
        ? 'Cannot reach orchestrator at localhost:3001 — is it running? Start it with `npm run dev:orchestrator` in a plain terminal.'
        : error instanceof Error
          ? error.message
          : 'Synthesis request failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
