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
    return NextResponse.json(
      { error: 'Synthesis request failed or timed out' },
      { status: 502 }
    );
  }
}
