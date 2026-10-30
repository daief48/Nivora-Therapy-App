import WebSocket from 'ws';
import fs from 'node:fs';
const env = fs.readFileSync('.env', 'utf8'); const key = (env.match(/^OPENAI_API_KEY=(.+)$/m) || [])[1];
const model = process.argv[2] || 'gpt-realtime-mini';
const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}`, { headers: { Authorization: 'Bearer ' + key } });
const t0 = Date.now(); const T = () => ((Date.now() - t0) / 1000).toFixed(2);
const seen = {};
ws.on('open', () => {
  console.log(T(), 'open', model);
  ws.send(JSON.stringify({ type: 'session.update', session: {
    type: 'realtime', model, output_modalities: ['audio'],
    instructions: 'You only read aloud exactly the text you are asked to read.',
    audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-4o-transcribe', language: 'bn' }, turn_detection: { type: 'server_vad', create_response: false, interrupt_response: false } },
             output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'shimmer' } },
  } }));
});
ws.on('message', (d) => {
  const e = JSON.parse(d.toString()); seen[e.type] = (seen[e.type] || 0) + 1;
  if (e.type === 'session.updated') {
    console.log(T(), 'session.updated OK');
    ws.send(JSON.stringify({ type: 'response.create', response: { conversation: 'none', output_modalities: ['audio'], instructions: 'Read exactly this Bangla text aloud and nothing else: "আপনার কথা শুনে ভালো লাগলো। আজ কী নিয়ে চিন্তা হচ্ছে?"' } }));
  } else if (e.type === 'error') { console.log(T(), 'ERROR', JSON.stringify(e.error).slice(0, 300)); ws.close(); }
  else if (/audio\.delta$/.test(e.type) && seen[e.type] === 1) console.log(T(), 'first audio delta', e.type);
  else if (e.type === 'response.done') { console.log(T(), 'response.done', e.response?.status, JSON.stringify(e.response?.status_details ?? '')); ws.close(); }
});
ws.on('close', (c, r) => { console.log(T(), 'closed', c, r.toString().slice(0, 100)); console.log('events seen:', JSON.stringify(seen)); process.exit(0); });
ws.on('error', (e) => { console.log('ws error', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout; seen', JSON.stringify(seen)); process.exit(1); }, 25000);
